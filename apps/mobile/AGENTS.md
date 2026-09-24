# 手機版開發規則

- 使用 React Native、TypeScript 與 Expo，功能採跨平台介面，原生差異集中於平台接入。
- 路由使用 Expo Router，放在 `src/app`；業務行為放在 `src/features`，共用元件放在 `src/components`。
- 修改 Expo API 前，先讀取 package.json 的 SDK 主版本並查閱對應版本的官方文件。
- 安裝依賴使用 `npx expo install`，維持 SDK 相容版本；提交 lockfile。
- 原生工程透過 Expo prebuild 產生，禁止直接修改產生的 iOS／Android 工程；使用應用程式設定或 config plugin。
- 完成前執行 `npm run typecheck`、`npm run lint`、`npm test` 與對應打包檢查。
- 測試使用公開功能與使用者操作邊界；可替換外部儲存或原生服務，不耦合內部實作。
- 密碼、私鑰、passphrase 與 token 不得存入一般 SQLite、日誌或同步資料；未實作功能不得呈現假的成功狀態。
- 說明文件、註解與 commit 描述使用台灣繁體中文。
