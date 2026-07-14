package controlpanel

import (
	"bytes"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"github.com/jie0214/TermiX/shared/dto"
	"runtime"
	"strings"
	"time"
)

const unsafeLocalCommandEnv = "TERMIX_ALLOW_UNSAFE_LOCAL_COMMANDS"
const defaultLocalCommandTimeout = 5 * time.Second
const openLocalCommandTimeout = 20 * time.Second

type Executor struct{}

func NewExecutor() *Executor {
	return &Executor{}
}

func (e *Executor) ExecuteLocalCommand(command string, env map[string]string) dto.OperationResult {
	command = strings.TrimSpace(command)
	if command == "" {
		return dto.OperationResult{Success: false, Error: "本機指令不可空白"}
	}
	command = strings.ReplaceAll(command, "—", "--")

	var cmd *exec.Cmd
	timeout := defaultLocalCommandTimeout
	if strings.HasPrefix(command, "open ") {
		arg := strings.TrimPrefix(command, "open ")
		arg = strings.TrimSpace(arg)
		arg = strings.Trim(arg, "\"'")
		if strings.Contains(arg, "$") {
			return dto.OperationResult{Success: false, Error: "本機 open 指令包含未展開的變數，請確認遠端輸出已成功映射到 exportVars。"}
		}
		if err := validateOpenTarget(arg); err != nil {
			return dto.OperationResult{Success: false, Error: err.Error()}
		}
		cmd = openCommand(arg)
		timeout = openLocalCommandTimeout
	} else {
		if os.Getenv(unsafeLocalCommandEnv) != "1" {
			return dto.OperationResult{
				Success: false,
				Error:   "基於安全限制，TermiX 預設只允許 FunctionBox 執行本機 open 指令。若確定需要執行任意本機 shell 指令，請以 TERMIX_ALLOW_UNSAFE_LOCAL_COMMANDS=1 啟動應用程式。",
			}
		}
		cmd = shellCommand(command)
	}
	cmd.Env = os.Environ()
	for key, value := range env {
		if key == "" {
			continue
		}
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, value))
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return dto.OperationResult{Success: false, Error: err.Error()}
	}

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	select {
	case err := <-done:
		output := stdout.String() + stderr.String()
		if err != nil {
			return dto.OperationResult{Success: false, Output: output, Error: err.Error()}
		}
		return dto.OperationResult{Success: true, Output: output}
	case <-time.After(timeout):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return dto.OperationResult{Success: false, Error: "本機指令執行逾時，程序已中止。"}
	}
}

// openCommand 依作業系統回傳開啟 URL 的指令。FunctionBox 的「open」是邏輯動詞，
// 各平台轉譯為對應開啟器：macOS 用 open、Windows 用 cmd /c start、其餘用 xdg-open。
func openCommand(target string) *exec.Cmd {
	switch runtime.GOOS {
	case "windows":
		// start 會把第一個引號字串當成視窗標題，故補一個空標題再帶 URL。
		return exec.Command("cmd", "/c", "start", "", target)
	case "darwin":
		return exec.Command("open", target)
	default:
		return exec.Command("xdg-open", target)
	}
}

// shellCommand 依作業系統回傳執行任意指令的 shell。Windows 沒有 /bin/bash，改用 cmd /c。
func shellCommand(command string) *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("cmd", "/c", command)
	}
	return exec.Command("/bin/bash", "-lc", command)
}

func validateOpenTarget(target string) error {
	parsed, err := url.Parse(target)
	if err != nil || parsed.Scheme == "" {
		return fmt.Errorf("本機 open 指令只允許 rustdesk、http 或 https URL")
	}
	switch parsed.Scheme {
	case "rustdesk", "http", "https":
		return nil
	default:
		return fmt.Errorf("本機 open 指令不允許 URL scheme：%s", parsed.Scheme)
	}
}
