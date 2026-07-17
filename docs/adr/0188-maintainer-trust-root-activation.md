# 0188. 啟用維護者信任根（填入 MAINTAINER_PUBKEY）

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：ADR-0039（混合式引導路由／簽章清單信任根）、ADR-0092（節點提交與分級收錄）、ADR-0069（自動選座 I4）、`docs/MAINTAINER-ACTIVATION.md`

## 背景與問題

簽章 relay 清單機制（ADR-0039／0092）程式已完整，但一直**休眠**：`packages/engine/src/bootstrap-config.ts` 的 `MAINTAINER_PUBKEY` 為空 → 客戶端不訂閱、不學帶內清單，第三方自架 relay 無從被自動選座池收錄。

要讓池子上線，必須公佈**維護者信任根公鑰**。維護者已在本機以 `pnpm --filter @cinder/relay genkey:maintainer` 產生一把**專用**金鑰（nsec 只落地本機檔＋離線備份，永不進 code／聊天），本 ADR 記錄選定其**公鑰**為信任根。

## 考量的選項

- **選項 A（維持空值休眠）**：安全但池子永遠開不了、第三方申請無出口。
- **選項 B（填入專用維護者公鑰）**：點亮信任根，客戶端重建後即訂閱 `kind 10037`（`RELAY_LIST_KIND`）並以 `verifyRelayList` 驗簽採用。**採用**。
- 金鑰來源：專用金鑰（本 ADR）vs. 複用既有身分金鑰 → 選**專用**（信任根不與任何個人/訊息身分混用，降低關聯與外洩衝擊面）。

## 決策

於 `bootstrap-config.ts` 設：

```ts
export const MAINTAINER_PUBKEY = "6efd2603d1d01ebe159410ab12e6f840268cf874015c75a779928a5b397a0e65";
```

- 桌面（`apps/desktop/src/App.tsx`）與行動端（`apps/mobile/src/backend.ts`）在非空時帶 `maintainerPubkey` 給後端；後端訂閱該作者的 `RELAY_LIST_KIND` 事件、`verifyRelayList` 驗簽後才採用清單。
- 對應私鑰**只**存為 GitHub Actions secret `MAINTAINER_NSEC`（＋離線備份），絕不進 code。
- 啟用其餘步驟見 `docs/MAINTAINER-ACTIVATION.md`（設 secret → `relays.json` 收錄首座 → 重建客戶端 → 驗證）。

## 理由

- 這是把已驗證的機制從休眠轉為運作的最小、可逆一步；公鑰可公開，填入不洩漏任何機密。
- 專用金鑰讓信任根與個人身分脫鉤：即使公鑰被關聯到「維護者」角色，也不牽連其他身分。
- **非破壞**：此刻 `relays.json` 仍空、`MAINTAINER_NSEC` 未設 → 客戶端會訂閱但找不到已簽清單 → 退回既有 `ANCHOR_RELAYS` 行為，直到清單被填入並簽章。

## 後果

- 正面：簽章池可上線；`docs/NODE-SUBMISSION.md` 的第三方申請路徑變為真實可用。
- 負面 / 已知殘餘風險：
  - **信任根風險**：持有 `MAINTAINER_NSEC` 者可簽出客戶端自動採用的清單；外洩＝可導流客戶端至攻擊者 relay（元資料收割／eclipse）。防護見 `MAINTAINER-ACTIVATION.md`（專用、離線備份、線上唯一副本＝GitHub secret）。
  - `MAINTAINER_PUBKEY` 為**編譯期常數**：生效需**重建並重新部署**桌面/行動/CLI/官網；**輪替**同樣需重建，須事前規劃過渡（新舊清單並存）。
- 後續行動 / 待辦：
  1. 設 GitHub secret `MAINTAINER_NSEC`。
  2. `relay/bootstrap/relays.json` 收錄首座候選（人管加入；建議日後 ≥2 座不同網域）。
  3. 重建並重新部署客戶端。
  4. 手動觸發 `relay-health.yml` 驗證簽章與帶內發佈。
