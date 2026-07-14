# 0124. 群組傳檔——metadata 扇出、位元組各自 P2P

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：**ADR-0093（多設備檔案投遞：metadata 中繼化＋位元組 P2P）**、
  0119（健檢：本問題於該次發現）、0114（行動端群組送訊）、0027（群組加密：無共用金鑰）

## 背景與問題

在群組裡按下 📎 會**當場爆掉**。UI 從來沒擋過它（桌面與行動端都沒有），所以這是使用者
點得到的路徑。

原因和 ADR-0114（行動端群組送訊）、ADR-0119（群組回應／收回）**完全是同一個**：

```ts
sendFile(to: PubkeyHex, file: OutgoingFile, …) {
  const tid = this.transfer.sendFile(to, file);              // ← to 是 groupId（32 字元）
  const wrapped = wrapFileMessage(this.sk, to, meta, …);     // ← 丟進 NIP-44 → 拋錯
```

**`groupId` 是 16 bytes hex（32 字元），pubkey 是 32 bytes hex（64 字元）。** 把 groupId 當成
收件人公鑰丟進 NIP-44，只會得到 `second arg must be public key`。

這個 bug 已經是第三次以同一個形狀出現了。根因是：**群組沒有共用金鑰**（ADR-0027 的刻意取捨
——NIP-17 的固有代價），所以「送給群組」在協定層**根本不存在**，只有「分別送給每一位成員」。
任何以 `convo` 為參數的送出路徑，都必須先問「這個 convo 是群組嗎」。

## 決策

### 1. metadata **扇給每位成員**（共用同一個 rumor）；位元組**各自走 P2P**

沿用 ADR-0093 的分工，不發明新機制：

| | 走哪 | 為什麼 |
|---|---|---|
| **檔案 metadata**（名稱、大小、類型、tid） | 中繼，Gift Wrap 給每位成員 | 讓對方**所有裝置**都知道有檔案（ADR-0093） |
| **位元組** | P2P，對每位成員各開一條 | 明文不上雲；N 位成員＝送 N 份 |

`wrapGroupFile()` 與 `wrapGroupMessage()` **共用同一份扇出邏輯**（抽出 `wrapGroupRumor`）：
rumor 只建一次 → **`rumor.id` 跨成員一致** → 回條（ADR-0095）與自封副本（ADR-0107）
才對得回同一則訊息。

### 2. 🔴 所有成員必須共用**同一個 `tid`**

`transfer.sendFile()` 原本每次呼叫都自己產一個 id。群組扇出時那會產生 N 個不同的 tid——
但 metadata 只有一個（rumor 共用），**收件端就對不回同一則訊息**：位元組到了，
卻找不到它屬於哪一則。

所以 `sendFile(peer, file, tid?)` 接受外部指定的 tid，群組送出時先 `newTransferId()` 產一個，
再傳給每一位成員。

### 3. 🔴 `onFileBytes` 要回報**對話鍵**，不是 peer

```ts
// 修正前
this.handlers?.onFileBytes?.(peer, msgId, file);
```

App 把第一個參數當**對話鍵**用（`patchFileByMsgId(prev, pk, …)`、`setFileThumb(pk, …)`），
介面上它也叫 `contact`。1:1 時 peer 就是對話鍵，所以一直沒事；**群組檔案的對話鍵是 groupId**，
傳 peer 會讓收到的位元組被寫進「跟那位成員的 1:1 對話」，而不是群組裡。

改為 `existing?.contact ?? peer`——`fileMsgByTid` 本來就記著這則訊息屬於哪個對話。

### 4. `receiveGroup` 要認得檔案訊息

群組的檔案 metadata 是「kind CHAT ＋ `g` tag ＋ `file` tag」，會被路由到 `receiveGroup()`，
而它原本只處理文字。補上 `parseFileMeta()` 分支，落到與 1:1 相同的 `ensureFileMessage()`。

## 理由

- 這是**同一個 bug 的第三次現身**（ADR-0114 送訊、ADR-0119 回應／收回、本 ADR 傳檔）。
  每一次都是「某條送出路徑忘了問『這個 convo 是群組嗎』」。
  所以本 ADR 除了修它，也把「群組沒有共用金鑰 → 送出必須扇出」這件事寫進
  `recipientsOf()` 附近的註解，讓下一個人在加新的送出路徑時就看見。
- 而**位元組要送 N 份**是無法避免的：P2P 是點對點的，沒有群播；而中繼不能碰明文。
  這是隱私的代價，必須誠實記錄（見已知限制）。

## 後果

- 正面：
  - 群組傳檔可用了（桌面與行動端；UI 本來就開著這個入口）。
  - 收到的群組檔案落在**群組對話**裡，不是跟某位成員的 1:1（那會很詭異）。
  - 縮圖（ADR-0102）、另存新檔（ADR-0093）、跨裝置 metadata 全部沿用，零特例。
  - 測試 1006 → **1008**（engine +2：**群組傳檔不再拋錯**且 metadata 落在群組對話裡
    〔不是跟某位成員的 1:1〕、**三人群的每位成員共用同一個 tid**）。

- 已知限制：
  - **位元組對每位成員各送一份**（N 成員＝N 份上傳）。P2P 沒有群播，而明文不能上中繼——
    大群傳大檔會很慢。UI 未做任何提示或阻擋。
  - 成員**離線時收不到位元組**（P2P 需雙方在線）——與 1:1 相同（ADR-0093 的既有限制）：
    metadata 會留在中繼（7 天 TTL），對方上線後看得到「有一個檔案」，但要重新索取位元組。
    **本 ADR 不處理重傳**。
  - 群組通話仍不支援（ADR-0101 的既有限制，與本 ADR 無關）。
