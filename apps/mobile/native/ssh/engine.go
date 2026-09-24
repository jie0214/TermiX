// Package mobilessh 提供 iOS／Android 共用的單一 SSH 連線邊界。
package mobilessh

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

type config struct {
	ID          string      `json:"id"`
	Address     string      `json:"address"`
	Port        int         `json:"port"`
	Username    string      `json:"username"`
	Credentials credentials `json:"credentials"`
	ExpectedKey string      `json:"expectedKey"`
	Cols        int         `json:"cols"`
	Rows        int         `json:"rows"`
}
type event struct {
	Type        string `json:"type"`
	Code        string `json:"code,omitempty"`
	Data        string `json:"data,omitempty"`
	Key         string `json:"key,omitempty"`
	Fingerprint string `json:"fingerprint,omitempty"`
	Algorithm   string `json:"algorithm,omitempty"`
}

type connection struct {
	mu      sync.Mutex
	writeMu sync.Mutex
	id      string
	ctx     context.Context
	cancel  context.CancelFunc
	conn    net.Conn
	client  *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser
	trust   chan bool
	waiting bool
	done    bool
	events  []event
	queued  int
}

// Engine 在原生層限制最多一個進行中或已連線的 session。
type Engine struct {
	mu     sync.Mutex
	active *connection
}

func NewEngine() *Engine { return &Engine{} }
func (e *Engine) Start(raw string) error {
	var c config
	if json.Unmarshal([]byte(raw), &c) != nil || c.ID == "" || c.Address == "" || c.Port < 1 || c.Port > 65535 || c.Username == "" || !c.Credentials.valid() || !sizeValid(c.Cols, c.Rows) {
		return errors.New("invalid_config")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.active != nil {
		e.active.mu.Lock()
		done := e.active.done
		e.active.mu.Unlock()
		if !done {
			return errors.New("session_busy")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &connection{id: c.ID, ctx: ctx, cancel: cancel, trust: make(chan bool, 1)}
	e.active = s
	go s.connect(c)
	return nil
}
func (e *Engine) get(id string) *connection {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.active != nil && e.active.id == id {
		return e.active
	}
	return nil
}
func (e *Engine) Disconnect(id string) {
	if s := e.get(id); s != nil {
		s.finish("")
	}
}

// Close 供原生模組銷毀／進入背景時關閉連線。
func (e *Engine) Close() {
	e.mu.Lock()
	s := e.active
	e.mu.Unlock()
	if s != nil {
		s.finish("")
	}
}
func (e *Engine) Poll(id string) string {
	s := e.get(id)
	if s == nil {
		return "[]"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.events) == 0 {
		return "[]"
	}
	raw, _ := json.Marshal(s.events)
	s.events = nil
	s.queued = 0
	return string(raw)
}
func (e *Engine) Trust(id string, accept bool) error {
	s := e.get(id)
	if s == nil {
		return errors.New("not_waiting")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.done || !s.waiting {
		return errors.New("not_waiting")
	}
	s.waiting = false
	s.trust <- accept
	return nil
}
func (e *Engine) Write(id, text string) error {
	s := e.get(id)
	if s == nil || len(text) > 16384 {
		return errors.New("invalid_input")
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	s.mu.Lock()
	stdin, done := s.stdin, s.done
	s.mu.Unlock()
	if stdin == nil || done {
		return errors.New("not_connected")
	}
	return s.operation(func() error { _, err := io.WriteString(stdin, text); return err })
}
func sizeValid(cols, rows int) bool { return cols >= 2 && cols <= 500 && rows >= 1 && rows <= 500 }
func (e *Engine) Resize(id string, cols, rows int) error {
	s := e.get(id)
	if s == nil || !sizeValid(cols, rows) {
		return errors.New("invalid_size")
	}
	s.mu.Lock()
	session, done := s.session, s.done
	s.mu.Unlock()
	if session == nil || done {
		return errors.New("not_connected")
	}
	return s.operation(func() error { return session.WindowChange(rows, cols) })
}
func (s *connection) operation(fn func() error) error {
	result := make(chan error, 1)
	go func() { result <- fn() }()
	select {
	case err := <-result:
		if err != nil {
			s.finish("connection_lost")
		}
		return err
	case <-s.ctx.Done():
		return errors.New("closed")
	case <-time.After(5 * time.Second):
		s.finish("connection_lost")
		return errors.New("connection_lost")
	}
}
func (s *connection) emit(ev event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.done {
		s.events = append(s.events, ev)
	}
}

// finish 先關閉 socket 解除所有阻塞；錯誤只回傳固定代碼，不包含認證或遠端訊息。
func (s *connection) finish(code string) {
	s.mu.Lock()
	if s.done {
		s.mu.Unlock()
		return
	}
	s.done = true
	s.cancel()
	conn := s.conn
	ev := event{Type: "closed"}
	if code != "" {
		ev.Type = "error"
		ev.Code = code
	}
	s.events = append(s.events, ev)
	if conn != nil {
		conn.Close()
	}
	s.mu.Unlock()
}
func (s *connection) connect(c config) {
	auth, code := c.Credentials.authentication()
	c.Credentials = credentials{}
	if code != "" {
		s.finish(code)
		return
	}
	if s.ctx.Err() != nil {
		return
	}
	addr := net.JoinHostPort(c.Address, strconv.Itoa(c.Port))
	conn, err := (&net.Dialer{Timeout: 12 * time.Second, KeepAlive: 15 * time.Second}).DialContext(s.ctx, "tcp", addr)
	if err != nil {
		s.finish("connection_failed")
		return
	}
	s.mu.Lock()
	if s.done {
		s.mu.Unlock()
		conn.Close()
		return
	}
	s.conn = conn
	s.mu.Unlock()
	conn.SetDeadline(time.Now().Add(20 * time.Second))
	keyFailure := ""
	clientConfig := &ssh.ClientConfig{User: c.Username, Auth: []ssh.AuthMethod{auth}, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		actual := base64.StdEncoding.EncodeToString(key.Marshal())
		if c.ExpectedKey != "" {
			if actual != c.ExpectedKey {
				keyFailure = "host_key_changed"
				return errors.New(keyFailure)
			}
			return nil
		}
		conn.SetDeadline(time.Now().Add(90 * time.Second))
		s.mu.Lock()
		if s.done {
			s.mu.Unlock()
			return errors.New("closed")
		}
		s.waiting = true
		s.mu.Unlock()
		s.emit(event{Type: "hostKey", Key: actual, Fingerprint: ssh.FingerprintSHA256(key), Algorithm: key.Type()})
		select {
		case accept := <-s.trust:
			if !accept {
				keyFailure = "host_key_rejected"
				return errors.New(keyFailure)
			}
		case <-s.ctx.Done():
			return errors.New("closed")
		case <-time.After(90 * time.Second):
			keyFailure = "host_key_timeout"
			return errors.New(keyFailure)
		}
		conn.SetDeadline(time.Now().Add(20 * time.Second))
		return nil
	}}
	sshConn, chans, reqs, err := ssh.NewClientConn(conn, addr, clientConfig)
	// 握手完成後釋放密碼或私鑰 signer 的參照。
	auth = nil
	clientConfig.Auth = nil
	if err != nil {
		code := "connection_failed"
		if keyFailure != "" {
			code = keyFailure
		} else if strings.Contains(err.Error(), "unable to authenticate") {
			code = "authentication_failed"
		}
		s.finish(code)
		return
	}
	client := ssh.NewClient(sshConn, chans, reqs)
	session, err := client.NewSession()
	if err != nil {
		s.finish("terminal_failed")
		return
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		s.finish("terminal_failed")
		return
	}
	session.Stdout = s
	session.Stderr = s
	if err = session.RequestPty("xterm-256color", c.Rows, c.Cols, ssh.TerminalModes{ssh.ECHO: 1}); err != nil {
		s.finish("terminal_failed")
		return
	}
	if err = session.Shell(); err != nil {
		s.finish("terminal_failed")
		return
	}
	conn.SetDeadline(time.Time{})
	s.mu.Lock()
	if s.done {
		s.mu.Unlock()
		client.Close()
		return
	}
	s.client = client
	s.session = session
	s.stdin = stdin
	s.mu.Unlock()
	s.emit(event{Type: "connected"})
	go s.keepAlive(client)
	err = session.Wait()
	if err != nil {
		var exit *ssh.ExitError
		if !errors.As(err, &exit) {
			s.finish("connection_lost")
			return
		}
	}
	s.finish("")
}
func (s *connection) keepAlive(client *ssh.Client) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			if s.operation(func() error { _, _, err := client.SendRequest("keepalive@openssh.com", true, nil); return err }) != nil {
				return
			}
		}
	}
}

// Write 實作終端輸出邊界，使用 UTF-8 bytes，避免分塊時破壞中文字元。
func (s *connection) Write(p []byte) (int, error) {
	s.mu.Lock()
	if s.done {
		s.mu.Unlock()
		return 0, io.ErrClosedPipe
	}
	if s.queued+len(p) > 256*1024 {
		s.mu.Unlock()
		s.finish("output_overflow")
		return 0, io.ErrShortBuffer
	}
	s.events = append(s.events, event{Type: "data", Data: base64.StdEncoding.EncodeToString(p)})
	s.queued += len(p)
	s.mu.Unlock()
	return len(p), nil
}
