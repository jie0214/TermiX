// Package sftp 管理獨立於頁面生命週期的 SFTP 連線與傳輸佇列。
package sftp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jie0214/TermiX/shared/dto"
	pkgsftp "github.com/pkg/sftp"
	cryptossh "golang.org/x/crypto/ssh"
)

type Connector interface {
	ConnectWithContext(context.Context, dto.SSHConfig) (*cryptossh.Client, error)
}
type Resolver interface {
	ResolveRuntimeConfig(context.Context, dto.HostConnectionRequest) (dto.SSHConfig, error)
}

type Session struct {
	ID     string `json:"id"`
	HostID string `json:"hostId"`
	Path   string `json:"path"`
}
type Entry struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Size        int64  `json:"size"`
	Modified    int64  `json:"modified"`
	Permissions string `json:"permissions"`
}
type Listing struct {
	Path    string  `json:"path"`
	Entries []Entry `json:"entries"`
}
type Transfer struct {
	ID        string  `json:"id"`
	SessionID string  `json:"sessionId"`
	HostID    string  `json:"hostId"`
	Name      string  `json:"name"`
	Direction string  `json:"direction"`
	Status    string  `json:"status"`
	Bytes     int64   `json:"bytes"`
	Total     int64   `json:"total"`
	Speed     float64 `json:"speed"`
	Error     string  `json:"error"`
}
type connection struct {
	Session
	client  *pkgsftp.Client
	ssh     *cryptossh.Client
	jobs    chan job
	ctx     context.Context
	cancel  context.CancelFunc
	pending int
}
type job struct {
	id, source, destination string
	upload                  bool
}
type Manager struct {
	mu        sync.Mutex
	connector Connector
	resolver  Resolver
	sessions  map[string]*connection
	transfers map[string]Transfer
	order     []string
}

func NewManager(connector Connector, resolver Resolver) *Manager {
	return &Manager{connector: connector, resolver: resolver, sessions: map[string]*connection{}, transfers: map[string]Transfer{}}
}
func (m *Manager) Connect(ctx context.Context, hostID string) (Session, error) {
	config, err := m.resolver.ResolveRuntimeConfig(ctx, dto.HostConnectionRequest{HostID: hostID})
	if err != nil {
		return Session{}, err
	}
	dialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	ssh, err := m.connector.ConnectWithContext(dialCtx, config)
	if err != nil {
		return Session{}, err
	}
	stop := context.AfterFunc(dialCtx, func() { _ = ssh.Close() })
	client, err := pkgsftp.NewClient(ssh)
	if err != nil {
		stop()
		_ = ssh.Close()
		return Session{}, fmt.Errorf("建立 SFTP 子系統失敗：%w", err)
	}
	home, err := client.Getwd()
	if !stop() || err != nil {
		_ = client.Close()
		_ = ssh.Close()
		return Session{}, errors.New("取得 SFTP 起始目錄失敗或逾時")
	}
	sessionCtx, sessionCancel := context.WithCancel(context.Background())
	c := &connection{Session: Session{ID: uuid.NewString(), HostID: hostID, Path: home}, client: client, ssh: ssh, jobs: make(chan job, 256), ctx: sessionCtx, cancel: sessionCancel}
	m.mu.Lock()
	m.sessions[c.ID] = c
	m.mu.Unlock()
	go m.worker(c)
	return c.Session, nil
}
func (m *Manager) get(id string) (*connection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.sessions[id]
	if c == nil {
		return nil, errors.New("SFTP 連線已關閉，請重新連線")
	}
	return c, nil
}
func (m *Manager) Sessions() []Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]Session, 0, len(m.sessions))
	for _, c := range m.sessions {
		result = append(result, c.Session)
	}
	return result
}
func remotePath(p string) error {
	if !path.IsAbs(p) || strings.ContainsRune(p, 0) {
		return errors.New("請指定遠端絕對路徑")
	}
	return nil
}
func safeName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\\\x00")
}
func (m *Manager) List(id, p string) (Listing, error) {
	c, err := m.get(id)
	if err != nil {
		return Listing{}, err
	}
	if err = remotePath(p); err != nil {
		return Listing{}, err
	}
	canonical, err := c.client.RealPath(p)
	if err != nil {
		return Listing{}, err
	}
	infos, err := c.client.ReadDir(canonical)
	if err != nil {
		return Listing{}, err
	}
	entries := make([]Entry, 0, len(infos))
	for _, i := range infos {
		kind := "file"
		if i.IsDir() {
			kind = "directory"
		} else if i.Mode()&os.ModeSymlink != 0 {
			kind = "symlink"
		} else if !i.Mode().IsRegular() {
			kind = "special"
		}
		entries = append(entries, Entry{i.Name(), kind, i.Size(), i.ModTime().UnixMilli(), i.Mode().String()})
	}
	sort.Slice(entries, func(i, j int) bool {
		if (entries[i].Type == "directory") != (entries[j].Type == "directory") {
			return entries[i].Type == "directory"
		}
		return entries[i].Name < entries[j].Name
	})
	return Listing{canonical, entries}, nil
}
func (m *Manager) Mutate(id, action, p, name string) error {
	c, err := m.get(id)
	if err != nil {
		return err
	}
	if err = remotePath(p); err != nil {
		return err
	}
	if action != "delete" && !safeName(name) {
		return errors.New("名稱不可為空白、上層路徑或包含路徑分隔符號")
	}
	switch action {
	case "mkdir":
		return c.client.Mkdir(path.Join(p, name))
	case "rename":
		destination := path.Join(path.Dir(p), name)
		if _, err := c.client.Lstat(destination); err == nil {
			return errors.New("目的項目已存在，不覆寫")
		} else if !os.IsNotExist(err) {
			return err
		}
		return c.client.Rename(p, destination)
	case "delete":
		if path.Clean(p) == "/" {
			return errors.New("不可刪除根目錄")
		}
		info, err := c.client.Lstat(p)
		if err != nil {
			return err
		}
		if info.IsDir() {
			return c.client.RemoveDirectory(p)
		}
		return c.client.Remove(p)
	default:
		return errors.New("不支援的 SFTP 操作")
	}
}

// Queue 一次驗證整批工作；每個連線依序傳輸，不把檔案內容或認證送往前端。
func (m *Manager) Queue(id, direction string, sources []string, destination string) error {
	if direction != "upload" && direction != "download" {
		return errors.New("不支援的傳輸方向")
	}
	upload := direction == "upload"
	if len(sources) == 0 {
		return nil
	}
	if len(sources) > 256 {
		return errors.New("單次最多加入 256 個項目")
	}
	if upload {
		if err := remotePath(destination); err != nil {
			return err
		}
	} else if !filepath.IsAbs(destination) {
		return errors.New("下載位置必須為絕對路徑")
	}
	for _, p := range sources {
		if upload {
			if !filepath.IsAbs(p) || !safeName(filepath.Base(p)) {
				return errors.New("無效的本機來源路徑")
			}
		} else {
			if err := remotePath(p); err != nil {
				return err
			}
			if !safeName(path.Base(p)) {
				return errors.New("不可下載根目錄")
			}
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.sessions[id]
	if c == nil {
		return errors.New("SFTP 連線已關閉")
	}
	if c.pending+len(sources) > 256 {
		return errors.New("傳輸佇列已滿，請等候部分工作完成")
	}
	for _, source := range sources {
		name := path.Base(source)
		if upload {
			name = filepath.Base(source)
		}
		tid := uuid.NewString()
		m.transfers[tid] = Transfer{ID: tid, SessionID: id, HostID: c.HostID, Name: name, Direction: direction, Status: "queued"}
		m.order = append(m.order, tid)
		c.pending++
		c.jobs <- job{tid, source, destination, upload}
	}
	return nil
}
func (m *Manager) Transfers() []Transfer {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]Transfer, 0, len(m.order))
	for _, id := range m.order {
		result = append(result, m.transfers[id])
	}
	return result
}
func (m *Manager) ClearCompleted() {
	m.mu.Lock()
	defer m.mu.Unlock()
	keep := m.order[:0]
	for _, id := range m.order {
		if t := m.transfers[id]; t.Status == "queued" || t.Status == "running" {
			keep = append(keep, id)
		} else {
			delete(m.transfers, id)
		}
	}
	m.order = keep
}
func (m *Manager) ActiveCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, c := range m.sessions {
		n += c.pending
	}
	return n
}
func (m *Manager) Disconnect(id string) error {
	m.mu.Lock()
	c := m.sessions[id]
	if c == nil {
		m.mu.Unlock()
		return nil
	}
	if c.pending > 0 {
		m.mu.Unlock()
		return errors.New("此連線仍有傳輸，請完成後再中斷")
	}
	delete(m.sessions, id)
	m.mu.Unlock()
	closeConnection(c)
	return nil
}
func closeConnection(c *connection) { c.cancel(); _ = c.ssh.Close(); _ = c.client.Close() }
func (m *Manager) CloseAll() {
	m.mu.Lock()
	sessions := m.sessions
	m.sessions = map[string]*connection{}
	for id, t := range m.transfers {
		if t.Status == "queued" || t.Status == "running" {
			t.Status = "failed"
			t.Error = "應用程式已結束，傳輸中斷"
			m.transfers[id] = t
		}
	}
	m.mu.Unlock()
	for _, c := range sessions {
		closeConnection(c)
	}
}
func (m *Manager) worker(c *connection) {
	for {
		select {
		case <-c.ctx.Done():
			return
		case j := <-c.jobs:
			if c.ctx.Err() != nil {
				return
			}
			m.update(j.id, func(t *Transfer) { t.Status = "running" })
			started := time.Now()
			progress := func(n int64) {
				m.update(j.id, func(t *Transfer) { t.Bytes += n; t.Speed = float64(t.Bytes) / time.Since(started).Seconds() })
			}
			total := func(n int64) { m.update(j.id, func(t *Transfer) { t.Total = n }) }
			err := transfer(c.ctx, c.client, j, progress, total)
			m.mu.Lock()
			t := m.transfers[j.id]
			if t.Status == "running" {
				t.Speed = float64(t.Bytes) / time.Since(started).Seconds()
				if err == nil {
					err = c.ctx.Err()
				}
				if err == nil && t.Bytes != t.Total {
					err = fmt.Errorf("傳輸大小不符：預期 %d bytes，實際 %d bytes", t.Total, t.Bytes)
				}
				if err != nil {
					t.Status = "failed"
					t.Error = err.Error()
				} else {
					t.Status = "completed"
				}
				m.transfers[j.id] = t
			}
			c.pending--
			m.mu.Unlock()
		}
	}
}
func (m *Manager) update(id string, fn func(*Transfer)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t := m.transfers[id]
	if t.Status == "queued" || t.Status == "running" {
		fn(&t)
		m.transfers[id] = t
	}
}

// copyBytes 使用固定大小緩衝區，避免大檔案進入記憶體；每次寫入後更新實際進度。
func copyBytes(ctx context.Context, dst io.Writer, src io.Reader, progress func(int64)) error {
	buf := make([]byte, 128*1024)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := src.Read(buf)
		if n > 0 {
			written, err := dst.Write(buf[:n])
			progress(int64(written))
			if err != nil {
				return err
			}
			if written != n {
				return io.ErrShortWrite
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}
