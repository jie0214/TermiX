package terminal

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"io"
	"net"
	"os"
	"testing"
	"time"

	"github.com/jie0214/TermiX/shared/events"
	cryptossh "golang.org/x/crypto/ssh"
)

// 使用真正的本機 SSH 通道，確認不是只刪除 Manager 裡的紀錄。
func TestUserCloseTerminatesSSHAndReportsIntent(t *testing.T) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := cryptossh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	serverClosed := make(chan struct{})
	serverConfig := &cryptossh.ServerConfig{NoClientAuth: true}
	serverConfig.AddHostKey(signer)
	go func() {
		defer close(serverClosed)
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		server, channels, requests, err := cryptossh.NewServerConn(conn, serverConfig)
		if err != nil {
			return
		}
		defer server.Close()
		go cryptossh.DiscardRequests(requests)
		for incoming := range channels {
			channel, requests, err := incoming.Accept()
			if err != nil {
				return
			}
			go cryptossh.DiscardRequests(requests)
			go func() { _, _ = io.Copy(io.Discard, channel); _ = channel.Close() }()
		}
	}()
	client, err := cryptossh.Dial("tcp", listener.Addr().String(), &cryptossh.ClientConfig{
		User: "test", HostKeyCallback: cryptossh.InsecureIgnoreHostKey(), Timeout: time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	sshSession, err := client.NewSession()
	if err != nil {
		t.Fatal(err)
	}
	manager := NewManager(nil)
	manager.SetContext(context.Background())
	emitted := make(chan map[string]string, 2)
	manager.emitEvent = func(_ context.Context, name string, data ...interface{}) {
		if name == events.EventTerminalClosed {
			emitted <- data[0].(map[string]string)
		}
	}
	selected := &session{key: "ssh-a", host: "same-host", client: client, session: sshSession, closed: make(chan struct{})}
	manager.sessions["ssh-a"] = selected
	manager.sessions["ssh-b"] = &session{key: "ssh-b", host: "same-host", closed: make(chan struct{})}
	manager.Close("ssh-a")
	select {
	case <-serverClosed:
	case <-time.After(3 * time.Second):
		t.Fatal("主動關閉後伺服器仍維持 SSH 通道")
	}
	select {
	case event := <-emitted:
		// 可把真正的後端事件交給前端重播測試，驗證跨層契約。
		if output := os.Getenv("TERMIX_CLOSE_EVENT_FIXTURE"); output != "" {
			data, err := json.Marshal(event)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(output, data, 0600); err != nil {
				t.Fatal(err)
			}
		}
		if event["key"] != "ssh-a" || event["reason"] != "user" {
			t.Fatalf("主動關閉事件未攜帶正確原因：%v", event)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("未送出關閉事件")
	}
	active := manager.ActiveConnections()
	if len(active) != 1 || active[0].SessionKey != "ssh-b" {
		t.Fatalf("誤關閉其他工作階段：%+v", active)
	}
	// 關閉引發的通道退出回呼不得再發送一次遠端斷線事件。
	manager.onSessionExit("ssh-a", selected)
	select {
	case event := <-emitted:
		t.Fatalf("重複送出關閉事件：%v", event)
	default:
	}
}

func TestUnexpectedCloseReportsRemoteReason(t *testing.T) {
	for _, path := range []string{"exit", "fatal-error"} {
		t.Run(path, func(t *testing.T) {
			manager := NewManager(nil)
			manager.SetContext(context.Background())
			emitted := make(chan map[string]string, 1)
			manager.emitEvent = func(_ context.Context, name string, data ...interface{}) {
				if name == events.EventTerminalClosed {
					emitted <- data[0].(map[string]string)
				}
			}
			terminal := &session{key: "ssh-a", closed: make(chan struct{})}
			manager.sessions[terminal.key] = terminal
			if path == "exit" {
				manager.onSessionExit(terminal.key, terminal)
			} else {
				manager.closeSession(terminal)
			}
			select {
			case event := <-emitted:
				if event["reason"] != "remote" {
					t.Fatalf("非預期斷線不能標記成主動關閉：%v", event)
				}
			case <-time.After(time.Second):
				t.Fatal("未送出非預期斷線事件")
			}
		})
	}
}
