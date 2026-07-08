# 0058. 送達 / 已讀回條（Gift Wrap 回條，已讀 opt-in + 互惠）

- 狀態：已接受
- 日期：2026-07-08
- 相關文件：PRD §4/§6（隱私、威脅模型）；ADR-0002（隱私基線）、0025（NIP-25 反應）、0041（可靠 outbox）、0056（離線持久化）、0057（NIP-42 AUTH）
- 範圍：**1:1 對話**（群組回條語意複雜、N 收件人，延後另議）

## 背景與問題

使用者要「標示傳送成功」與「標示已讀」。現有基礎：可靠 outbox 送出後 relay 回 `OK`，且**送出訊息 id == Gift Wrap 事件 id == outbox OK 的 id**（零成本對映）；收/送兩端以**同一 1059 事件 id** 當訊息 id；已有 `wrapReaction`（kind 7 rumor + `e`→訊息 id，包 Gift Wrap）作範本。缺 `ChatMessage.status` 欄位。

## 決策

**三層訊息狀態 `sending → sent → delivered → read`；回條沿用反應的 Gift Wrap 機制。已讀 opt-in + 互惠。**

1. **回條事件：** 新 rumor `KIND.RECEIPT`（app 內部 kind，經 Gift Wrap，永不裸發）。rumor `tags`：`["e", 目標訊息id]` + `["receipt", "delivered"|"read"]`，`content` 空。收件人→原寄件人，一律 Gift Wrap（隱藏雙方、E2E）。
2. **Tier 1 —「已送到中繼」`sent` ✓：** outbox 收到 relay `OK`（id 對映到該訊息）即標 `sent`。**無新協定、不需對方配合、零讀取洩漏**。
3. **Tier 2 —「已送達裝置」`delivered` ✓✓：** 收件端解開 1:1 訊息後**自動**回 `delivered` 回條；寄件端據 `e` tag 標 `delivered`。
4. **Tier 3 —「已讀」`read` ✓✓(藍)：** 收件端**開啟對話**時回 `read` 回條，且採**已讀水位**（`e` 指向最新已讀訊息＝「已讀到此」，之前全標已讀）→ 流量 O(開對話次數) 而非 O(訊息數)。
5. **已讀隱私（opt-in + 互惠）：** 設定 `readReceipts` **預設關**。關閉時**不送**己方已讀回條，**且不顯示**收到的他人已讀（互惠，Signal 風、客戶端自律）。送達回條不受此開關影響。
6. **可靠傳遞：** 回條走既有 outbox（重連補送、對方離線則持久化後補收，ADR-0041/0056）。

## 理由

- **Tier 1 幾乎免費**且無隱私代價——先給「傳送成功」。
- **回條即密文 Gift Wrap**：對 relay 隱藏「誰回給誰」（同一般訊息）；已讀資訊只在 E2E 內對「原寄件人」揭露。
- **已讀水位**把回條流量壓到最低，減少時序關聯面。
- **已讀 opt-in 預設關**符合隱私優先：讀取時機是敏感元資料，使用者主動開才產生。

## 後果

- 正面：三段式送達/已讀狀態；已讀可控且互惠。
- 負面 / 已知限制：
  - `delivered` 回條使 1:1 每則多一個回程 Gift Wrap（時序/流量）；水位化僅部分緩解（送達仍逐則）。收件人本就對 relay 可見於 `#p`，故洩漏面有限。
  - 回條為**盡力而為**：對方用不解讀回條的客戶端則無狀態（優雅退化為僅 `sent`）。
  - 群組不做（N 收件人、「全員已讀」語意）。
- 後續行動（增量）：
  1. **core：** `KIND.RECEIPT`；`receipt`（`wrapReceipt`/`receiptOf`）；`ChatMessage.status` 型別。
  2. **backend/storage：** Tier 1（outbox OK→`sent`）＋ Tier 2（收訊回送達、收送達回條標記）＋狀態持久化＋`onMessageStatus`。
  3. **backend：** Tier 3（`markRead` 水位、收已讀回條標記）＋ `readReceipts` 設定（互惠）。
  4. **UI：** 對話視窗 ✓/✓✓/已讀 指示；開窗即 `markRead`；設定開關。
