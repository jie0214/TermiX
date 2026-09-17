# Terminal 與 Control Panel 版面回歸檢查

此頁使用實際的 `TermixApp` 版面、側欄開關、`TerminalPage` 與 xterm 渲染器，僅以測試資料取代連線與後端呼叫，不連線到主機。它是 Vite 開發環境的測試入口，不納入正式建置入口。

1. 在專案根目錄執行 `npm run dev --prefix frontend -- --host 127.0.0.1`。
2. 開啟 `http://127.0.0.1:5173/support/terminal-layout-check.html?scale=1`。
3. 按「執行版面診斷」，等待右下角顯示 `PASS` 或 `FAIL`。
4. 分別以 `scale=0.9`、`scale=1.1` 與 `scale=1.25` 重跑。

每次檢查會寫入測試長行文字，執行 3 次開啟及關閉，等待側欄動畫完成後量測畫布是否超出 pane 或視窗右緣。允許不超過 1 px 的量測誤差；任一階段溢出即為 `FAIL`。結果也會寫入 `#report` 的 `data-status`，供瀏覽器自動化等待與斷言。

此檢查針對前端繪製範圍，不驗證遠端 PTY 尺寸通知、shell 重繪或原生 WebView 行為。
