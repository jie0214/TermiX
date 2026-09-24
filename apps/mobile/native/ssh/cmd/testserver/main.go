// 僅供開發驗收：綁定 loopback，以短期測試密碼或公鑰執行目前使用者的 shell。
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"

	"github.com/creack/pty"
	"golang.org/x/crypto/ssh"
)

func main() {
	secret := os.Getenv("TERMIX_QA_PASSWORD")
	publicKeyPath := os.Getenv("TERMIX_QA_PUBLIC_KEY")
	if (secret != "" && len(secret) < 12) || (secret == "" && publicKeyPath == "") {
		fmt.Fprintln(os.Stderr, "請設定至少 12 字元的 TERMIX_QA_PASSWORD 或 TERMIX_QA_PUBLIC_KEY 公鑰路徑")
		os.Exit(1)
	}
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(key)
	cfg := &ssh.ServerConfig{}
	if secret != "" {
		cfg.PasswordCallback = func(meta ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			if meta.User() != "termix-qa" || subtle.ConstantTimeCompare(password, []byte(secret)) != 1 {
				return nil, fmt.Errorf("denied")
			}
			return nil, nil
		}
	}
	if publicKeyPath != "" {
		data, err := os.ReadFile(publicKeyPath)
		if err != nil {
			panic("無法讀取測試公鑰")
		}
		allowed, _, _, _, err := ssh.ParseAuthorizedKey(data)
		if err != nil {
			panic("測試公鑰格式無效")
		}
		cfg.PublicKeyCallback = func(meta ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if meta.User() != "termix-qa" || string(key.Marshal()) != string(allowed.Marshal()) {
				return nil, fmt.Errorf("denied")
			}
			return nil, nil
		}
	}
	cfg.AddHostKey(signer)
	ln, err := net.Listen("tcp", "127.0.0.1:22222")
	if err != nil {
		panic(err)
	}
	defer ln.Close()
	fmt.Printf("測試 SSH：termix-qa@127.0.0.1:22222\n指紋：%s\n公鑰：%s\n", ssh.FingerprintSHA256(signer.PublicKey()), base64.StdEncoding.EncodeToString(signer.PublicKey().Marshal()))
	var active sync.Map
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() { <-stop; ln.Close(); active.Range(func(k, v any) bool { k.(net.Conn).Close(); return true }) }()
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		active.Store(conn, true)
		go func() { defer active.Delete(conn); defer conn.Close(); serve(conn, cfg) }()
	}
}
func serve(conn net.Conn, cfg *ssh.ServerConfig) {
	sc, channels, requests, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		return
	}
	defer sc.Close()
	go func() {
		for req := range requests {
			req.Reply(false, nil)
		}
	}()
	for incoming := range channels {
		if incoming.ChannelType() != "session" {
			incoming.Reject(ssh.UnknownChannelType, "session only")
			continue
		}
		ch, requests, err := incoming.Accept()
		if err != nil {
			return
		}
		go shell(ch, requests)
	}
}
func shell(ch ssh.Channel, requests <-chan *ssh.Request) {
	defer ch.Close()
	size := &pty.Winsize{Cols: 80, Rows: 24}
	var terminal *os.File
	var command *exec.Cmd
	defer func() {
		if terminal != nil {
			terminal.Close()
		}
		if command != nil && command.Process != nil {
			syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		}
	}()
	for req := range requests {
		ok := false
		switch req.Type {
		case "pty-req":
			var value struct {
				Term                      string
				Cols, Rows, Width, Height uint32
				Modes                     string
			}
			if ssh.Unmarshal(req.Payload, &value) == nil {
				size.Cols = uint16(value.Cols)
				size.Rows = uint16(value.Rows)
				ok = true
			}
		case "window-change":
			var value struct{ Cols, Rows, Width, Height uint32 }
			if ssh.Unmarshal(req.Payload, &value) == nil {
				size.Cols = uint16(value.Cols)
				size.Rows = uint16(value.Rows)
				if terminal != nil {
					pty.Setsize(terminal, size)
				}
				ok = true
			}
		case "shell":
			if command == nil {
				command = exec.Command("/bin/sh", "-i")
				env := []string{}
				for _, entry := range os.Environ() {
					if !strings.HasPrefix(entry, "TERMIX_QA_PASSWORD=") {
						env = append(env, entry)
					}
				}
				command.Env = append(env, "TERM=xterm-256color", "PS1=qa$ ", "HISTFILE=/dev/null")
				command.Dir = os.TempDir()
				var err error
				terminal, err = pty.StartWithSize(command, size)
				if err == nil {
					ok = true
					go io.Copy(terminal, ch)
					go func() {
						io.Copy(ch, terminal)
						command.Wait()
						ch.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
						ch.Close()
					}()
				}
			}
		}
		if req.WantReply {
			req.Reply(ok, nil)
		}
	}
}
