# TermiX 打包指令

TermiX 使用 **Wails v2** 打包（Go 後端 + Vite／前端）。以下指令在本機執行（Go 版本以 `go.mod` 為準，並需安裝 Node.js 24+／npm）。

輸出檔名與版本由 `wails.json` 的 `outputfilename` 與 `info.productVersion` 定義。

---

## 前置需求（第一次才需要）

```bash
# 安裝 Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0

# 檢查環境是否齊全（Go / Node / npm / 平台相依）
wails doctor

# 安裝前端依賴
npm ci --ignore-scripts --prefix frontend
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

1. 後端格式、測試與靜態分析：

   ```bash
   go fmt ./... && git diff --exit-code
   go test ./...
   go test -race ./...
   go vet ./...
   ```

   macOS 系統鑰匙圈整合測試預設略過，需明確設定 `TERMIX_KEYCHAIN_INTEGRATION=1` 才會寫入實體鑰匙圈。

   編譯不過會直接擋住 `wails build`。

2. 前端測試、型別與建置：

   ```bash
   npm test --prefix frontend
   npm run typecheck --prefix frontend   # tsc --noEmit
   npm run build --prefix frontend       # 確認 vite build 可過
   npm audit --prefix frontend --audit-level=moderate
   ```

3. `wails build` 使用的是工作目錄現況（含未提交改動）。要正式發佈前，建議先 `git commit` 確保版本可追溯。

---

## 備註

- 推送 `v*` tag 後，`.github/workflows/release.yml` 會驗證原始碼、建置 macOS／Windows／Linux 壓縮檔並建立 GitHub Release。
- 現行自動發行產物尚未做程式碼簽章、公證或安裝程式；相關指令僅供手動流程參考。
