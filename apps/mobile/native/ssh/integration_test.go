package mobilessh_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	mobile "github.com/jie0214/TermiX/mobile/ssh"
	"golang.org/x/crypto/ssh"
)

type event struct {
	Type        string `json:"type"`
	Code        string `json:"code"`
	Data        string `json:"data"`
	Key         string `json:"key"`
	Fingerprint string `json:"fingerprint"`
}

func server(t *testing.T, authorized ...ssh.PublicKey) (int, ssh.Signer, *atomic.Int32, <-chan string) {
	t.Helper()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(key)
	auths := new(atomic.Int32)
	cfg := &ssh.ServerConfig{PasswordCallback: func(_ ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
		auths.Add(1)
		if string(password) != "test-only" {
			return nil, fmt.Errorf("denied")
		}
		return nil, nil
	}}
	if len(authorized) > 0 {
		cfg.PublicKeyCallback = func(_ ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			auths.Add(1)
			for _, allowed := range authorized {
				if string(allowed.Marshal()) == string(key.Marshal()) {
					return nil, nil
				}
			}
			return nil, fmt.Errorf("denied")
		}
	}
	cfg.AddHostKey(signer)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	requests := make(chan string, 20)
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				sc, channels, reqs, err := ssh.NewServerConn(conn, cfg)
				if err != nil {
					return
				}
				defer sc.Close()
				go ssh.DiscardRequests(reqs)
				for incoming := range channels {
					ch, reqs, err := incoming.Accept()
					if err != nil {
						return
					}
					go func() {
						defer ch.Close()
						for req := range reqs {
							requests <- req.Type
							if req.WantReply {
								req.Reply(true, nil)
							}
							if req.Type == "shell" {
								go func() { io.WriteString(ch, "歡迎\r\n$ "); io.Copy(ch, ch) }()
							}
						}
					}()
				}
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, signer, auths, requests
}
func start(t *testing.T, e *mobile.Engine, port int, key, password string) {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"id": "test", "address": "127.0.0.1", "port": port, "username": "tester", "credentials": map[string]string{"type": "password", "password": password}, "cols": 80, "rows": 24, "expectedKey": key})
	if err := e.Start(string(raw)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { e.Disconnect("test") })
}
func waitEvent(t *testing.T, e *mobile.Engine, kind string) event {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var events []event
		if err := json.Unmarshal([]byte(e.Poll("test")), &events); err != nil {
			t.Fatal(err)
		}
		for _, ev := range events {
			if ev.Type == kind {
				return ev
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("未收到 %s", kind)
	return event{}
}
func TestPasswordTerminalTrustInputResizeDisconnect(t *testing.T) {
	port, signer, auths, requests := server(t)
	e := mobile.NewEngine()
	start(t, e, port, "", "test-only")
	challenge := waitEvent(t, e, "hostKey")
	if challenge.Fingerprint != ssh.FingerprintSHA256(signer.PublicKey()) {
		t.Fatal("指紋不符")
	}
	if auths.Load() != 0 {
		t.Fatal("確認前不得送出密碼")
	}
	if err := e.Trust("test", true); err != nil {
		t.Fatal(err)
	}
	waitEvent(t, e, "connected")
	if err := e.Write("test", "echo 測試\r"); err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(output.String(), "echo 測試\r") && time.Now().Before(deadline) {
		ev := waitEvent(t, e, "data")
		data, _ := base64.StdEncoding.DecodeString(ev.Data)
		output.Write(data)
	}
	if !strings.Contains(output.String(), "echo 測試\r") {
		t.Fatal("未收到真實 SSH 輸出")
	}
	if err := e.Resize("test", 100, 30); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"pty-req", "shell", "window-change"} {
		select {
		case got := <-requests:
			if got != expected {
				t.Fatalf("%s != %s", got, expected)
			}
		case <-time.After(time.Second):
			t.Fatal("未收到 PTY 請求")
		}
	}
	e.Disconnect("test")
	waitEvent(t, e, "closed")
	if e.Write("test", "no") == nil {
		t.Fatal("已中斷仍可寫入")
	}
}

func TestRejectUnknownOrChangedKeyBeforePassword(t *testing.T) {
	for _, mode := range []string{"reject", "changed", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			port, _, auths, _ := server(t)
			e := mobile.NewEngine()
			key := ""
			if mode == "changed" {
				key = "different-key"
			}
			start(t, e, port, key, "test-only")
			if mode != "changed" {
				waitEvent(t, e, "hostKey")
				if mode == "reject" {
					if err := e.Trust("test", false); err != nil {
						t.Fatal(err)
					}
				} else {
					e.Disconnect("test")
					waitEvent(t, e, "closed")
				}
			}
			if mode != "cancel" {
				ev := waitEvent(t, e, "error")
				want := "host_key_rejected"
				if mode == "changed" {
					want = "host_key_changed"
				}
				if ev.Code != want {
					t.Fatalf("%s != %s", ev.Code, want)
				}
			}
			if auths.Load() != 0 {
				t.Fatal("未信任／不符的金鑰不得收到密碼")
			}
		})
	}
}
func TestKnownKeyReconnectAndWrongPassword(t *testing.T) {
	port, signer, _, _ := server(t)
	key := base64.StdEncoding.EncodeToString(signer.PublicKey().Marshal())
	for _, password := range []string{"wrong", "test-only"} {
		e := mobile.NewEngine()
		start(t, e, port, key, password)
		if password == "wrong" {
			ev := waitEvent(t, e, "error")
			if ev.Code != "authentication_failed" {
				t.Fatal(ev)
			}
		} else {
			waitEvent(t, e, "connected")
		}
		e.Disconnect("test")
	}
}
func TestCancellationInterruptsStalledHandshake(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	accepted := make(chan net.Conn, 1)
	go func() { c, _ := ln.Accept(); accepted <- c }()
	e := mobile.NewEngine()
	start(t, e, ln.Addr().(*net.TCPAddr).Port, "", "test-only")
	conn := <-accepted
	defer conn.Close()
	e.Disconnect("test")
	waitEvent(t, e, "closed")
	conn.SetReadDeadline(time.Now().Add(time.Second))
	_, err = io.Copy(io.Discard, conn)
	if err != nil {
		t.Fatal("取消後 socket 未立即關閉", err)
	}
}
