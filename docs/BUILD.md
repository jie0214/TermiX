# TermiX 打包指令

TermiX 使用 **Wails v2** 打包（Go 後端 + Vite/前端）。以下指令在本機執行（需已安裝 Go 1.25+ 與 Node.js/npm）。

輸出檔名與版本由 `wails.json` 定義：`outputfilename: TermiX`、`productVersion: 1.0.0`。

---

## 前置需求（第一次才需要）

```bash
# 安裝 Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 檢查環境是否齊全（Go / Node / npm / 平台相依）
wails doctor

# 安裝前端依賴
npm install --prefix frontend
```

---

## 標準打包（macOS）

```bash
cd /Users/charlotte/Documents/github/TermiX
wails build
```

`wails build` 會自動執行 `wails.json` 的 `frontend:build`（`npm run build`）再編譯 Go，輸出：

```text
build/bin/TermiX.app
```

---

## 常用選項

```bash
wails build -clean                        # 先清空 build/bin 再打包
wails build -platform darwin/universal    # Intel + Apple Silicon 通用二進位
wails build -platform darwin/arm64        # 只打 Apple Silicon
wails build -platform darwin/amd64        # 只打 Intel
wails build -platform windows/amd64       # 產出 TermiX.exe
wails build -platform linux/amd64         # Linux
wails build -upx                          # 用 UPX 壓縮體積（需先安裝 upx）
wails build -s                            # 跳過前端建置（前端已 build 過時加速）
```

---

## 安裝包 / 簽章（Wails 不內建，需外接工具）

```bash
# Windows 安裝檔
wails build -platform windows/amd64 -nsis

# macOS DMG（需另裝 create-dmg）
create-dmg build/bin/TermiX.dmg build/bin/TermiX.app

# macOS 簽章 + 公證（需 Apple 開發者帳號）
codesign --deep --force --options runtime \
  --sign "Developer ID Application: <你的名稱>" build/bin/TermiX.app
xcrun notarytool submit build/bin/TermiX.app \
  --apple-id <id> --team-id <team> --wait
```

---

## 開發模式（非打包，供對照）

```bash
wails dev                                        # 啟動整體桌面應用（熱重載）
npm run dev --prefix frontend -- --host 127.0.0.1  # 僅啟動前端開發伺服器
```

---

## 打包前建議檢查

1. 後端編譯與測試（本專案後端多為靜態審查，發佈前務必在本機實跑）：

   ```bash
   go build ./...
   go vet ./...
   go test -race ./backend/...
   ```

   編譯不過會直接擋住 `wails build`。

2. 前端型別與建置：

   ```bash
   npm run typecheck --prefix frontend   # tsc --noEmit
   npm run build --prefix frontend       # 確認 vite build 可過
   ```

3. `wails build` 使用的是工作目錄現況（含未提交改動）。要正式發佈前，建議先 `git commit` 確保版本可追溯。

---

## 備註

- 目前專案沒有自動部署管線，標準發佈方式即手動 `wails build`。
- 若要進一步做簽章、公證或安裝包，需在 `build/bin` 輸出結果外自行接入發佈流程。
