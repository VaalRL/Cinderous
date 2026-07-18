> 🌐 **English** · [English version](./NODE-SUBMISSION.en.md)

# 提交你的節點加入官方網路（ADR-0092）

任何人都能**自架並使用** Cinderous 節點（見自架文件，ADR-0075）。本文件是想被**官方自動選座池**收錄
（進維護者簽章清單，ADR-0039）的**申請流程**——**拉取式、可驗證、無審查後台**。

> 先釐清：不進池，你的節點**照樣可用**——手動填網址的人、或把它設為 home 的聯絡人（經 relay hint 自動學到）
> 都能用。進池只是讓「不認識你的新用戶」也可能被自動分配到你這座。

## 申請＝自報（你做的）

1. **穩定運行**你的節點一段時間（建議數週），專屬網域＋有效 TLS。
2. **暴露自我宣告**：以節點營運者金鑰簽一份 `CinderNodeDeclaration`（`@cinderous/core` 的 `signNodeAttestation`），
   置於 relay 的 NIP-11 `cinder_node`（未來，隨 ADR-0089）或發佈為自簽事件（kind 10038）。內容：
   ```json
   {
     "url": "wss://relay.你的網域",
     "contact": "op@你的網域 或 npub",
     "region": "EU",
     "software": "cinder-relay",
     "attests": ["ephemeral", "nip40-ttl", "no-plaintext-log", "no-censor"],
     "updatedAt": 1710000000
   }
   ```
3. **把 URL 交給維護者**（issue/PR/聯絡）。無需填表單、無需上傳私料——**維護者的工具會去拉**。

## 審查＝機器驗行為（維護者做的）

維護者工具（`relay/bootstrap/conformance.ts`）對你的節點跑**黑箱一致性探測**：
- `probeLive`：REQ→EOSE 存活
- `probeEphemeralNotStored`：Ephemeral（20000–29999）轉發但**不留存**（事後查不到）
- `probeRejectsExpired`：NIP-40 已過期事件**不回傳**
- 滾動 uptime 記錄

結果經 `evaluateAdmission` 轉為**分級收錄**：

| 狀態 | 條件 | 效果 |
| --- | --- | --- |
| 不列入 | liveness 失敗 | — |
| 試用（`accepting:false`） | 一致性未過，或 uptime 不足/未知 | 列進清單供韌性/手動用，**不自動分配新戶** |
| 收錄（`weight:1`） | 一致性過＋uptime≥95% | 自動分配（低權重） |
| 收錄（`weight:2`） | 一致性過＋uptime≥99% | 自動分配（較高權重） |

決策與理由落進**維護者簽章的 `relays.json`**（公開可驗、防竄改）。出問題→`draining`→`retired`，既有用戶自動搬離。

## 誠實邊界

- **只驗行為**：「你有沒有偷記元資料」在你機器裡，**技術上無法稽核**。Cinderous 的隱私是**結構性**的
  （E2E Gift Wrap＋TTL＋P2P＋多中繼），本就假設 relay 為對手——所以審查標準是「**穩不穩、行為對不對、可否問責**」，
  不是「可不可信任」。
- 自報**不等於保證誠實**，只提供問責身分。
- 進池是**服務新手 UX 的品質控管**，不是通訊門禁；社群永遠能繞過（手動/hint）。
