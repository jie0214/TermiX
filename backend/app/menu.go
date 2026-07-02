package app

import (
	"github.com/jie0214/TermiX/shared/events"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func NewMenu(app *App) *menu.Menu {
	appMenu := menu.NewMenu()

	appSubMenu := appMenu.AddSubmenu("TermiX")
	appSubMenu.AddText("關於 TermiX", nil, func(cd *menu.CallbackData) {})
	appSubMenu.AddSeparator()
	appSubMenu.AddText("Settings", keys.CmdOrCtrl(","), func(cd *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, events.EventOpenGlobalSettings)
	})
	appSubMenu.AddSeparator()
	appSubMenu.AddText("隱藏 TermiX", keys.CmdOrCtrl("h"), func(cd *menu.CallbackData) {})
	appSubMenu.AddText("結束", keys.CmdOrCtrl("q"), func(cd *menu.CallbackData) {
		runtime.Quit(app.ctx)
	})

	// 註解原生 EditMenu，交由 WKWebView 原生控制剪貼簿與鍵盤刪除事件，解決生產建置下的雙重事件注入死鎖
	appMenu.Append(menu.EditMenu())
	return appMenu
}
