package terminal

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jie0214/TermiX/shared/constants"
	"github.com/jie0214/TermiX/shared/dto"
)

func TestLocalTerminalCommandUsesExecutableAbsolutePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "custom-shell")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	cmd, err := localTerminalCommand("  " + path + "  ")
	if err != nil {
		t.Fatalf("localTerminalCommand() error = %v", err)
	}
	if cmd.Path != path || len(cmd.Args) != 2 || cmd.Args[1] != "-l" {
		t.Fatalf("localTerminalCommand() = Path %q Args %v", cmd.Path, cmd.Args)
	}
}

func TestLocalTerminalCommandRejectsInvalidPaths(t *testing.T) {
	nonExecutable := filepath.Join(t.TempDir(), "shell")
	if err := os.WriteFile(nonExecutable, []byte("#!/bin/sh\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "relative", path: "bin/sh", want: "絕對路徑"},
		{name: "missing", path: filepath.Join(t.TempDir(), "missing"), want: "不存在"},
		{name: "directory", path: t.TempDir(), want: "一般檔案"},
		{name: "not executable", path: nonExecutable, want: "執行權限"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := localTerminalCommand(test.path); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("localTerminalCommand(%q) error = %v", test.path, err)
			}
		})
	}
}

func TestStartLocalUsesSelectedShell(t *testing.T) {
	manager := NewManager(nil)
	result := manager.StartLocal("/bin/sh")
	if !result.Success {
		t.Fatalf("StartLocal() error = %s", result.Error)
	}
	defer manager.Close(result.SessionKey)

	manager.mu.Lock()
	session := manager.sessions[result.SessionKey]
	manager.mu.Unlock()
	if session == nil || session.cmd == nil || session.cmd.Path != "/bin/sh" {
		t.Fatalf("StartLocal() session shell = %+v", session)
	}
}

func TestStartLocalDoesNotInjectInitializationCommands(t *testing.T) {
	manager := NewManager(nil)
	result := manager.StartLocal("/bin/sh")
	if !result.Success {
		t.Fatalf("StartLocal() error = %s", result.Error)
	}
	defer manager.Close(result.SessionKey)

	manager.mu.Lock()
	session := manager.sessions[result.SessionKey]
	manager.mu.Unlock()
	if session == nil {
		t.Fatal("StartLocal() did not register session")
	}

	session.mu.Lock()
	session.isExecuting = true
	session.mu.Unlock()
	time.Sleep(200 * time.Millisecond)
	session.mu.Lock()
	session.isExecuting = false
	session.mu.Unlock()

	var output strings.Builder
	for {
		select {
		case chunk := <-session.output:
			output.WriteString(chunk)
		default:
			text := output.String()
			for _, forbidden := range []string{"stty erase", "command not found"} {
				if strings.Contains(text, forbidden) {
					t.Fatalf("StartLocal() injected %q into PTY output: %q", forbidden, text)
				}
			}
			return
		}
	}
}

func TestStartLocalPTYUsesDeleteAsErase(t *testing.T) {
	manager := NewManager(nil)
	result := manager.StartLocal("/bin/sh")
	if !result.Success {
		t.Fatalf("StartLocal() error = %s", result.Error)
	}
	defer manager.Close(result.SessionKey)

	status := manager.ExecuteCommand(result.SessionKey, "stty -a")
	if !status.Success {
		t.Fatalf("stty -a error = %s output = %q", status.Error, status.Output)
	}
	if !strings.Contains(status.Output, "erase = ^?") {
		t.Fatalf("Local PTY erase 設定不是 DEL：%q", status.Output)
	}
}

func TestNormalizeCommandAddsYesToAptInstall(t *testing.T) {
	tests := []struct {
		name    string
		command string
		want    string
	}{
		{
			name:    "apt install",
			command: "sudo apt install nginx",
			want:    "sudo apt install -y nginx",
		},
		{
			name:    "apt-get install",
			command: "sudo apt-get install postgresql",
			want:    "sudo apt-get install -y postgresql",
		},
		{
			name:    "already yes",
			command: "sudo apt install -y nginx",
			want:    "sudo apt install -y nginx",
		},
		{
			name:    "unrelated command",
			command: "systemctl status nginx",
			want:    "systemctl status nginx",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizeCommand(tc.command); got != tc.want {
				t.Fatalf("normalizeCommand() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSudoInjectionForSnippetRunCommands(t *testing.T) {
	if got := injectNonInteractiveSudo("sudo systemctl restart nginx"); got != "sudo -n systemctl restart nginx" {
		t.Fatalf("injectNonInteractiveSudo() = %q", got)
	}

	withPassword := injectSudoPassword("sudo systemctl restart nginx", "p@ss word")
	want := "printf %s 'p@ss word\n' | sudo -S -p '' systemctl restart nginx"
	if withPassword != want {
		t.Fatalf("injectSudoPassword() = %q, want %q", withPassword, want)
	}

	withPasswordNonInteractive := injectSudoPassword("sudo -n true && echo ok", "p@ss word")
	wantNonInteractive := "printf %s 'p@ss word\n' | sudo -S -p '' true && echo ok"
	if withPasswordNonInteractive != wantNonInteractive {
		t.Fatalf("injectSudoPassword(sudo -n) = %q, want %q", withPasswordNonInteractive, wantNonInteractive)
	}

	withoutSudo := injectSudoPassword("systemctl status nginx", "p@ss word")
	if withoutSudo != "systemctl status nginx" {
		t.Fatalf("injectSudoPassword() changed non-sudo command: %q", withoutSudo)
	}
}

func TestSudoShellCommandForcesCurrentPtyPrompt(t *testing.T) {
	got := sudoShellCommand("__PROMPT__", "__READY__")
	if !strings.Contains(got, "sudo -k -S -p '__PROMPT__' bash -lc ") {
		t.Fatalf("sudoShellCommand() should force password prompt from current PTY stdin: %q", got)
	}
	if !strings.Contains(got, "__READY__") || !strings.Contains(got, "exec bash -i") {
		t.Fatalf("sudoShellCommand() should bootstrap interactive root shell with ready marker: %q", got)
	}
	if strings.Contains(got, "p@ss word") {
		t.Fatalf("sudoShellCommand() should not inline sudo password into command: %q", got)
	}
}

func TestCommandOutputHasLineIgnoresPromptNoise(t *testing.T) {
	output := "root@rsg:/home/user# \r\n\r\nroot\r\nroot@rsg:/home/user# \r\n"
	if !commandOutputHasLine(output, "root") {
		t.Fatalf("commandOutputHasLine() should detect standalone root in noisy PTY output: %q", output)
	}
	if commandOutputHasLine(output, "user") {
		t.Fatalf("commandOutputHasLine() should require standalone line match: %q", output)
	}
}

func TestStartSudoShellSucceedsWhenReadyArrivesWithoutPrompt(t *testing.T) {
	writer := &recordingWriteCloser{}
	terminal := &session{
		stdin:        writer,
		output:       make(chan string, 8),
		closed:       make(chan struct{}),
		sudoPassword: "p@ss word",
	}

	type result struct {
		output string
		err    error
	}
	done := make(chan result, 1)
	go func() {
		output, err := terminal.startSudoShell(2 * time.Second)
		done <- result{output: output, err: err}
	}()

	waitForWriterContains(t, writer, "sudo -k -S -p '"+sudoPromptMarker(1)+"' bash -lc ")
	terminal.output <- "\r\n" + sudoReadyMarker(1) + "\r\n"

	res := <-done
	if res.err != nil {
		t.Fatalf("startSudoShell() error = %v, want nil", res.err)
	}
	if strings.Contains(writer.String(), "p@ss word\n") {
		t.Fatalf("startSudoShell() should not send password before prompt marker: %q", writer.String())
	}
}

func TestStartSudoShellRespondsToPromptAndWaitsReady(t *testing.T) {
	writer := &recordingWriteCloser{}
	terminal := &session{
		stdin:        writer,
		output:       make(chan string, 8),
		closed:       make(chan struct{}),
		sudoPassword: "p@ss word",
	}

	type result struct {
		output string
		err    error
	}
	done := make(chan result, 1)
	go func() {
		output, err := terminal.startSudoShell(2 * time.Second)
		done <- result{output: output, err: err}
	}()

	waitForWriterContains(t, writer, "sudo -k -S -p '"+sudoPromptMarker(1)+"' bash -lc ")
	terminal.output <- sudoPromptMarker(1)
	waitForWriterContains(t, writer, "p@ss word\n")
	terminal.output <- "\r\n" + sudoReadyMarker(1) + "\r\n"

	res := <-done
	if res.err != nil {
		t.Fatalf("startSudoShell() error = %v, want nil", res.err)
	}
	if res.output != "" {
		t.Fatalf("startSudoShell() output = %q, want empty", res.output)
	}
	if !strings.Contains(writer.String(), "stty -echo 2>/dev/null\n") {
		t.Fatalf("startSudoShell() should disable echo before bootstrap: %q", writer.String())
	}
}

func TestStartSudoShellRestoresEchoOnTimeout(t *testing.T) {
	writer := &recordingWriteCloser{}
	terminal := &session{
		stdin:        writer,
		output:       make(chan string, 4),
		closed:       make(chan struct{}),
		sudoPassword: "p@ss word",
	}

	output, err := terminal.startSudoShell(50 * time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "sudo shell 啟動逾時") {
		t.Fatalf("startSudoShell() error = %v, want timeout", err)
	}
	if output != "" {
		t.Fatalf("startSudoShell() output = %q, want empty on timeout", output)
	}
	if !strings.Contains(writer.String(), "stty echo 2>/dev/null\n") {
		t.Fatalf("startSudoShell() should restore echo on timeout: %q", writer.String())
	}
}

func TestParseCommandResultIgnoresEchoedDoneMarker(t *testing.T) {
	startMarker := "__TERMIX_START_3__"
	doneMarker := "__TERMIX_DONE_3__"
	text := "root@rsg:/home/manage# printf '\\n" + startMarker + "\\n'\r\n" +
		"\r\n" + startMarker + "\r\n" +
		"root\r\n" +
		"root@rsg:/home/manage# printf '\\n" + doneMarker + ":%s\\n' \"$status\"\r\n" +
		"\r\n" + doneMarker + ":0\r\n" +
		"root@rsg:/home/manage# "

	before, status, found, err := parseCommandResult(text, startMarker, doneMarker)
	if err != nil {
		t.Fatalf("parseCommandResult() error = %v", err)
	}
	if !found {
		t.Fatalf("parseCommandResult() found = false, want true")
	}
	if status != "0" {
		t.Fatalf("parseCommandResult() status = %q, want 0", status)
	}
	if strings.TrimSpace(before) != "root" {
		t.Fatalf("parseCommandResult() before = %q, want root", before)
	}
}

func TestParseCommandResultFiltersRootShellPrompts(t *testing.T) {
	startMarker := "__TERMIX_START_4__"
	doneMarker := "__TERMIX_DONE_4__"
	text := "root@rsg:/home/user# \r\n" +
		"\r\n" + startMarker + "\r\n" +
		"root@rsg:/home/user# \r\n" +
		"\r\nroot\r\n" +
		"root@rsg:/home/user# \r\n" +
		"\r\n" + doneMarker + ":0\r\n"

	before, status, found, err := parseCommandResult(text, startMarker, doneMarker)
	if err != nil {
		t.Fatalf("parseCommandResult() error = %v", err)
	}
	if !found || status != "0" {
		t.Fatalf("parseCommandResult() found=%v status=%q, want true 0", found, status)
	}
	if before != "root" {
		t.Fatalf("parseCommandResult() before = %q, want root", before)
	}
}

func TestExecuteIgnoresEchoedDoneMarkerUntilStandaloneNumericLine(t *testing.T) {
	writer := &recordingWriteCloser{}
	terminal := &session{
		stdin:  writer,
		output: make(chan string, 8),
		closed: make(chan struct{}),
	}

	type result struct {
		output string
		err    error
	}
	done := make(chan result, 1)
	go func() {
		output, err := terminal.execute("whoami", 2*time.Second)
		done <- result{output: output, err: err}
	}()

	waitForWriterContains(t, writer, "printf '\\n__TERMIX_DONE_1__:%s\\n' \"$status\"\n")

	terminal.output <- "root@rsg:/home/manage# printf '\\n__TERMIX_START_1__\\n'\r\n"
	terminal.output <- "\r\n__TERMIX_START_1__\r\n"
	terminal.output <- "root\r\n"
	terminal.output <- "printf '\\n__TERMIX_DONE_1__:%s\\n' \"$status\"\r\n"

	select {
	case res := <-done:
		t.Fatalf("execute() returned early with output = %q, err = %v", res.output, res.err)
	case <-time.After(50 * time.Millisecond):
	}

	terminal.output <- "\r\n__TERMIX_DONE_1__:0\r\n"

	res := <-done
	if res.err != nil {
		t.Fatalf("execute() error = %v, want nil", res.err)
	}
	if strings.TrimSpace(res.output) != "root" {
		t.Fatalf("execute() output = %q, want root", res.output)
	}
}

func TestWriteInputPreservesPasteString(t *testing.T) {
	writer := &recordingWriteCloser{}
	manager := NewManager(nil)
	manager.sessions["session-1"] = &session{
		key:   "session-1",
		stdin: writer,
	}

	input := "echo \"hello from snippet\"\n"
	manager.WriteInput("session-1", input)

	// WriteInput 現以背景 goroutine 執行實際寫入（加寫入逾時，避免半死連線卡住），
	// 因此以 String()（受鎖保護、避免 data race）輪詢等待寫入完成後再比對。
	waitForWriterContains(t, writer, input)
	if got := writer.String(); got != input {
		t.Fatalf("WriteInput() wrote %q, want %q", got, input)
	}
}

func TestCancelConnectBeforeSessionRegistration(t *testing.T) {
	manager := NewManager(nil)
	config := dto.SSHConfig{
		Host:      "127.0.0.1",
		Port:      22,
		Username:  "tester",
		AuthMode:  constants.AuthModePassword,
		Password:  "secret",
		SessionID: "pending-cancel",
	}

	manager.CancelConnect(config)
	_, _, _, err := manager.getSession(config)
	if err == nil || !strings.Contains(err.Error(), "連線已被使用者取消") {
		t.Fatalf("getSession() error = %v, want user cancel", err)
	}
	if _, exists := manager.pendingCancels[SessionKey(config)]; exists {
		t.Fatalf("pending cancel should be consumed")
	}
}

func TestCancelOrErr(t *testing.T) {
	original := errors.New("sudo shell 啟動失敗：session 已關閉")

	// 未取消時原樣回傳，握手後階段的真實錯誤不被掩蓋。
	if got := cancelOrErr(context.Background(), original); got != original {
		t.Fatalf("cancelOrErr(active) = %v, want passthrough", got)
	}

	// ctx 已被使用者取消時，翻譯成與 dial/握手階段一致的取消訊息。
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got := cancelOrErr(ctx, original)
	if got == nil || !strings.Contains(got.Error(), "連線已被使用者取消") {
		t.Fatalf("cancelOrErr(canceled) = %v, want user cancel message", got)
	}
}

type recordingWriteCloser struct {
	value string
	mu    sync.Mutex
}

func (w *recordingWriteCloser) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.value += string(p)
	return len(p), nil
}

func (w *recordingWriteCloser) Close() error {
	return nil
}

func (w *recordingWriteCloser) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.value
}

func waitForWriterContains(t *testing.T, writer *recordingWriteCloser, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(writer.String(), want) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("writer output %q does not contain %q", writer.String(), want)
}

var _ io.WriteCloser = (*recordingWriteCloser)(nil)
