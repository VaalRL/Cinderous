# 0092. 節點成員自報＋一致性稽核＋簽章可驗證記錄（把「申請/審查/稽核」做成 relay 基礎設施介面）

- 狀態：已接受
- 日期：2026-07-13
- 相關文件：ADR-0039（維護者簽章 relay 清單＝信任根）、0069（分級 relay 分配 accepting/weight/status）、
  0089（NIP-11 營運者自報捐款）、0090（簽章透明度模式）、0075（自架 relay）；
  `packages/core/src/node-attestation.ts`、`relay/bootstrap/conformance.ts`、`relay/bootstrap/health-check.ts`、
  `docs/relay-metadata-observability.md`、`docs/NODE-SUBMISSION.md`

## 背景與問題

第三方節點要加入「官方自動選座池」需維護者收錄進**簽章 relay 清單**（ADR-0039）。此前這是體外人工流程。
需求：把「申請 / 審查 / 稽核」做成 relay 基礎設施的**介面**，讓策展**可規模化、透明、可被社群檢查**。

張力（同 ADR-0090）：一個「申請/審查後台」天然想要**有狀態的中心伺服器**——與零伺服器狀態精神相斥；
且**無法技術性稽核營運者內部**（是否偷記元資料在其機器裡）。

## 決策

**用「拉取式自報 ＋ 黑箱一致性探測 ＋ 簽章可驗證記錄」建介面，不建有狀態審查後台。** 三層皆為既有機制延伸（Fix First）：

### 1. 申請＝可驗證自報（`node-attestation.ts`；擴充 ADR-0089 NIP-11）
- 營運者以**自己的金鑰**簽一份 `CinderNodeDeclaration`（url、contact、region、software、`attests[]` 切結、updatedAt）。
- `signNodeAttestation` / `verifyNodeAttestation`（同 relay-list 簽章模式）：驗簽通過＝可信「此節點自報為此、**可問責**」。
- 「申請」＝**跑起來＋暴露自報（NIP-11 `cinder_node` 或發佈自簽事件）＋把 URL 交給維護者工具**——**拉取式**，無收件伺服器、無申請資料庫。
- **明確界線**：自報**不等於保證誠實**；它提供的是問責身分，不是信任。

### 2. 審查/稽核＝黑箱一致性探測（`relay/bootstrap/conformance.ts`；擴充 health-check）
- 對候選/成員 relay 跑**行為**檢查：`probeLive`（REQ→EOSE）、`probeEphemeralNotStored`（Ephemeral 轉發但不留存）、
  `probeRejectsExpired`（NIP-40 過期不回傳）→ `NodeConformance`。
- **只驗行為**：relay 內部（是否偷記/販售元資料）**技術上無法稽核**；系統的隱私防線是**結構性**的
  （E2E Gift Wrap＋TTL＋P2P 卸載＋多中繼），本就假設 relay 為對手、不依賴其誠信。號稱能驗誠信的介面＝安全劇場。

### 3. 分級收錄決策＋簽章記錄（`evaluateAdmission`；用 ADR-0069 狀態機、ADR-0039 簽章清單）
- `evaluateAdmission(NodeConformance) → { accepting, weight, reasons }`（純函式、可測）：
  liveness→一致性→uptime 逐關；未達門檻落「試用」（`accepting:false`：列進清單供韌性/手動用、但不自動選座），
  達標升為正式收錄與較高權重。**附可公開的理由**。
- 決策落進**維護者簽章的 `relays.json`**（entries：accepting/weight/status）→ 稽核狀態**公開可驗、防竄改**。
- 撤銷快：`draining`→`retired`（既有用戶自動搬離）＋重簽清單，客戶端下次連上即學到。
- **選配（未來）**：比照 ADR-0090 發一份**簽章稽核報告**，讓社群獨立驗證「策展誠實、無偏袒/暗censor」。

## 理由

- **保零狀態＋可驗證**：自報（拉取）＋探測（機器驗行為）＋簽章清單/報告（全世界可查），無需維運審查網站、無傳喚標的。
- **只承諾能驗的**：黑箱行為可驗、營運者內部不可驗——誠實劃界，不做安全劇場。
- **不擋自由**：`accepting:false` 讓你能大方「先列進去供社群手動/hint 用」再升權；無需許可的手動/hint 路徑不受影響。

## 後果

- 正面：第三方節點收錄從人工變成「自報＋自動探測＋簽章決策」；策展透明、可規模化、可撤銷。
- 負面 / 已知殘餘：
  - **稽核僅限行為**；「有無偷記」不可驗（結構性隱私承擔）。
  - 本次為**第一刀**：自報簽章與 `evaluateAdmission`（已測）＋一致性探測 I/O（同 health-check 屬網路探測、非單元測試）。
    **尚未**把 conformance 併進每小時 cron 自動設 accepting/weight，也未加 `relays.json` 稽核欄位與簽章稽核報告——列後續。
  - uptime 滾動記錄的儲存與門檻策略由維護者定。
- 後續行動：
  1. 把 `runConformance` 併進 `health-check.ts` cron → 依 `evaluateAdmission` 自動維護 entries（含 draining/retired）。
  2. `relays.json` entries 增稽核欄位（lastProbed/conformance/uptimePct）；發簽章稽核報告。
  3. relay `worker.ts`/`node-relay.ts` NIP-11 承載 `cinder_node` 自報（併 ADR-0089 實作）。
  4. 官網「建立節點」頁連 `docs/NODE-SUBMISSION.md`。
