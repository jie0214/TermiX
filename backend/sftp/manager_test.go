package sftp

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jie0214/TermiX/shared/dto"
	pkgsftp "github.com/pkg/sftp"
	cryptossh "golang.org/x/crypto/ssh"
)

type testResolver struct {
	config dto.SSHConfig
	calls  int
}

func (r *testResolver) ResolveRuntimeConfig(_ context.Context, request dto.HostConnectionRequest) (dto.SSHConfig, error) {
	r.calls++
	if request.HostID != "saved-host" {
		return dto.SSHConfig{}, errors.New("未知 Host")
	}
	return r.config, nil
}

type testConnector struct {
	key     cryptossh.PublicKey
	trusted bool
}

func (c *testConnector) ConnectWithContext(ctx context.Context, config dto.SSHConfig) (*cryptossh.Client, error) {
	callback := cryptossh.FixedHostKey(c.key)
	if !c.trusted {
		callback = func(string, net.Addr, cryptossh.PublicKey) error { return errors.New("UNKNOWN_HOST_KEY") }
	}
	return cryptossh.Dial("tcp", net.JoinHostPort(config.Host, strconv.Itoa(config.Port)), &cryptossh.ClientConfig{User: config.Username, Auth: []cryptossh.AuthMethod{cryptossh.Password(config.Password)}, HostKeyCallback: callback, Timeout: time.Second})
}

// 測試伺服器使用真正的 SSH/SFTP 協定，固定測試金鑰，不修改使用者 known_hosts。
func testManager(t *testing.T, handlers ...pkgsftp.Handlers) (*Manager, *testResolver, *testConnector) {
	t.Helper()

	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := cryptossh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	serverConfig := &cryptossh.ServerConfig{PasswordCallback: func(_ cryptossh.ConnMetadata, password []byte) (*cryptossh.Permissions, error) {
		if string(password) != "test-only-password" {
			return nil, errors.New("拒絕認證")
		}
		return nil, nil
	}}
	serverConfig.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				defer conn.Close()
				ssh, chans, requests, err := cryptossh.NewServerConn(conn, serverConfig)
				if err != nil {
					return
				}
				defer ssh.Close()
				go cryptossh.DiscardRequests(requests)
				for channel := range chans {
					if channel.ChannelType() != "session" {
						_ = channel.Reject(cryptossh.UnknownChannelType, "unsupported")
						continue
					}
					ch, reqs, err := channel.Accept()
					if err != nil {
						return
					}
					go func() {
						defer ch.Close()
						for req := range reqs {
							if req.Type != "subsystem" {
								_ = req.Reply(false, nil)
								continue
							}
							var payload struct{ Name string }
							if cryptossh.Unmarshal(req.Payload, &payload) != nil || payload.Name != "sftp" {
								_ = req.Reply(false, nil)
								continue
							}
							_ = req.Reply(true, nil)
							if len(handlers) > 0 {
								server := pkgsftp.NewRequestServer(ch, handlers[0])
								_ = server.Serve()
								_ = server.Close()
								return
							}
							server, err := pkgsftp.NewServer(ch)
							if err != nil {
								return
							}
							_ = server.Serve()
							_ = server.Close()
							return
						}
					}()
				}
			}()
		}
	}()
	host, portText, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portText)
	resolver := &testResolver{config: dto.SSHConfig{Host: host, Port: port, Username: "tester", AuthMode: "password", Password: "test-only-password"}}
	connector := &testConnector{key: signer.PublicKey()}
	manager := NewManager(connector, resolver)
	t.Cleanup(func() { manager.CloseAll(); _ = listener.Close(); <-done; wg.Wait() })
	return manager, resolver, connector
}
func connectTrusted(t *testing.T, m *Manager, r *testResolver, c *testConnector) Session {
	t.Helper()
	_, err := m.Connect(context.Background(), "saved-host")
	if err == nil || !strings.Contains(err.Error(), "UNKNOWN_HOST_KEY") {
		t.Fatalf("未知金鑰未被拒絕：%v", err)
	}
	c.trusted = true
	session, err := m.Connect(context.Background(), "saved-host")
	if err != nil {
		t.Fatal(err)
	}
	return session
}
func waitTransfers(t *testing.T, m *Manager) []Transfer {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if m.ActiveCount() == 0 {
			return m.Transfers()
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("傳輸逾時")
	return nil
}
func writeTestFile(t *testing.T, p string, data []byte) {
	t.Helper()
	if err := os.WriteFile(p, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestSavedCredentialsAndRecursiveRoundTrip(t *testing.T) {
	m, r, c := testManager(t)
	s := connectTrusted(t, m, r, c)
	if r.calls != 2 {
		t.Fatal("連線未重用 Host 認證解析")
	}
	local, remote, download := t.TempDir(), t.TempDir(), t.TempDir()
	if err := os.MkdirAll(filepath.Join(local, "folder", "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("SFTP 串流驗證\n"), 20000)
	writeTestFile(t, filepath.Join(local, "folder", "nested", "file.txt"), payload)
	writeTestFile(t, filepath.Join(local, "empty.txt"), nil)
	if err := m.Queue(s.ID, "upload", []string{filepath.Join(local, "folder"), filepath.Join(local, "empty.txt")}, remote); err != nil {
		t.Fatal(err)
	}
	// 不需要任何前端訂閱，佇列仍完整執行。
	for _, tr := range waitTransfers(t, m) {
		if tr.Status != "completed" || tr.Bytes != tr.Total {
			t.Fatalf("上傳失敗：%+v", tr)
		}
	}
	listing, err := m.List(s.ID, remote)
	if err != nil || len(listing.Entries) != 2 {
		t.Fatalf("目錄列表不符：%+v %v", listing, err)
	}
	if listing.Entries[0].Type != "directory" || listing.Entries[1].Permissions == "" {
		t.Fatal("列表缺少目錄排序或權限")
	}
	if err = m.Queue(s.ID, "download", []string{filepath.Join(remote, "folder"), filepath.Join(remote, "empty.txt")}, download); err != nil {
		t.Fatal(err)
	}
	for _, tr := range waitTransfers(t, m) {
		if tr.Status != "completed" {
			t.Fatalf("下載失敗：%+v", tr)
		}
	}
	result, err := os.ReadFile(filepath.Join(download, "folder", "nested", "file.txt"))
	if err != nil || !bytes.Equal(result, payload) {
		t.Fatal("下載內容不符", err)
	}
	if err = m.Disconnect(s.ID); err != nil {
		t.Fatal(err)
	}
	if len(m.Sessions()) != 0 {
		t.Fatal("連線未清除")
	}
	m.ClearCompleted()
	if len(m.Transfers()) != 0 {
		t.Fatal("完成紀錄未清除")
	}
}
func TestMutationsAndCollisionProtection(t *testing.T) {
	m, r, c := testManager(t)
	s := connectTrusted(t, m, r, c)
	remote, local := t.TempDir(), t.TempDir()
	if err := m.Mutate(s.ID, "mkdir", remote, "new"); err != nil {
		t.Fatal(err)
	}
	if err := m.Mutate(s.ID, "rename", filepath.Join(remote, "new"), "renamed"); err != nil {
		t.Fatal(err)
	}
	if err := m.Mutate(s.ID, "mkdir", remote, "../escape"); err == nil {
		t.Fatal("允許路徑穿越名稱")
	}
	writeTestFile(t, filepath.Join(remote, "existing"), []byte("original"))
	writeTestFile(t, filepath.Join(local, "existing"), []byte("replacement"))
	if err := m.Mutate(s.ID, "rename", filepath.Join(remote, "renamed"), "existing"); err == nil {
		t.Fatal("重新命名覆寫既有檔案")
	}
	if err := m.Queue(s.ID, "upload", []string{filepath.Join(local, "existing")}, remote); err != nil {
		t.Fatal(err)
	}
	if tr := waitTransfers(t, m)[0]; tr.Status != "failed" {
		t.Fatalf("同名上傳應失敗：%+v", tr)
	}
	contents, _ := os.ReadFile(filepath.Join(remote, "existing"))
	if string(contents) != "original" {
		t.Fatal("既有檔案遭覆寫")
	}
	if err := m.Queue(s.ID, "download", []string{filepath.Join(remote, "existing")}, local); err != nil {
		t.Fatal(err)
	}
	if tr := waitTransfers(t, m)[1]; tr.Status != "failed" {
		t.Fatal("同名下載應失敗")
	}
	contents, _ = os.ReadFile(filepath.Join(local, "existing"))
	if string(contents) != "replacement" {
		t.Fatal("本機檔案遭覆寫")
	}
	writeTestFile(t, filepath.Join(remote, "renamed", "child"), nil)
	if err := m.Mutate(s.ID, "delete", filepath.Join(remote, "renamed"), ""); err == nil {
		t.Fatal("不可刪除非空目錄")
	}
	for _, p := range []string{filepath.Join(remote, "renamed", "child"), filepath.Join(remote, "renamed")} {
		if err := m.Mutate(s.ID, "delete", p, ""); err != nil {
			t.Fatal(err)
		}
	}
}
func TestSymlinksAreNotTraversed(t *testing.T) {
	m, r, c := testManager(t)
	s := connectTrusted(t, m, r, c)
	local, remote := t.TempDir(), t.TempDir()
	if err := os.Symlink(t.TempDir(), filepath.Join(local, "link")); err != nil {
		t.Fatal(err)
	}
	if err := m.Queue(s.ID, "upload", []string{filepath.Join(local, "link")}, remote); err != nil {
		t.Fatal(err)
	}
	if tr := waitTransfers(t, m)[0]; tr.Status != "failed" {
		t.Fatal("不應傳輸符號連結")
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(remote, "link")); err != nil {
		t.Fatal(err)
	}
	if err := m.Queue(s.ID, "download", []string{filepath.Join(remote, "link")}, local); err != nil {
		t.Fatal(err)
	}
	if tr := waitTransfers(t, m)[1]; tr.Status != "failed" {
		t.Fatal("不應下載符號連結")
	}
}
func TestQueuedWorkProtectsConnectionAndShutdown(t *testing.T) {
	m, r, c := testManager(t)
	s := connectTrusted(t, m, r, c)
	// 控制佇列狀態以驗證關閉邊界，不依賴網路速度。
	m.mu.Lock()
	conn := m.sessions[s.ID]
	conn.pending = 1
	m.transfers["pending"] = Transfer{ID: "pending", SessionID: s.ID, Status: "queued"}
	m.order = append(m.order, "pending")
	m.mu.Unlock()
	if err := m.Disconnect(s.ID); err == nil {
		t.Fatal("有傳輸時不應中斷")
	}
	if m.ActiveCount() != 1 {
		t.Fatal("遺失進行中工作")
	}
	m.CloseAll()
	if m.Transfers()[0].Status != "failed" || m.ActiveCount() != 0 {
		t.Fatal("關閉後未更新傳輸狀態")
	}
	if err := m.Queue(s.ID, "upload", []string{filepath.Join(t.TempDir(), "a")}, "/tmp"); err == nil {
		t.Fatal("已關閉連線仍可排入傳輸")
	}
}

type failingWriter struct{}

func (failingWriter) Write(p []byte) (int, error) {
	return len(p) / 2, fmt.Errorf("模擬磁碟已滿")
}
func TestCopyReportsWrittenBytesAndCancellation(t *testing.T) {
	var n int64
	if err := copyBytes(context.Background(), failingWriter{}, strings.NewReader("123456"), func(v int64) { n += v }); err == nil || n != 3 {
		t.Fatalf("進度或寫入錯誤未傳遞：%d %v", n, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var dst bytes.Buffer
	if err := copyBytes(ctx, &dst, strings.NewReader("data"), func(int64) {}); !errors.Is(err, context.Canceled) || dst.Len() != 0 {
		t.Fatal("取消後仍寫入")
	}
}
