package terminal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"github.com/jie0214/TermiX/backend/common"
	termixssh "github.com/jie0214/TermiX/backend/ssh"
	"github.com/jie0214/TermiX/shared/events"
	"strconv"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"github.com/jie0214/TermiX/shared/dto"
)

const (
	// keepaliveInterval 為持久 SSH session 送出保活請求的間隔。縮短為 15 秒可更快偵測
	// 半死連線（閒置後切回輸入卡幾秒的情境），同時流量負擔仍極低。
	keepaliveInterval = 15 * time.Second
	// keepaliveMaxFailures 為連續失敗幾次後判定連線已死。降為 2 次以加快死連線偵測，
	// 仍容許單次暫時性網路抖動而不誤判斷線。
	keepaliveMaxFailures = 2
)

func (m *Manager) getSession(config dto.SSHConfig) (*session, bool, string, error) {
	key := SessionKey(config)

	m.mu.Lock()
	if t, exists := m.sessions[key]; exists {
		m.mu.Unlock()
		_, err := t.execute("whoami", 2*time.Second)
		if err == nil {
			return t, false, "", nil
		}
		m.closeSessionByKey(key)
	} else {
		m.mu.Unlock()
	}

	// 取得 per-key 建立鎖，確保同一 key 同時只會有一個 goroutine 進入下方完整的
	// SSH 握手 / Shell() 建立流程。此鎖在不持有 m.mu 的情況下取得與持有，因此慢速的
	// SSH 握手不會阻塞其他 key 或一般的 session 操作（ExecuteCommand 等）。
	creatingLock := m.acquireCreatingLock(key)
	defer m.releaseCreatingLock(key, creatingLock)

	// double-check：在等待建立鎖的期間，可能已有另一個併發呼叫完成了同一 key 的建立。
	// 若已存在且仍可用，直接重用既有 session，避免重複握手與資源洩漏。
	m.mu.Lock()
	if t, exists := m.sessions[key]; exists {
		m.mu.Unlock()
		_, err := t.execute("whoami", 2*time.Second)
		if err == nil {
			return t, false, "", nil
		}
		m.closeSessionByKey(key)
	} else {
		m.mu.Unlock()
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.connectingCancelsMu.Lock()
	if _, canceled := m.pendingCancels[key]; canceled {
		delete(m.pendingCancels, key)
		m.connectingCancelsMu.Unlock()
		cancel()
		return nil, false, "", errors.New("連線已被使用者取消")
	}
	m.connectingCancels[key] = cancel
	m.connectingCancelsMu.Unlock()
	defer func() {
		m.connectingCancelsMu.Lock()
		delete(m.connectingCancels, key)
		m.connectingCancelsMu.Unlock()
		cancel()
	}()

	var intro strings.Builder
	common.WriteLog(&intro, "Terminal", "建立持久 SSH Terminal session")

	if err := termixssh.ValidateConfig(config); err != nil {
		return nil, false, intro.String(), err
	}

	m.emitProgress(config, "tcp-connecting", "正在建立 TCP 連線...")
	client, err := m.connector.ConnectWithContext(ctx, config)
	if err != nil {
		if ctx.Err() == context.Canceled {
			return nil, false, intro.String(), errors.New("連線已被使用者取消")
		}
		return nil, false, intro.String(), err
	}

	m.emitProgress(config, "ssh-handshake", "TCP 連線成功，正在進行 SSH 握手與認證...")

	m.emitProgress(config, "pty-requesting", "正在請求 PTY 虛擬終端...")
	sshSession, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, false, intro.String(), err
	}

	if err := sshSession.RequestPty("xterm", 40, 120, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
		3:                 127, // 3 是 TTY_OP_VERASE，設定退格鍵為 ASCII 127 (\x7f)
	}); err != nil {
		sshSession.Close()
		client.Close()
		return nil, false, intro.String(), err
	}

	m.emitProgress(config, "shell-starting", "正在啟動 Shell 進程...")
	stdin, err := sshSession.StdinPipe()
	if err != nil {
		sshSession.Close()
		client.Close()
		return nil, false, intro.String(), err
	}
	stdout, err := sshSession.StdoutPipe()
	if err != nil {
		sshSession.Close()
		client.Close()
		return nil, false, intro.String(), err
	}
	stderr, err := sshSession.StderrPipe()
	if err != nil {
		sshSession.Close()
		client.Close()
		return nil, false, intro.String(), err
	}

	appCtx, frontendReady := m.contextSnapshot()
	terminal := &session{
		key:           key,
		client:        client,
		session:       sshSession,
		stdin:         stdin,
		output:        make(chan string, 512),
		closed:        make(chan struct{}),
		appCtx:        appCtx,
		frontendReady: frontendReady,
		sudoPassword:  config.SudoPassword,
		onExit:        m.onSessionExit,
	}
	go terminal.readPipe(stdout)
	go terminal.readPipe(stderr)

	if err := sshSession.Shell(); err != nil {
		terminal.close()
		return nil, false, intro.String(), err
	}

	if strings.TrimSpace(config.SudoPassword) != "" {
		m.emitProgress(config, "sudo-checking", "SSH 連線成功，正在啟動 sudo shell...")
		common.WriteLog(&intro, "Sudo", "在目前 PTY 啟動 sudo shell 並驗證權限")
		output, err := terminal.startSudoShell(15 * time.Second)
		if output != "" {
			intro.WriteString(output)
		}
		if err != nil {
			terminal.close()
			return nil, false, intro.String(), fmt.Errorf("sudo shell 啟動失敗：%w", err)
		}
		terminal.isSudo = true
		output, err = terminal.execute("whoami", 15*time.Second)
		if output != "" {
			intro.WriteString(output)
		}
		if err != nil {
			terminal.close()
			return nil, false, intro.String(), fmt.Errorf("sudo shell 啟動失敗：%w", err)
		}
		if !commandOutputHasLine(output, "root") {
			terminal.close()
			return nil, false, intro.String(), fmt.Errorf("sudo shell 啟動失敗：whoami = %s", strings.TrimSpace(output))
		}
	}

	m.emitProgress(config, "shell-ready", "終端機 Session 建立成功！")
	common.WriteLog(&intro, "Terminal", fmt.Sprintf("已連線至 %s@%s:%d", config.Username, config.Host, config.Port))
	terminal.isSudo = strings.TrimSpace(config.SudoPassword) != ""

	m.mu.Lock()
	m.sessions[key] = terminal
	m.mu.Unlock()

	// 註冊成功後才啟動 keepalive goroutine，確保任何中途失敗的早退路徑
	//（RequestPty / Shell / sudo 啟動失敗）都不會誤啟動保活迴圈。
	go terminal.keepaliveLoop()

	return terminal, true, intro.String(), nil
}

func sudoPromptMarker(seq uint64) string {
	return fmt.Sprintf("__TERMIX_SUDO_PROMPT_%d__", seq)
}

func sudoReadyMarker(seq uint64) string {
	return fmt.Sprintf("__TERMIX_SUDO_READY_%d__", seq)
}

func sudoShellCommand(promptMarker string, readyMarker string) string {
	bootstrap := "stty echo 2>/dev/null\nprintf '\\n" + readyMarker + "\\n'\nexec bash -i"
	return "sudo -k -S -p " + common.ShellQuote(promptMarker) + " bash -lc " + common.ShellQuote(bootstrap) + "\n"
}

func SessionKey(config dto.SSHConfig) string {
	sudoMode := "no-sudo"
	if strings.TrimSpace(config.SudoPassword) != "" {
		sudoMode = "sudo"
	}
	return strings.Join([]string{
		config.Host,
		strconv.Itoa(config.Port),
		config.Username,
		config.AuthMode,
		config.PrivateKeyPath,
		config.CertPath,
		sudoMode,
		config.SessionID,
	}, "|")
}

func (t *session) readPipe(reader io.Reader) {
	buffer := make([]byte, 4096)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			chunk := string(buffer[:n])

			// 總是實時發送輸出給前端終端彩現，保障極速回顯與串流體驗
			t.emitOutput(chunk)

			t.mu.Lock()
			executing := t.isExecuting
			t.mu.Unlock()

			if executing {
				select {
				case t.output <- chunk:
				case <-t.closed:
					return
				}
			}
		}
		if err != nil {
			t.notifyExit()
			return
		}
	}
}

// keepaliveLoop 週期性地對 SSH 連線送出 keepalive 全域請求，用途有二：
//  1. 保活——防止中間設備 / 伺服器因閒置而切斷長時間未互動的持久 session。
//  2. 主動偵測斷線——若連續 keepaliveMaxFailures 次送出失敗（或成功但對端回覆
//     失敗），視為連線已死，主動走既有關閉路徑（notifyExit → onExit →
//     onSessionExit → close + emitClosed），讓前端即時收到 terminal-closed。
//
// 生命週期與 session 綁定：透過 select 監聽 t.closed，session 關閉時本 goroutine
// 立即結束並停止 ticker，不會洩漏。本 goroutine 不持有 m.mu 或其他 manager 鎖，
// 因此不會阻塞其他 session 操作。
func (t *session) keepaliveLoop() {
	// 本地終端機（isLocal）或缺少真實 SSH client 的 session（例如單元測試直接建構的
	// *session）沒有 client 可保活，直接返回避免 nil client 解參考。
	if t == nil || t.client == nil {
		return
	}

	ticker := time.NewTicker(keepaliveInterval)
	defer ticker.Stop()

	failures := 0
	for {
		select {
		case <-t.closed:
			return
		case <-ticker.C:
			// wantReply 設為 true：要求對端回覆，才能藉由 error 判定連線是否仍存活。
			// keepalive@openssh.com 為 OpenSSH 全域請求，對端不認得時會回覆 failure
			// 但連線本身正常，此時 SendRequest 回傳的 err 為 nil，因此不會誤判斷線。
			_, _, err := t.client.SendRequest("keepalive@openssh.com", true, nil)
			if err != nil {
				failures++
				if failures >= keepaliveMaxFailures {
					// 連續多次失敗，判定連線已死。走既有 exitOnce 保護的關閉路徑，
					// 與 readPipe 偵測 EOF 時一致，避免重複 close 競態。
					t.notifyExit()
					return
				}
				continue
			}
			failures = 0
		}
	}
}

func (t *session) notifyExit() {
	if t == nil || t.onExit == nil {
		return
	}
	t.exitOnce.Do(func() {
		go t.onExit(t.key, t)
	})
}

func (t *session) emitOutput(sendChunk string) {
	// 前端 context 尚未就緒（例如單元測試以 nil ctx 直接建構 session）時不發送事件，
	// 維持原語意：前端就緒前不 emit。frontendReady 於 session 建立時快照，取代先前對
	// context 型別名稱（emptyCtx/backgroundCtx）的字串判斷 hack。
	if sendChunk == "" || t.appCtx == nil || !t.frontendReady {
		return
	}
	defer func() {
		_ = recover()
	}()
	wailsruntime.EventsEmit(t.appCtx, events.EventTerminalOutput, map[string]string{
		"key":   t.key,
		"chunk": sendChunk,
	})
}

func isSudoPrompt(text string) bool {
	lower := strings.ToLower(text)
	hasPassword := strings.Contains(lower, "password") || strings.Contains(lower, "密碼") || strings.Contains(lower, "密码")
	if hasPassword && (strings.Contains(lower, "sudo") || strings.Contains(lower, ":") || strings.Contains(lower, "：")) {
		return true
	}
	return false
}

func isDigitsOnly(text string) bool {
	if text == "" {
		return false
	}
	for _, r := range text {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func commandOutputHasLine(output string, expected string) bool {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return false
	}
	normalized := strings.ReplaceAll(output, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	normalized = common.StripANSI(normalized)
	for _, line := range strings.Split(normalized, "\n") {
		if strings.TrimSpace(line) == expected {
			return true
		}
	}
	return false
}

func (t *session) execute(command string, timeout time.Duration) (string, error) {
	t.execMu.Lock()
	defer t.execMu.Unlock()

	t.mu.Lock()
	t.isExecuting = true
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		t.isExecuting = false
		t.mu.Unlock()
	}()

	t.mu.Lock()
	t.seq++
	currentSeq := t.seq
	t.mu.Unlock()

	t.drain()
	startMarker := fmt.Sprintf("__TERMIX_START_%d__", currentSeq)
	marker := fmt.Sprintf("__TERMIX_DONE_%d__", currentSeq)
	if _, err := io.WriteString(t.stdin, "stty -echo 2>/dev/null\n"); err != nil {
		return "", err
	}
	time.Sleep(20 * time.Millisecond) // 短暫等待以降低 PTY 切換延遲的可能
	t.drain()

	reachedMarker := false
	defer func() {
		if !reachedMarker {
			_, _ = io.WriteString(t.stdin, "stty echo 2>/dev/null\n")
		}
	}()

	wrappedCommand := "printf '\\n" + startMarker + "\\n'\n" + command + "\nstatus=$?\nstty echo 2>/dev/null\nprintf '\\n" + marker + ":%s\\n' \"$status\"\n"
	if _, err := io.WriteString(t.stdin, wrappedCommand); err != nil {
		return "", err
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	var output strings.Builder
	sudoPromptDetected := false
	for {
		select {
		case chunk := <-t.output:
			output.WriteString(chunk)
			text := output.String()

			// 自動回應 sudo 密碼提示 (支援多國語言)
			if !t.isSudo && t.sudoPassword != "" && !sudoPromptDetected {
				if isSudoPrompt(text) {
					sudoPromptDetected = true
					_, _ = io.WriteString(t.stdin, t.sudoPassword+"\n")
				}
			}

			// 偵測到 sudo 密碼提示但未配置密碼，立刻失敗返回，防止卡死 2 分鐘
			if !t.isSudo && t.sudoPassword == "" {
				if isSudoPrompt(text) {
					return common.StripANSI(strings.TrimSpace(text)), errors.New("執行此指令需要 sudo 權限，但您尚未在主機設定中配置 Sudo 密碼。")
				}
			}

			before, status, found, parseErr := parseCommandResult(text, startMarker, marker)
			if parseErr != nil {
				return before, parseErr
			}
			if found {
				reachedMarker = true
				if status != "0" {
					return before, fmt.Errorf("Terminal 指令失敗，exit code：%s", status)
				}
				return before, nil
			}
		case <-timer.C:
			return common.StripANSI(strings.TrimSpace(output.String())), errors.New("Terminal 指令逾時")
		case <-t.closed:
			return common.StripANSI(strings.TrimSpace(output.String())), errors.New("Terminal session 已關閉")
		}
	}
}

func parseCommandResult(text string, startMarker string, doneMarker string) (string, string, bool, error) {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := strings.Split(normalized, "\n")
	if !strings.HasSuffix(normalized, "\n") && len(lines) > 0 {
		lines = lines[:len(lines)-1]
	}

	for idx := len(lines) - 1; idx >= 0; idx-- {
		line := lines[idx]
		if !strings.HasPrefix(line, doneMarker+":") {
			continue
		}
		statusText := strings.TrimPrefix(line, doneMarker+":")
		before := cleanCommandOutput(strings.Join(lines[:idx], "\n"), startMarker, doneMarker)
		if !isDigitsOnly(statusText) {
			continue
		}
		return before, statusText, true, nil
	}
	return "", "", false, nil
}

func cleanCommandOutput(text string, startMarker string, doneMarker string) string {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := strings.Split(normalized, "\n")
	startIdx := -1
	for idx, line := range lines {
		if line == startMarker {
			startIdx = idx
		}
	}
	if startIdx >= 0 && startIdx+1 < len(lines) {
		lines = lines[startIdx+1:]
	}
	filtered := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.Contains(line, startMarker) || strings.Contains(line, doneMarker) {
			continue
		}
		if isShellPromptLine(line) {
			continue
		}
		filtered = append(filtered, line)
	}
	before := strings.TrimSpace(strings.Join(filtered, "\n"))
	return common.StripANSI(before)
}

func isShellPromptLine(line string) bool {
	trimmed := strings.TrimSpace(common.StripANSI(line))
	if trimmed == "" {
		return false
	}
	if trimmed == ">" {
		return true
	}
	if !(strings.HasSuffix(trimmed, "#") || strings.HasSuffix(trimmed, "$")) {
		return false
	}
	return strings.Contains(trimmed, "@") && strings.Contains(trimmed, ":")
}

func (t *session) startSudoShell(timeout time.Duration) (string, error) {
	t.execMu.Lock()
	defer t.execMu.Unlock()

	t.mu.Lock()
	t.isExecuting = true
	t.seq++
	currentSeq := t.seq
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		t.isExecuting = false
		t.mu.Unlock()
	}()

	t.drain()
	promptMarker := sudoPromptMarker(currentSeq)
	readyMarker := sudoReadyMarker(currentSeq)
	if _, err := io.WriteString(t.stdin, "stty -echo 2>/dev/null\n"); err != nil {
		return "", err
	}
	time.Sleep(20 * time.Millisecond)
	t.drain()

	reachedReady := false
	defer func() {
		if !reachedReady {
			_, _ = io.WriteString(t.stdin, "stty echo 2>/dev/null\n")
		}
	}()

	if _, err := io.WriteString(t.stdin, sudoShellCommand(promptMarker, readyMarker)); err != nil {
		return "", err
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	var output strings.Builder
	passwordSent := false
	for {
		select {
		case chunk := <-t.output:
			output.WriteString(chunk)
			text := output.String()

			if !passwordSent && strings.Contains(text, promptMarker) {
				passwordSent = true
				if _, err := io.WriteString(t.stdin, t.sudoPassword+"\n"); err != nil {
					return common.StripANSI(strings.TrimSpace(strings.ReplaceAll(text, promptMarker, ""))), err
				}
			}

			if index := strings.Index(text, readyMarker); index >= 0 {
				reachedReady = true
				before := strings.TrimSpace(text[:index])
				before = strings.ReplaceAll(before, promptMarker, "")
				before = common.StripANSI(strings.TrimSpace(before))
				return before, nil
			}
		case <-timer.C:
			cleaned := strings.ReplaceAll(output.String(), promptMarker, "")
			return common.StripANSI(strings.TrimSpace(cleaned)), errors.New("sudo shell 啟動逾時")
		case <-t.closed:
			cleaned := strings.ReplaceAll(output.String(), promptMarker, "")
			return common.StripANSI(strings.TrimSpace(cleaned)), errors.New("Terminal session 已關閉")
		}
	}
}

func (t *session) drain() {
	for {
		select {
		case <-t.output:
		default:
			return
		}
	}
}

func (t *session) close() {
	select {
	case <-t.closed:
	default:
		close(t.closed)
	}
	if t.stdin != nil {
		t.stdin.Close()
	}
	if t.session != nil {
		t.session.Close()
	}
	if t.client != nil {
		t.client.Close()
	}
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
}
