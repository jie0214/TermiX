# 建置依賴安全修補

審查日期：2026-10-05。這是 TermiX 維護的本機修補，不是套件作者已發佈的修正版。保留原套件版本及授權，避免改版本號掩蓋公告。

| 套件 | 公告與參考 | 修補範圍 |
| --- | --- | --- |
| `braces@3.0.3` | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)、[上游提案 #75](https://github.com/micromatch/braces/pull/75) | 解析堆疊、compile、expand、stringify、陣列展平及 append 遞迴加入固定 64 層限制。直接傳入 AST 也受限制；`maxDepth` 不能停用此安全上限。超深輸入會拋出可辨識的 RangeError，呼叫端仍須處理錯誤。 |
| `node-forge@1.4.0` | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)、[上游提案 #1152，commit ceba344](https://github.com/digitalbazaar/forge/pull/1152) | 回補內層 DigestAlgorithm 元素數量檢查，拒絕 OID 與可選 NULL 以外的多餘元素。 |

`braces` 修補參考上游深度防護方向，另外涵蓋該提案未處理的解析及 stringify 入口；不是原樣套用尚未合併的 PR。深度上限是行為限制，極深的合法模式也會被拒絕。`node-forge` 保留原有演算法、填補與 ASN.1 驗證，只增加結構檢查。

## 套用與驗證

1. `npm ci` 的專案 `postinstall` 執行 `scripts/dependency-patches.mjs --apply`。
2. `security/dependency-patches.json` 固定套件版本、npm tarball integrity，以及各檔案修補前後的 SHA-256 與替換內容。
3. 套用器檢查 lockfile 中每一份目標套件。只接受原始或已修補的指定內容；版本、來源、內容或替換位置不同就停止，不猜測合併。
4. `npm run test:dependencies` 測試實際安裝的每份目標套件，涵蓋漏洞重現、正常輸入、乾淨安裝、重複套用、篡改、版本差異及 audit 判定邊界。
5. `npm run test:security` 先驗證修補雜湊並跑安全回歸，再查即時 npm audit，最後執行原有 Go 漏洞掃描與 Swift 敏感匯入清理測試。

若安裝時使用 `--ignore-scripts`，修補不會自動套用；發佈安全檢查會阻擋缺少修補的安裝。手動恢復方式是先執行 `node scripts/dependency-patches.mjs --apply`，再跑完整安全檢查。

## audit 判定與停止條件

原始 `npm audit` 仍依版本報告這兩個公告。專案檢查不修改 audit 資料、不提高嚴重程度門檻，也不將整個套件列入無條件忽略清單。

僅當公告 ID、套件名稱、已驗證安裝位置及完整回歸測試都符合，才將該公告及其依賴傳播視為已有本機修補。依賴圖可包含循環，但必須追溯到實際公告；所有可到達的中度以上公告都必須符合修補條件。

下列情況仍停止：新的中度以上公告、未知安裝位置、修補缺失或遭修改、套件來源／版本變更、回歸失敗、audit 服務失敗、回應格式或統計不一致、依賴節點缺失，或無法追溯到公告的循環。Go 或 Swift 檢查失敗也維持阻擋。

未來上游發佈修正版時，先驗證相容性及同一組漏洞回歸，再移除相應修補與公告判定。每次依賴升級都要重新審查；本機修補不代表套件不存在其他漏洞。
