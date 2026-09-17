package app

import (
	"github.com/jie0214/TermiX/backend/terminal"
	"runtime"
	"testing"
)

func TestPendingOperationDefersUpdateWithoutFreezingApp(t *testing.T) {
	a := &App{}
	if !a.beginOperation() {
		t.Fatal("初次操作被拒絕")
	}
	if a.prepareClose(func(string) bool { t.Fatal("尚未完成操作不應允許強制重啟"); return true }) {
		t.Fatal("操作未完成仍允許重啟")
	}
	a.endOperation()
	if !a.beginOperation() {
		t.Fatal("延後更新後 App 應繼續可用")
	}
	a.endOperation()
	if !a.prepareClose(func(string) bool { return true }) {
		t.Fatal("閒置後無法結束")
	}
	if a.beginOperation() {
		t.Fatal("更新準備完成後仍可建立新操作")
	}
}

func TestNativeUpdateRouting(t *testing.T) {
	a := &App{}
	if a.HandleNativeUpdateCheck(false) {
		t.Fatal("沒有原生更新器時不可攔截")
	}
	checks, settings := 0, 0
	SetNativeUpdater(a, func() { checks++ }, func() { settings++ })
	if !a.HandleNativeUpdateCheck(false) || checks != 0 {
		t.Fatal("啟動時應交由 Sparkle 自動排程，不重複手動檢查")
	}
	if !a.HandleNativeUpdateCheck(true) || checks != 1 {
		t.Fatal("手動檢查未轉交 Sparkle")
	}
	a.ShowNativeUpdateSettings()
	if settings != 1 {
		t.Fatal("設定未轉交 Sparkle")
	}
}

func TestAbortedUpdateRestoresOperations(t *testing.T) {
	a := &App{}
	if !a.prepareClose(func(string) bool { return true }) {
		t.Fatal("無法準備更新")
	}
	CancelPreparedClose(a)
	if !a.beginOperation() {
		t.Fatal("更新失敗後操作仍被凍結")
	}
	a.endOperation()
}

func TestLocalSessionCloseRequiresConfirmation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("此案例使用 POSIX shell")
	}
	manager := terminal.NewManager(nil)
	session := manager.StartLocal("/bin/sh")
	if !session.Success {
		t.Fatal(session.Error)
	}
	defer manager.CloseAll()
	a := &App{terminal: manager}
	confirmed := false
	if a.prepareClose(func(string) bool {
		confirmed = true
		if a.beginOperation() {
			t.Error("確認期間不得啟動新操作")
			a.endOperation()
		}
		return false
	}) {
		t.Fatal("取消後仍結束")
	}
	if !confirmed || manager.ActiveSessionCount() != 1 {
		t.Fatal("取消後沒有保留原連線")
	}
	if !a.beginOperation() {
		t.Fatal("取消後未解除操作限制")
	}
	a.endOperation()
	if !a.prepareClose(func(string) bool { return true }) {
		t.Fatal("確認中斷後未繼續")
	}
	if manager.ActiveSessionCount() != 0 {
		t.Fatal("未清理本機終端")
	}
}
