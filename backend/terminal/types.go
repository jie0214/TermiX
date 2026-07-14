package terminal

import (
	"context"
	"io"
	"sync"

	pty "github.com/aymanbagabas/go-pty"
	termixssh "github.com/jie0214/TermiX/backend/ssh"

	cryptossh "golang.org/x/crypto/ssh"
)

type Manager struct {
	ctx context.Context
	// ctxMu 保護 ctx 與 frontendReady 的併發讀寫。SetContext 由 Wails Startup（主執行緒）
	// 寫入，而 readPipe / keepalive 等背景 goroutine 會透過 emit* 讀取，兩者需同步以避免
	// data race（-race 偵測）。
	ctxMu sync.RWMutex
	// frontendReady 表示前端 Wails context 是否已就緒（由 SetContext 設定為 true）。
	// 以明確旗標取代先前依賴 Go 內部 context 型別名稱（emptyCtx/backgroundCtx）的字串
	// 判斷 hack；後者依賴非穩定內部實作，Go 版本間可能改變。
	frontendReady       bool
	mu                  sync.Mutex
	sessions            map[string]*session
	connectingCancels   map[string]context.CancelFunc
	pendingCancels      map[string]struct{}
	connectingCancelsMu sync.Mutex
	// creatingLocks 為「每個 session key」一把建立鎖，用來去重同一 key 的併發
	// 建立流程（SSH 握手 / Shell()），避免多個 goroutine 同時完成握手後互相覆蓋
	// m.sessions[key]，導致前一個 *session 的 client/session/goroutine 永遠無法 close。
	// creatingLocksMu 僅保護 creatingLocks 這個 map 本身，不可在持有它時做慢操作。
	creatingLocks   map[string]*sync.Mutex
	creatingLocksMu sync.Mutex
	connector       *termixssh.Connector
}

type session struct {
	key          string
	client       *cryptossh.Client
	session      *cryptossh.Session
	cmd          *pty.Cmd
	stdin        io.WriteCloser
	output       chan string
	closed       chan struct{}
	mu           sync.Mutex
	execMu       sync.Mutex
	exitOnce     sync.Once
	seq          uint64
	isSudo       bool
	isExecuting  bool
	isLocal      bool
	appCtx       context.Context
	// frontendReady 於 session 建立時由 Manager 快照而來，表示 appCtx 是否為已就緒的前端
	// Wails context。取代先前對 context 型別名稱的字串判斷。appCtx 在建立後即固定不變，
	// 由 readPipe goroutine 唯讀，故此欄位不需額外鎖保護。
	frontendReady bool
	sudoPassword  string
	onExit        func(string, *session)
}

func NewManager(connector *termixssh.Connector) *Manager {
	return &Manager{
		sessions:          make(map[string]*session),
		connectingCancels: make(map[string]context.CancelFunc),
		pendingCancels:    make(map[string]struct{}),
		creatingLocks:     make(map[string]*sync.Mutex),
		connector:         connector,
	}
}

func (m *Manager) SetContext(ctx context.Context) {
	m.ctxMu.Lock()
	m.ctx = ctx
	// 由 Wails Startup 傳入真實前端 context 後即視為前端就緒，可正常發送事件。
	m.frontendReady = ctx != nil
	m.ctxMu.Unlock()
}

// contextSnapshot 於同步保護下讀取目前的 ctx 與前端就緒狀態，供 emit* 與 session 建立時使用。
func (m *Manager) contextSnapshot() (context.Context, bool) {
	m.ctxMu.RLock()
	defer m.ctxMu.RUnlock()
	return m.ctx, m.frontendReady
}
