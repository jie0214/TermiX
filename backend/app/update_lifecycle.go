package app

import (
	"fmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) beginOperation() bool {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	if a.closing {
		return false
	}
	a.pendingOperations++
	return true
}
func (a *App) endOperation() { a.updateMu.Lock(); a.pendingOperations--; a.updateMu.Unlock() }

// SetNativeUpdater 由原生啟動流程註冊，避免將函式暴露為 Wails binding。
func SetNativeUpdater(a *App, check, settings func()) {
	a.updateMu.Lock()
	defer a.updateMu.Unlock()
	a.nativeUpdateCheck, a.nativeUpdateSettings = check, settings
}
func (a *App) HandleNativeUpdateCheck(manual bool) bool {
	a.updateMu.Lock()
	check := a.nativeUpdateCheck
	a.updateMu.Unlock()
	if check == nil {
		return false
	}
	if manual {
		check()
	}
	return true
}
func (a *App) ShowNativeUpdateSettings() {
	a.updateMu.Lock()
	settings := a.nativeUpdateSettings
	a.updateMu.Unlock()
	if settings != nil {
		settings()
	}
}

// PrepareAppClose 同時保護一般結束與更新重啟；凍結新操作後才檢查連線，避免檢查與重啟之間新增工作。
func PrepareAppClose(a *App) bool {
	return a.prepareClose(func(message string) bool {
		answer, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
			Type: runtime.QuestionDialog, Title: "結束 TermiX", Message: message,
			Buttons: []string{"稍後", "中斷並繼續"}, DefaultButton: "稍後", CancelButton: "稍後",
		})
		return err == nil && answer == "中斷並繼續"
	})
}
func (a *App) prepareClose(confirm func(string) bool) bool {
	return a.prepareCloseWithPrompts(confirm, func() {
		if a.ctx != nil {
			_, _ = runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{Type: runtime.InfoDialog, Title: "暫時無法結束或更新", Message: "有連線建立或指令操作尚未完成，請等候完成或取消操作後再試。"})
		}
	})
}

// PrepareUpdateWithPrompts 供 AppKit 主執行緒使用原生同步對話框，避免透過 Wails 排程造成死鎖。
func PrepareUpdateWithPrompts(a *App, confirm func(string) bool, pending func()) bool {
	return a.prepareCloseWithPrompts(confirm, pending)
}
func (a *App) prepareCloseWithPrompts(confirm func(string) bool, pendingPrompt func()) bool {
	a.closeMu.Lock()
	defer a.closeMu.Unlock()
	a.updateMu.Lock()
	if a.closing {
		a.updateMu.Unlock()
		return true
	}
	a.closing = true
	pending := a.pendingOperations
	a.updateMu.Unlock()
	terminals, shells, forwards := 0, 0, 0
	if a.terminal != nil {
		terminals = a.terminal.ActiveSessionCount()
	}
	if a.kubernetes != nil {
		shells, forwards = a.kubernetes.ActiveWorkCount()
	}
	// 執行中的建立連線、遠端命令或資源修改不強制中斷，避免半完成狀態。
	if pending > 0 {
		pendingPrompt()
		a.updateMu.Lock()
		a.closing = false
		a.updateMu.Unlock()
		return false
	}
	if terminals+shells+forwards > 0 && !confirm(fmt.Sprintf("目前有 %d 個終端連線、%d 個 Pod shell 與 %d 個 port-forward。繼續會中斷這些工作；SSH 遠端程序不保證能在重啟後恢復。", terminals, shells, forwards)) {
		a.updateMu.Lock()
		a.closing = false
		a.updateMu.Unlock()
		return false
	}
	if a.terminal != nil {
		a.terminal.CloseAll()
	}
	if a.kubernetes != nil {
		a.kubernetes.Disconnect()
	}
	return true
}

// CancelPreparedClose 讓更新器失敗後仍可重新連線，不會永久停留在結束狀態。
func CancelPreparedClose(a *App) {
	a.closeMu.Lock()
	defer a.closeMu.Unlock()
	a.updateMu.Lock()
	a.closing = false
	a.updateMu.Unlock()
}
