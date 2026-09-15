# 0347. 收檔端串流落盤：大檔不再整份進 RAM（瀏覽器／行動端）

- 狀態：已接受（Tauri 原生路徑未含，見 §後果）
- 日期：2026-09-15
- 相關文件：ADR-0345（送檔管線串流化第一階段）、ADR-0346（送出端惰性來源）、ADR-0093（收檔另存）、ADR-0111（OPFS 封存）、ADR-0102（縮圖）、ADR-0161/0177（公司儲存槽）、ADR-0162（relay 暫存）、ADR-0119（`partfile.rs` 檔頭：`main.rs` 不被 CI 編譯）

## 背景與問題

ADR-0345 把收檔峰值從約 2 份降到 1 份，ADR-0346 讓送出端整檔不進 RAM。剩下最後一段：**收檔端仍然把整份檔案放在記憶體裡**。

這就是 `DEFAULT_MAX_FILE_SIZE`（100 MiB）拆不掉的原因——送得出去不代表對方收得下。

## 考量的選項

- **選項 A（採用）：`DataChannelReceiver` 接受一個 sink，大檔來一塊寫一塊。** sink 由引擎注入（OPFS），core 不知道檔案系統長什麼樣。
- 選項 B：收檔前先跳「另存新檔」，直接寫使用者選的位置（文件範例的 `showSaveFilePicker` 作法）。**否決**：把對話框提前成來電式的打斷，是產品層改動；且 `showSaveFilePicker` Firefox/Safari 沒有。
- 選項 C：在 Tauri 用原生檔案系統。**否決**（這一版）：要新增 Tauri command，而 `main.rs` 是 `required-features = ["tauri-app"]` 的 bin target——`cargo test` 與 CI 的 `cargo clippy --all-targets` **都不會編譯它**（`partfile.rs` 檔頭已載明這件事）。在那裡加程式碼＝加一段**沒有任何地方驗證得到**的程式。

## 決策

**一、core：`FileSink` 與 `openSink`**

```ts
interface FileSink {
  write(offset: number, chunk: Uint8Array): Promise<void> | void;
  close(): Promise<FileSinkResult> | FileSinkResult;   // → { handle }
  abort(): void;                                        // 不得拋
}
type OpenFileSink = (meta) => Promise<FileSink | null> | FileSink | null;
```

`ReceivedFile` 隨之改為：`size` 是權威、`bytes` **optional**（串流時 undefined）、新增 `sink?: { handle }`。TypeScript 因此把每一個需要位元組的消費點都標了出來。

**二、`null` 是一等公民的退路**

`openSink` 回 `null`＝**這個檔案走記憶體**。三種情況都靠它：
- **小檔**（< `sinkMinBytes`，預設 8 MiB）——縮圖（ADR-0102）、公司儲存槽（ADR-0161）、預覽都需要位元組，而它們本來就只處理小檔；為了幾百 KB 去開檔、寫入、再讀回來也不划算。
- **公司儲存槽檔案**（帶 `origin`）——企業主端要整份位元組才落得了盤。
- **沒有 OPFS 的環境**（SSR、私密模式、配額拒絕）——收檔不能因為磁碟問題而整個失敗。

開 sink 失敗或拋例外同樣退回記憶體，且**開 sink 期間到達的分塊會倒回緩衝區**，不會掉。

**三、收端沒有流量控制 ⇒ 佇列必須有上限**

`receive()` 是同步的（`dc.onmessage`），落盤是非同步的，所以分塊先進佇列再由 drain 迴圈寫出。

🔴 **資料通道沒有收端流量控制**——瀏覽器照收不誤，我們叫不動對方慢一點。落盤若比網路慢，佇列就會無限長大，**記憶體問題原封不動地搬進佇列**。故 `maxQueuedBytes`（預設 8 MiB）超過即中止該檔並報錯：比靜默吃光記憶體誠實。實務上磁碟遠快於 P2P 頻寬，正常傳輸碰不到它。

**四、中止後的分塊要靜靜丟掉**

中止時剩下的分塊**還在路上**，而它們會一一撞上「未知檔案分塊 id」再各報一次錯——一個中止的 1 GB 傳輸就是數萬則錯誤回呼。故加一個有界（64 筆）的抑制名單。**這是寫測試時才發現的**：原本的斷言只預期一則錯誤，實際收到三則。

**五、OPFS 實作與「不要讀回來」**

`opfsFileSink()`（engine）寫到 OPFS 的 `cinder-inbox/`；寫入用 `{ type: "write", position }` 指定位移，因為 ADR-0345 保留了**亂序送達**的既有契約，依序寫會把亂序的那些寫到錯的地方。

另存時 `readInboxFile()` 回傳的是 **`File` 而不是位元組**：`URL.createObjectURL(file)` 對它是**零複製**，瀏覽器下載直接從磁碟串流。`await file.arrayBuffer()` 會把剛剛省下的記憶體全部吃回去——那樣整個 ADR 就白做了。

**六、平台開關**

`RelayPoolOptions.streamLargeFiles`。桌面端傳 `!isTauri()`：瀏覽器版開、Tauri 關（見選項 C）。行動端（react-native-web）開。

## 理由

- **契約加法。** 既有測試**沒有一個給 `openSink`** ⇒ 全部走記憶體路徑，一個位元組都沒變，而它們全數繼續綠。
- **退路優先於完備。** `null` 讓小檔、儲存槽、無 OPFS 三種情況共用同一個機制，而不是各開一條 if。
- **不寫沒人驗證得到的程式。** Tauri 原生路徑留白是刻意的：CI 不編譯 `main.rs`，在那裡加東西是在賭。

## 後果

- 正面：瀏覽器版與行動端收大檔時整檔不進 RAM；配合 ADR-0346，**單一大檔的兩端都不再整份進記憶體**。行動端受益最大（WebView 額度小）。
- 負面／已知殘餘風險：
  - 🔴 **Tauri 桌面沒有串流**（`streamLargeFiles: false`）——那是「第一優先平台」。而它的另存路徑 `invoke("save_file", { bytes: Array.from(bytes) })` **本身就是個記憶體災難**：`Array.from` 把 `Uint8Array` 變成 JS number 陣列（每個元素約 8 bytes）再 JSON 序列化過 IPC ⇒ 100 MiB 的檔約 800 MB。這是本 ADR **發現但沒有修**的既有問題，修它必須動 `main.rs`。
  - **`DEFAULT_MAX_FILE_SIZE` 仍是 100 MiB**。三個平台裡有一個收不下大檔，就不能調高這個全域上限。
  - **大檔沒有縮圖**（> `sinkMinBytes`）——沒有位元組可畫。與 ADR-0346 的「大圖不清 EXIF」是同一類取捨。
  - **OPFS 暫存區沒有開機清理**：使用者若在另存前關掉 app，`cinder-inbox/` 會留下 `.part` 檔。單檔上限 100 MiB、OPFS 配額很大，所以不會立刻出事，但它會累積。
  - **`maxQueuedBytes` 觸發時整個檔案作廢**，不是暫停後重試——資料通道沒有收端流量控制，沒有「暫停」這個選項。
  - **沒有真實 OPFS 的自動化測試**：sink 機制、退路、佇列上限、端到端往返都有測（用替身 sink），但 `opfsFileSink()` 本身跑在 node 測試環境外。
- 後續行動／待辦：
  1. **Tauri 原生落盤**：新增串流寫入的 command（暫存檔 → 另存時**原生移動**，零位元組過 IPC），順帶修掉 `Array.from` 那個災難。~~⚠ 前置條件是讓 CI 真的編譯 `main.rs`~~ ⇒ **前置條件已完成（ADR-0348）**：CI 的 `tauri-app` job 現在會 check＋clippy `main.rs`。⚠ 但**仍然沒有測試**——`cargo test --features tauri-app` 會因 keyring 測試需要真實 OS 金鑰庫而失敗，所以新 command 的可測邏輯應該住在 lib（比照 `partfile.rs`）。
  2. `cinder-inbox/` 的開機清理（超過 N 天的 `.part` 一律刪）。
  3. **三個平台都能串流之後**，才調高 `DEFAULT_MAX_FILE_SIZE`，並依 ADR-0344 重新檢視 50 MB 的中繼門檻。
