package aiagent

import (
	"os/exec"
	"strconv"
	"syscall"
)

func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Cancel = func() error {
		// /T 連同 Node shim 啟動的子程序一起結束。
		kill := exec.Command("taskkill.exe", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
		kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if err := kill.Run(); err != nil {
			return cmd.Process.Kill()
		}
		return nil
	}
}
