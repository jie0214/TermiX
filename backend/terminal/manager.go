package terminal

import (
	"fmt"
	"github.com/creack/pty"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"github.com/jie0214/TermiX/backend/common"
	termixssh "github.com/jie0214/TermiX/backend/ssh"
	"github.com/jie0214/TermiX/shared/dto"
	"github.com/jie0214/TermiX/shared/events"
	"strconv"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func (m *Manager) Connect(config dto.SSHConfig) dto.OperationResult {
	terminal, _, intro, err := m.getSession(config)
	if err != nil {
		return dto.OperationResult{
			Success: false,
			Output:  common.StripANSI(intro),
			Error:   err.Error(),
		}
	}
	return dto.OperationResult{
		Success:    true,
		Output:     common.StripANSI(intro),
		SessionKey: terminal.key,
		IsSudo:     terminal.isSudo,
	}
}

const defaultLocalTerminalPath = "/bin/zsh"

func resolveLocalTerminalPath(value string) (string, error) {
	path := strings.TrimSpace(value)
	if path == "" {
		path = defaultLocalTerminalPath
	}
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("Local Terminal Path 必須是絕對路徑")
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("Local Terminal Path 不存在或無法存取")
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("Local Terminal Path 必須指向一般檔案")
	}
	if info.Mode().Perm()&0o111 == 0 {
		return "", fmt.Errorf("Local Terminal Path 沒有執行權限")
	}
	return path, nil
}

func localTerminalCommand(value string) (*exec.Cmd, error) {
	path, err := resolveLocalTerminalPath(value)
	if err != nil {
		return nil, err
	}
	return exec.Command(path, "-l"), nil
}

func (m *Manager) StartLocal(shellPath string) dto.OperationResult {
	key := "local|" + strconv.FormatInt(time.Now().UnixNano(), 10)

	cmd, err := localTerminalCommand(shellPath)
	if err != nil {
		return failure(err)
	}

	// 設定 TTY 環境，讓使用者選擇的 Shell 維持一致的終端機行為。
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	f, err := pty.Start(cmd)
	if err != nil {
		return failure(err)
	}

	appCtx, frontendReady := m.contextSnapshot()
	terminal := &session{
		key:           key,
		cmd:           cmd,
		stdin:         f,
		output:        make(chan string, 512),
		closed:        make(chan struct{}),
		isLocal:       true,
		appCtx:        appCtx,
		frontendReady: frontendReady,
		onExit:        m.onSessionExit,
	}

	m.mu.Lock()
	m.sessions[key] = terminal
	m.mu.Unlock()

	// 啟動 Goroutine 實時讀取 PTY 虛擬終端輸出
	go terminal.readPipe(f)

	go func() {
		_ = cmd.Wait()
		m.onSessionExit(key, terminal)
	}()

	// 提示文字直接送往前端，不向 Shell stdin 注入初始化指令或 ANSI 控制碼。
	go func() {
		time.Sleep(50 * time.Millisecond)
		terminal.emitOutput(fmt.Sprintf("\r\n=== TermiX 本機安全終端已建立 (%s PTY) ===\r\n\r\n", filepath.Base(cmd.Path)))
	}()

	return dto.OperationResult{
		Success:    true,
		Output:     "[Local] 本機 Terminal 已啟動。",
		SessionKey: key,
		IsSudo:     false,
	}
}

func (m *Manager) CancelConnect(config dto.SSHConfig) {
	key := SessionKey(config)
	m.connectingCancelsMu.Lock()
	cancel, exists := m.connectingCancels[key]
	if !exists {
		m.pendingCancels[key] = struct{}{}
	}
	m.connectingCancelsMu.Unlock()
	if exists && cancel != nil {
		cancel()
	}
}

func (m *Manager) ExecuteCommand(sessionKey string, command string) dto.OperationResult {
	command = strings.TrimSpace(command)
	if command == "" {
		return dto.OperationResult{Success: false, Error: "Terminal 指令不可空白"}
	}

	m.mu.Lock()
	terminal, exists := m.sessions[sessionKey]
	m.mu.Unlock()

	if !exists {
		return dto.OperationResult{Success: false, Error: "連線已中斷，請重新連線"}
	}

	if terminal.isSudo && strings.HasPrefix(command, "sudo ") {
		command = strings.TrimPrefix(command, "sudo ")
	}

	command = normalizeCommand(command)

	if command == "exit" && terminal.isSudo {
		terminal.isSudo = false
	}

	output, err := terminal.execute(command, 2*time.Minute)
	if err != nil {
		if isFatalError(err) {
			m.closeSessionByKey(sessionKey)
		}
		return dto.OperationResult{
			Success: false,
			Output:  output,
			Error:   err.Error(),
			IsSudo:  terminal.isSudo,
		}
	}
	return dto.OperationResult{Success: true, Output: output, IsSudo: terminal.isSudo}
}

func (m *Manager) ExecuteIsolated(sessionKey string, command string) dto.OperationResult {
	command = strings.TrimSpace(command)
	if command == "" {
		return dto.OperationResult{Success: false, Error: "Terminal 指令不可空白"}
	}

	m.mu.Lock()
	terminal, exists := m.sessions[sessionKey]
	m.mu.Unlock()

	if !exists {
		return dto.OperationResult{Success: false, Error: "連線已中斷，請重新連線"}
	}
	if terminal.isLocal || terminal.client == nil {
		return dto.OperationResult{Success: false, Error: "本機 Terminal 不支援隔離式 SSH 指令"}
	}

	command = normalizeCommand(command)
	if strings.TrimSpace(terminal.sudoPassword) == "" {
		command = injectNonInteractiveSudo(command)
	}
	command = injectSudoPassword(command, terminal.sudoPassword)

	output, err := termixssh.RunRemoteCommand(terminal.client, command, 2*time.Minute)
	if err != nil {
		return dto.OperationResult{
			Success: false,
			Output:  output,
			Error:   err.Error(),
			IsSudo:  terminal.isSudo,
		}
	}
	return dto.OperationResult{Success: true, Output: output, IsSudo: terminal.isSudo}
}

// DetectOS 透過既有 session 的 SSH client 開一次性隔離 exec，靜默讀取遠端
// /etc/os-release（或退回 uname -s），回傳小寫的 OS 識別字串（如 "ubuntu"、
// "debian"、"centos"、"darwin"）。不注入 sudo、不污染互動終端；無法判定時回傳 ""。
func (m *Manager) DetectOS(sessionKey string) string {
	m.mu.Lock()
	terminal, exists := m.sessions[sessionKey]
	m.mu.Unlock()
	if !exists || terminal.isLocal || terminal.client == nil {
		return ""
	}

	output, err := termixssh.RunRemoteCommand(
		terminal.client,
		"cat /etc/os-release 2>/dev/null; echo '___TERMIX_UNAME___'; uname -s 2>/dev/null",
		5*time.Second,
	)
	if err != nil {
		return ""
	}
	return parseOSID(output)
}

// parseOSID 解析 DetectOS 的原始輸出：優先取 os-release 的 ID 欄位，
// 否則退回 uname 名稱；皆為小寫，無法判定時回傳 ""。
func parseOSID(raw string) string {
	parts := strings.SplitN(raw, "___TERMIX_UNAME___", 2)
	for _, line := range strings.Split(parts[0], "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "ID=") {
			id := strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "ID=")), "\"'")
			if id != "" {
				return strings.ToLower(id)
			}
		}
	}
	if len(parts) == 2 {
		if uname := strings.ToLower(strings.TrimSpace(parts[1])); uname != "" {
			return uname
		}
	}
	return ""
}

func (m *Manager) ExecuteTerminalCommand(config dto.SSHConfig, command string) dto.OperationResult {
	command = strings.TrimSpace(command)
	if command == "" {
		return dto.OperationResult{Success: false, Error: "Terminal 指令不可空白"}
	}

	terminal, created, intro, err := m.getSession(config)
	if err != nil {
		return dto.OperationResult{Success: false, Output: strings.TrimSpace(intro), Error: err.Error()}
	}

	output, err := terminal.execute(command, 2*time.Minute)
	if created {
		output = intro + output
	}
	if err != nil {
		if isFatalError(err) {
			m.closeSession(terminal)
		}
		return dto.OperationResult{Success: false, Output: strings.TrimSpace(output), Error: err.Error()}
	}
	return dto.OperationResult{Success: true, Output: strings.TrimSpace(output)}
}

func (m *Manager) Close(sessionKey string) {
	m.closeSessionByKey(sessionKey)
}

func (m *Manager) Resize(sessionKey string, cols int, rows int) dto.OperationResult {
	if cols < 20 {
		cols = 20
	}
	if rows < 5 {
		rows = 5
	}

	m.mu.Lock()
	t, exists := m.sessions[sessionKey]
	m.mu.Unlock()
	if !exists {
		return dto.OperationResult{Success: false, Error: "Terminal session 不存在或已關閉"}
	}

	if t.isLocal {
		if f, ok := t.stdin.(*os.File); ok {
			err := pty.Setsize(f, &pty.Winsize{
				Rows: uint16(rows),
				Cols: uint16(cols),
			})
			if err != nil {
				return dto.OperationResult{Success: false, Error: "無法調整本地 PTY 大小: " + err.Error()}
			}
		}
		return dto.OperationResult{Success: true, Output: fmt.Sprintf("Local terminal size updated: %dx%d", cols, rows)}
	}

	if t.session == nil {
		return dto.OperationResult{Success: false, Error: "Terminal session 已關閉"}
	}

	if err := t.session.WindowChange(rows, cols); err != nil {
		return dto.OperationResult{Success: false, Error: err.Error()}
	}
	return dto.OperationResult{Success: true, Output: fmt.Sprintf("Terminal size updated: %dx%d", cols, rows), IsSudo: t.isSudo}
}

// writeTimeout 為 WriteInput 對 stdin 寫入的最長等待時間。t.stdin 為 SSH channel
// （非 net.Conn，無法 SetWriteDeadline），因此以應用層逾時包裝：閒置後連線半死時，
// 底層 TCP 重傳可能把 io.WriteString 綁住數秒，逾時後主流程快速返回並關閉連線以解除卡住。
const writeTimeout = 3 * time.Second

func (m *Manager) WriteInput(sessionKey string, data string) {
	m.mu.Lock()
	t, exists := m.sessions[sessionKey]
	m.mu.Unlock()
	if !exists || t.stdin == nil {
		return
	}

	// 實際寫入放進 goroutine：它負責取得/釋放 execMu（序列化與 execute() 的互斥），
	// 主流程只等待 done 或逾時、不持有 execMu，避免逾時返回後鎖被永久持有或死鎖。
	done := make(chan struct{})
	go func() {
		t.execMu.Lock()
		defer t.execMu.Unlock()
		_, _ = io.WriteString(t.stdin, data)
		close(done)
	}()

	select {
	case <-done:
		// 連線健康時寫入幾乎即時完成，行為與原本等價、無額外延遲。
	case <-time.After(writeTimeout):
		// 逾時代表連線半死、寫入被 TCP 重傳綁住。透過 notifyExit()（受 exitOnce 保護、
		// 可安全重複呼叫）走既有關閉路徑 onExit→onSessionExit→client.Close()，關閉連線會
		// 讓卡住的 io.WriteString 因 channel 關閉而返回，goroutine 隨即釋放 execMu 並結束，
		// 不會洩漏。連線已關閉後，後續 WriteInput 的寫入會快速失敗，不會累積多個卡住的 goroutine。
		t.notifyExit()
	}
}

func (m *Manager) emitProgress(config dto.SSHConfig, step string, message string) {
	ctx, frontendReady := m.contextSnapshot()
	// 前端 context 尚未就緒（例如尚未 Startup 或單元測試情境）時不發送事件，維持原語意：
	// 在前端就緒前不向前端 emit。
	if !frontendReady || ctx == nil {
		return
	}
	defer func() {
		_ = recover()
	}()
	key := SessionKey(config)
	wailsruntime.EventsEmit(ctx, events.EventConnectionProgress, map[string]string{
		"key":     key,
		"step":    step,
		"message": message,
	})
}

func normalizeCommand(command string) string {
	if (strings.Contains(command, "apt install") || strings.Contains(command, "apt-get install")) &&
		!strings.Contains(command, "-y") && !strings.Contains(command, "--yes") {
		command = strings.ReplaceAll(command, "apt install", "apt install -y")
		command = strings.ReplaceAll(command, "apt-get install", "apt-get install -y")
	}
	return command
}

func injectSudoPassword(command string, sudoPassword string) string {
	if strings.TrimSpace(sudoPassword) == "" || !strings.Contains(command, "sudo ") {
		return command
	}
	replacement := "printf %s " + common.ShellQuote(sudoPassword+"\n") + " | sudo -S -p '' "
	if strings.Contains(command, "sudo -n ") {
		return strings.Replace(command, "sudo -n ", replacement, 1)
	}
	return strings.Replace(command, "sudo ", replacement, 1)
}

func injectNonInteractiveSudo(command string) string {
	trimmed := strings.TrimSpace(command)
	if strings.HasPrefix(trimmed, "sudo ") && !strings.HasPrefix(trimmed, "sudo -n ") {
		return strings.Replace(command, "sudo ", "sudo -n ", 1)
	}
	return command
}

func isFatalError(err error) bool {
	if err == nil {
		return false
	}
	if strings.Contains(err.Error(), "Terminal 指令失敗，exit code：") {
		return false
	}
	return true
}

// acquireCreatingLock 取得某個 session key 的「建立鎖」，確保同一 key 同時只會有一個
// goroutine 進入完整的 SSH 握手 / Shell() 建立流程。回傳的 *sync.Mutex 已經被鎖住，
// 呼叫端完成建立流程後必須呼叫 releaseCreatingLock 以解鎖並做引用計數清理。
//
// 注意：creatingLocksMu 只在「查找 / 建立 / 回收」這把 per-key 鎖時短暫持有，
// 絕不會在持有它的情況下做 SSH 握手等慢操作，因此不會造成全域阻塞。
// 真正的慢操作期間，呼叫端持有的是 per-key 的 lock，而非 creatingLocksMu，也非 m.mu。
func (m *Manager) acquireCreatingLock(key string) *sync.Mutex {
	m.creatingLocksMu.Lock()
	lock, exists := m.creatingLocks[key]
	if !exists {
		lock = &sync.Mutex{}
		m.creatingLocks[key] = lock
	}
	m.creatingLocksMu.Unlock()

	// 在不持有 creatingLocksMu 的情況下等待 per-key 鎖，避免阻塞其他 key 的建立。
	lock.Lock()
	return lock
}

// releaseCreatingLock 解鎖 per-key 建立鎖，並在沒有其他人引用時把它從 map 移除，
// 避免 creatingLocks 隨著不同 key 無限成長。為避免「移除後別人剛好拿到舊鎖」的競態，
// 只有在 TryLock 成功（代表此刻無人持有或等待）時才刪除 map 中的項目。
func (m *Manager) releaseCreatingLock(key string, lock *sync.Mutex) {
	lock.Unlock()

	m.creatingLocksMu.Lock()
	if current, exists := m.creatingLocks[key]; exists && current == lock {
		// 嘗試取得鎖；若成功代表目前沒有其他 goroutine 持有/等待這把鎖，可安全刪除。
		// 若失敗代表仍有等待者，保留 map 項目讓它們共用同一把鎖。
		if lock.TryLock() {
			delete(m.creatingLocks, key)
			lock.Unlock()
		}
	}
	m.creatingLocksMu.Unlock()
}

func (m *Manager) closeSession(terminal *session) {
	if terminal == nil {
		return
	}
	m.closeSessionByKey(terminal.key)
}

func (m *Manager) closeSessionByKey(key string) {
	m.mu.Lock()
	t, exists := m.sessions[key]
	if exists {
		delete(m.sessions, key)
	}
	m.mu.Unlock()
	if exists {
		go func() {
			t.close()
			m.emitClosed(key)
		}()
	}
}

func (m *Manager) onSessionExit(key string, terminal *session) {
	m.mu.Lock()
	current, exists := m.sessions[key]
	if exists && current == terminal {
		delete(m.sessions, key)
	}
	m.mu.Unlock()

	if exists && current == terminal {
		terminal.close()
		m.emitClosed(key)
	}
}

func (m *Manager) emitClosed(key string) {
	ctx, frontendReady := m.contextSnapshot()
	// 前端 context 尚未就緒時不發送事件，維持原語意。
	if !frontendReady || ctx == nil {
		return
	}
	defer func() {
		_ = recover()
	}()
	wailsruntime.EventsEmit(ctx, events.EventTerminalClosed, map[string]string{
		"key": key,
	})
}

func failure(err error) dto.OperationResult {
	return dto.OperationResult{Success: false, Error: err.Error()}
}
