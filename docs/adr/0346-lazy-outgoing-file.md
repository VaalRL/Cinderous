# 0346. 送出端惰性來源：大檔不再整份進 RAM

- 狀態：已接受
- 日期：2026-09-15
- 相關文件：ADR-0345（送檔管線串流化第一階段）、ADR-0102（縮圖）、ADR-0273（送圖去 EXIF）、ADR-0162（組織檔案經 relay 暫存）、ADR-0161/0177（公司儲存槽）、ADR-0344（大檔走 TURN 把關）

## 背景與問題

ADR-0345 拿掉了送出端「把所有分塊框架先配置出來」那一份複製，但留下更前面的一份：

```ts
const raw = new Uint8Array(await f.arrayBuffer());   // ← 整檔進 RAM，無條件
```

這一行在**任何位元組上網之前**就把整個檔案讀進記憶體。一個 2 GB 的檔案在這裡就 OOM 了。行動端更緊——WebView 的記憶體額度比桌面瀏覽器小得多。

而 `OutgoingFile { name, mime, bytes }` 這個型別**本身就意味著整檔在 RAM**，所以問題不在呼叫端寫錯，在契約。

## 考量的選項

- **選項 A（採用）：加一個惰性來源型別，送檔管線統一走它。** `OutgoingFile` 原封不動，新增 `OutgoingFileStream`（`size` ＋ `slice(offset, length)`），`sendFile` 接受兩者的聯集，進管線時正規化。
- 選項 B：把 `OutgoingFile.bytes` 改為 optional、加 `size`。契約最乾淨，但每一個建構點與消費點都要改（含 ADR-0162 relay 暫存、ADR-0161 儲存槽、縮圖、EXIF），而其中兩條沒有端到端測試。
- 選項 C：只對「大檔」另開一條 `sendFileStream` 方法。送檔管線變成兩條，兩條都要各自處理背壓、進度、群組扇出——重複的地方正是日後會漂移的地方。

## 決策

**一、`OutgoingFileStream`（core）**

```ts
interface OutgoingFileStream {
  name: string; mime: string;
  size: number;                                   // 權威：惰性來源沒有 bytes 可量
  slice(offset: number, length: number): Promise<Uint8Array>;
}
```

搭配三個轉接函式：`bytesStream()`（把 `OutgoingFile` 包成來源，`slice` 走 `subarray` ⇒ **零複製**）、`blobStream()`（`Blob`/`File` 逐塊讀）、`asFileStream()`／`fileSizeOf()`（兩種型態統一）。

`blobStream` 以結構型別 `BlobLike` 定義，不綁 `lib.dom` — Node 18+ 的 `Blob` 也吃得下。

**二、`streamFile` 取代 `encodeFile`**

由同步 generator 改為 **async generator**：分塊是**逐塊向來源要**的。`webrtc.ts` 的 pump 因此變成非同步，並加上 `running` 旗標——排空事件可能在 `await` 中途再次喚醒 pump，正在跑的那一輪自己會繼續。

管線**只有一條**：位元組檔經 `bytesStream` 包一層（零成本）走同一條路。不為「有 bytes」和「沒 bytes」各寫一遍，是因為那兩份會漂移。

**三、UI 只在需要位元組時才讀**

`needsBytesToSend(mime, size)`（engine）：需要位元組的理由只有兩個，而且都只對圖片成立——**縮圖**（ADR-0102）與 **EXIF/GPS 清除**（ADR-0273）。其餘一律走 `blobStream`。

⚠ **圖片也設上限（32 MiB）**：`sanitizeImage` 走 canvas 重編碼，需要**解碼後**的點陣（一張 100 MP 的 PNG 解開來是數百 MB，遠大於檔案本身）。超過上限的圖片寧可**不清 EXIF、不做縮圖**也要走串流——否則「保護隱私」的那一步會先把 app 打掛，使用者連檔都送不出去。這與 `sanitizeImage` 檔頭「失敗即原樣送出，可用性優先」是同一個取捨。

**四、blob URL 改由 `File` 直接產生**

送出端本機保留 blob URL 供重播/下載（ADR-0093）。原本是 `URL.createObjectURL(new Blob([bytes]))` ⇒ 又一份複製；改為 `URL.createObjectURL(f)` ⇒ **零複製**（`File` 本來就只是磁碟上那份檔案的把手）。

**五、兩條需要整份位元組的路徑明確排除**

- **ADR-0162 relay 暫存**：要把位元組加密成分塊 ⇒ 惰性來源不走這條。不是限制——上限 `relayFilesMaxMb ≤ 16 MB`，而惰性來源存在的理由就是檔案大到不該進 RAM，兩者不可能同時成立。
- **ADR-0161/0177 公司儲存槽**：佇列本身持有位元組（v1 是 session 內記憶體佇列）⇒ 行動端另給 `pickFileBytes()`。**儲存槽路徑的大檔仍會整份進 RAM**，與改動前一致。

## 理由

- **契約加法而非改法。** `OutgoingFile` 一個字沒動，所以縮圖、EXIF、relay 暫存、儲存槽、群組扇出全部不受影響；TypeScript 的聯集型別把「哪些地方需要位元組」逐一標了出來（選項 B 會一次改動五處，其中兩處沒有端到端測試）。
- **一條管線。** 位元組檔包一層零成本的 `bytesStream` 走同一條路——重複的送出路徑正是日後會漂移的地方（選項 C）。
- **可用性優先於完備。** 圖片上限那條刻意允許「大圖不清 EXIF」，因為送不出檔案比少清一次中繼資料更糟；而且真正該補的是在**不解碼整張圖**的前提下清除 EXIF，那是另一件事。

## 後果

- 正面：非圖片與大圖送出時**整檔不進 RAM**，送出端的兩份複製（`arrayBuffer()` 與 blob URL）同時消失。行動端受益最大（WebView 記憶體額度小）。位元組路徑零成本、零行為改變。
- 負面／已知殘餘風險：
  - **大圖不再清 EXIF、也沒有縮圖**（> 32 MiB）。這是明確的取捨，不是疏漏——但它確實是 ADR-0273 的一個缺口，該補的是「不解碼整張圖就能清 EXIF」的作法。
  - **公司儲存槽路徑的大檔仍整份進 RAM**（見 §決策五）。要治本得先讓 ADR-0177 的佇列 durable。
  - **收檔端還沒動**：收到的檔案仍整份在 RAM（ADR-0345 已降到 1 份，但仍是 1 份）。`DEFAULT_MAX_FILE_SIZE` 因此**維持 100 MiB**——送出端能串流了不代表對方收得下。
  - **`slice` 失敗沒有專門的錯誤路徑**：來源讀取拋例外會往上冒成未處理的 rejection，而不是 `onError`。磁碟上的檔案在傳輸中途被刪除就會走到這裡。
  - 送檔進度在惰性來源下仍以「已送出的分塊數 × 分塊大小」估算——與位元組路徑一致，但來源若回傳短於要求的長度，進度會略為高估。
- 後續行動／待辦：
  1. **收檔端串流落盤**（ADR-0345 §後續行動 2）：`onFile` 改 sink 介面。這是 `DEFAULT_MAX_FILE_SIZE` 能不能拆的關鍵。
  2. `slice` 失敗接上 `onError`，並在傳輸中途檔案消失時給使用者可行動的訊息。
  3. 不解碼整張圖就清 EXIF（補上 §決策三的缺口）。
