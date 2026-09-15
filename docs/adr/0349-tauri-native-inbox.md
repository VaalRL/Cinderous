# 0349. Tauri 原生收檔落盤，並把 100 MiB 天花板拆掉

- 狀態：已接受
- 日期：2026-09-15
- 相關文件：ADR-0347（收檔端串流落盤——Tauri 被排除在外）、ADR-0348（讓 CI 編譯 `main.rs`）、ADR-0119（可測邏輯住 lib）、ADR-0128（原生對話框授權路徑）、ADR-0345/0346（串流化前兩段）、ADR-0344（大檔走 TURN 的提示門檻）

## 背景與問題

ADR-0347 讓收檔端來一塊寫一塊，但**把 Tauri 桌面排除在外**——它的「另存新檔」走 Rust `save_file` command，需要整份位元組過 IPC。而那條路的實作是：

```ts
invoke("save_file", { name, bytes: Array.from(bytes) })
```

`Array.from` 把 `Uint8Array` 變成 **JS number 陣列**（每個元素約 8 bytes）再 JSON 序列化 ⇒ **100 MiB 的檔約 800 MB**。這是 ADR-0347 發現但當時沒修的東西，因為修它必須動 `main.rs`，而那個檔案**沒有任何地方驗證得到**。

ADR-0348 解除了那個前置條件（CI 現在會 check＋clippy `main.rs`），所以這件事可以做了。

## 決策

**一、可測邏輯住 lib（`cinder_desktop::inbox`）**

ADR-0348 讓 CI **編譯** `main.rs`，但**仍然測不到它**（`cargo test --features tauri-app` 會因 keyring 測試需要真實 OS 金鑰庫而失敗）。所以照 ADR-0119 對 `partfile` 的處理辦：

- `valid_handle()`／`resolve()`——路徑穿越守衛。**前端不可信**：webview 裡的任何 XSS 都能呼叫 command，所以這道守衛必須在原生側，而且不該住在一個測不到的檔案裡。
- `begin()`／`write_at()`／`finish_into()`／`discard()`／`sweep()`——純 std，10 個測試。
- `main.rs` 只剩五個**薄殼** command。

**二、無狀態寫入**

`write_at` 每次自己開檔／seek／關檔，**不保存檔案把手**。多一次 open 的代價（16 KiB 一塊，1 GB 約 65,536 次）遠低於「在 command 之間保存一張把手表」要付的代價：那張表得處理傳輸中斷、視窗關閉、身分切換的清理，**任何一條漏掉就是洩漏的檔案把手**。無狀態換來的是崩潰後只剩一個孤兒 `.part`，而那由 `sweep` 收拾。

**三、另存＝原生移動，零位元組過 IPC**

`save_from_inbox`：對話框選位置 → `rename`（同檔案系統上原子且零複製）→ 授權讀回（ADR-0128）。跨檔案系統（暫存區在系統碟、使用者存到隨身碟）`rename` 會失敗 ⇒ 退回 copy＋remove，且**copy 成功才刪來源**——寧可留孤兒，也不要讓檔案在兩邊都不存在。

⚠ 逐塊仍會過 IPC（16 KiB）。**那不是原本的災難**：災難是整份一次過去。

**四、`begin` 會截斷**

同一個傳輸 id 重來時若沿用舊檔，新檔比舊檔短就會留下舊資料的尾巴——而收端是**依位移寫入**的（ADR-0345 的亂序契約），不會自然覆蓋掉那段。

**五、開機清理**

`inbox_sweep` 刪掉超過一天的 `.part`（ADR-0347 §後果列的殘餘）。只認 `.part` 後綴、只看修改時間——不碰同目錄下的別的東西。

**六、天花板：一個變兩個**

三個平台都能串流了，所以 `DEFAULT_MAX_FILE_SIZE` 由 100 MiB 調到 **1 GiB**。但**只有真的會落盤的檔案吃得到它**：

🔴 新增 `maxMemoryFileSize`（預設 100 MiB，**就是舊天花板**）。`openSink` 可能沒掛、也可能在執行期回 `null`（私密模式、配額拒絕），那些情況會**退回記憶體**——而退回記憶體的路徑若沒有自己的上限，把 `maxFileSize` 調到 1 GiB 就等於把 OOM 從「擋下來」變成「等它發生」。所以兩個地方都守：`file-begin` 當下（沒掛 sink），以及 `beginSink` 回 `null` 時（執行期才知道）。**拒絕比 OOM 誠實**——使用者至少知道發生了什麼。

## 理由

- **ADR-0348 的結論立刻被用上。** 新 CI job 在這個 commit 裡就抓到一個 clippy lint（`nonminimal_bool`，在我新寫的 `sweep` 裡）——它不是裝飾。
- **1 GiB 是可改的一行。** 這個數字不像 ADR-0344 的 50 MB 門檻那樣是產品判斷，它只是「記憶體不再是限制之後，願意讓一次傳輸跑多久」。1 GiB 在 10 MB/s 下約 100 秒。

## 後果

- 正面：三個平台收大檔都不再整份進 RAM；`Array.from` 那條 IPC 災難在 ≥ 8 MiB 的檔案上完全繞開；暫存區會自己清理；天花板 10 倍。
- 負面／已知殘餘風險：
  - 🔴 **這整段 Rust 沒有在真的 Tauri app 裡跑過。** lib 的 10 個測試涵蓋路徑守衛、亂序寫入、截斷、移動、清理；`cargo check`／`clippy` 涵蓋 command 的型別與 lint。但 **command 接線本身**（參數名是否與 `invoke` 對得上、`app_data_dir` 在各平台的行為、rfd 對話框）**只能靠實機驗證**。這是這個 commit 最薄的一塊。
  - **小檔仍走 `save_file`＋`Array.from`**（< `sinkMinBytes` 8 MiB ⇒ 約 64 MB 暫態）。有界，但沒修。
  - **逐塊 IPC 的序列化成本未量測**：16 KiB 一塊經 JSON number 陣列約 128 KB 暫態、每塊一次 IPC 往返。1 GiB ＝ 65,536 次往返，實機吞吐未知。
  - **`maxMemoryFileSize` 讓同一個檔案在不同環境有不同結果**：一般瀏覽器收得下 500 MB，私密模式（OPFS 拒絕）會拒收同一個檔。誠實但可能令人困惑，UI 目前只顯示錯誤字串。
  - **1 GiB 未經端到端實測**。測試用的是 9 MiB（跨過落盤門檻）；真正跑滿 1 GiB 的行為（時間、重連、背壓）沒有驗證過。
  - Windows 的 `#[cfg(windows)]` 分支仍無處編譯（ADR-0348 §後續行動 1，未動）。
- 後續行動／待辦：
  1. **實機驗證**這五個 command（Tauri 桌面實際收一個 > 8 MiB 的檔並另存）。在那之前，桌面的串流路徑應視為**未證實**。
  2. 小檔的 `save_file` 也改走原生（或至少不用 `Array.from`）。
  3. 依 ADR-0344 §後果重新檢視 50 MB 的中繼提示門檻——天花板現在是 1 GiB，那個門檻是唯一攔在使用者與「不知情地經中繼送出 1 GB」之間的東西。
