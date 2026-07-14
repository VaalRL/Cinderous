# 0119. 全面健檢：資料完整性、靜態加密的死碼、連線洩漏

- 狀態：已接受（已實作）
- 日期：2026-07-14
- 相關文件：**ADR-0110（分部位持久化）**、**ADR-0112（web/mobile 靜態加密）**、
  0109（自適應心跳）、0111（封存）、0114（行動端群組）、0094（保留上限）、
  0053（OS 金鑰庫）、0118（配對捆包身分）

## 背景

連續交付 ADR-0107〜0118（12 個 ADR、測試 792→943）之後，回頭做一次全面健檢。
四個平行審查代理 ＋ 逐項親自複驗。

**代理的發現一律不直接採信**：這個 session 我已經誤報過兩次（「心跳重複發送到 home relay」、
「ADR-0104 移除了 HTML5 拖放」），兩次都是**去讀了程式碼才發現是假警報**。以下每一項都跑過
真實情境驗證。

結果最刺眼的一件事：**這批 bug 大多是我自己前幾個 ADR 引入的**，而且共通模式是
**「靜默失敗」**——功能看起來正常，錯誤不會浮現，直到資料已經沒了。

## 決策

### 🔴 1. 分部位寫入失敗 ＝ 靜默永久資料遺失（ADR-0110 引入）

```ts
private async writeDirty(): Promise<void> {
  const parts = [...this.dirty];
  this.dirty.clear();                    // ← 寫入**之前**就清空
  for (const part of parts) await this.io.savePart(…);   // ← 拋錯 → 那個部位再也不會被重寫
}
```

磁碟滿、防毒鎖檔、權限問題——任何一個都會讓 `savePart` 拋錯。而待寫佇列**已經清空了**：
那個對話的訊息**再也不會被寫回**。使用者以為存好了；下次開 App 整段對話不見，
**而且沒有任何錯誤訊息**。

修法：失敗的部位**放回佇列**、3 秒後自動重試、並通知 UI（`onStoreFailure`）。
`flush()` 改回傳 `boolean`（是否真的全寫完）。

### 🔴 2. Rust 端非原子寫入 ＋ 靜默跳過毀損部位 ＝ 一次斷電毀掉一個對話

`std::fs::write` **不是原子的**。斷電／行程被殺 → 留下**截斷的密文檔**。
而截斷的密文解不開，`store_load_parts` 把它當「這個部位不存在」**靜默 `continue`**，
下一次寫入再用「只剩新資料」的內容覆蓋掉它。

**一次斷電 ＝ 一個對話的完整歷史永久消失。**

修法：
- `atomic_write()`：先寫 `.tmp`、再 `rename` 覆蓋（同檔案系統上 rename 是原子的）。
- `quarantine()`：解不開的檔改名 `.corrupt` 而非丟棄——不會被下次寫入覆蓋，資料還有救。

### 🔴 3. ADR-0112 在桌面的瀏覽器路徑上**整個是死碼**

ADR-0112 的紅線是「web 的 localStorage 靜態加密、nsec 絕不明文落盤」。實作也確實寫好了。
**但四個呼叫端全都忘了把金鑰傳進去**：

```ts
const store = storage ?? new LocalStorage(p.namespace, 0);   // ← 沒有 secretKey
```

而 `LocalStorage` 在**省略金鑰時是靜默寫明文的**（為相容 CLI／測試的明文用法）——
沒有警告、沒有錯誤，看起來一切正常。更糟的是其中兩處還把**真的 nsec** 寫進 `saveIdentity()`。

**ADR-0112 宣稱修好的正是「web 明文存私鑰」，而它在這條路徑上一行都沒生效。**

修法：抽出 `native/browser-store.ts` 作為**單一來源**——「怎麼建一個瀏覽器儲存」只能有一個
答案，而且它必須是可測的。呼叫端不再自己 `new`。

### 🔴 4. 瀏覽器「新增身分」會造出**永遠打不開的身分**（ADR-0112 引入）

```ts
const sk = generateSecretKey();
new LocalStorage(pubkey).saveIdentity({ nsec: "", name });   // 只存名字
location.reload();                                            // ← sk 隨頁面消失
```

`sk` 只活在函式作用域裡。桌面沒事（nsec 進了 OS 金鑰庫，重載後撈得回來）；
**瀏覽器則是：使用者從頭到尾沒看過那把 nsec，重載後系統卻要他貼上 nsec 才能進去。**

**他剛建立了一個自己永遠進不去的身分，而且它還是當前作用中的設定檔。**

修法：瀏覽器分支**不要重載**——nsec 就在手上，直接原地換後端（與首次登入、解鎖同一條路）。

### 🟠 5. `enterWithNsec` 無條件用 TauriStorage → 瀏覽器解鎖**永遠打不開**

```ts
const ts = new TauriStorage(p.namespace);
await ts.hydrate();   // 瀏覽器沒有 invoke() → 必然 reject
```

ADR-0112 才剛加的「瀏覽器本地密碼解鎖」，從第一天起就是壞的。修法：分流。

### 🟠 6. `stop()` 從不關閉 WebSocket → 登出後無限重連

`RelayChatBackend.stop()` 清了 handler，但**沒有關 socket**。而 `close()` 是**唯一**會設
`stopped = true`（停止自動重連）的地方。

實測：登出後那些連線**永遠在重連**。切換身分時尤其糟——舊身分的連線繼續跑，
繼續消耗中繼站配額，繼續以舊金鑰簽心跳。

### 🟠 7. 群組的 emoji 回應與收回**兩端都會爆**（ADR-0114 只修了一半）

ADR-0114 修好了行動端的群組**送訊**，但 `sendReaction` / `unsendMessage` 沒改：
`groupId`（32 字元）被當成 pubkey（64 字元）丟進 NIP-44 → `second arg must be public key`。
**桌面也一樣爆**，只是沒人回報。

修法：抽出 `recipientsOf(convo)`，群組扇給每位成員（群組沒有共用金鑰——這是 NIP-17 的固有代價）。

### 🟠 8. 在線判定用了過時的 90 秒窗（ADR-0109 遺漏）

ADR-0109 把閒置心跳從 30 秒放寬到 **300 秒**，但 `emitContacts()` 還在硬比
`PRESENCE_TIMEOUT_MS = 90_000`（＝3× 舊的 30 秒）。**閒置的聯絡人每 5 分鐘只會亮 90 秒。**
改用 `presence.statusOf()`（它讀對方**自報的節奏**）。

### 🟠 9. 中繼站的 `maxSubscriptions` 從未啟用

`RelayCore` 支援它，但 `worker.ts` 沒傳 → **無上限**。一個攻擊者可以在單一連線上開幾萬個
訂閱，拖垮整個全域房間的 Durable Object（所有使用者共用同一個 DO）。設為 16。

### 🟠 10. `health-check.ts` 引用未定義的變數 → **中繼清單一變動 cron 就當掉**

`bootstrap/` 不在 `relay/tsconfig.json` 的 include 裡 → **tsc 從來沒檢查過它**。

### 11. `main.rs` 的檔案安全原語搬進 lib（原本零測試）

`main.rs` 是 `required-features = ["tauri-app"]` 的 bin target——**`cargo test` 永遠編不到它**。
其中 `valid_part()` 是路徑穿越的**唯一**守衛，卻一行測試都沒有。

搬進 `partfile.rs`（比照 `encstore` / `passlock`：純函式、不依賴 Tauri），CI 的 `cargo test`
才真的在測會出貨的東西。

### 12. 刪除孤兒 `net_integration.rs`（引用 ADR-0105 已刪的模組）

## 理由

這批 bug 有一個**共通的形狀**，值得記下來：

> **「不傳就靜默降級」的 API，會讓一整個 ADR 變成死碼而沒人發現。**

`new LocalStorage(ns)` 不帶金鑰＝明文，`writeDirty` 拋錯＝當作寫過了，
`store_load_parts` 解不開＝當作不存在。每一個都是「安靜地做了錯的事」，
而不是「大聲地失敗」。**功能看起來全都正常**——直到資料已經沒了。

所以修法不只是補上參數，而是**把正確用法變成唯一用法**（`browserStore()` 單一來源），
並且**讓失敗浮上來**（`flush(): boolean`、`onStoreFailure`、`.corrupt` 隔離檔）。

## 後果

- 正面：
  - 測試 943 → **953**（TS）；Rust 13 → **16**（`valid_part` 的路徑穿越守衛首次有測試）。
  - 新測試都是**迴歸測試**：每一個在修正前都會失敗（寫入失敗留佇列、群組回應不拋錯且對方
    真的收到、`stop()` 真的關連線、瀏覽器儲存落盤全是密文）。

- **已知限制（尚未修，需各自的 ADR）**：
  - 🔴 **typing／nudge 廣播了已簽章的社交圖譜邊**。`createTyping` ＝
    `createEphemeralEvent(sk, KIND.TYPING, { tags: [["p", recipientPk]] })`——**用真的金鑰簽名，
    收件人 pubkey 明文放在 tag 裡**。惡意中繼可以直接重建完整社交圖譜；更糟的是把
    「A 在 T 時刻對 B 打字」與「T+2 秒出現一則寄給 B 的 1059」關聯起來，
    **就能反推出 Gift Wrap 的寄件人**——那正是 NIP-59 存在的唯一理由。
    應比照 `signaling.ts` 封裝（seal）。
  - 中繼 ACL：不帶 `#p` 的 filter 讓任何人都能收割他人的 ephemeral metadata（狀態訊息、
    正在聽、typing 的 p-tag）。
  - **ADR-0111 宣稱「修好 ADR-0094 的資料遺失」是言過其實**：使用者設定的保留上限
    （`maxPerConvo`）**仍然是刪除**，而且封存本身不會被裁剪 → 「上限」其實沒有真的限制總儲存量。
  - 群組**傳檔**仍會爆（`sendFile` 未走 `recipientsOf`）；行動端也沒在群組裡隱藏 📎。
  - `receiveGroup` 對未知群組的訊息**靜默丟棄**（無重試）。
  - 行動端的配對匯入只還原身分，沒有套用捆包（不呼叫 `applyPairBundle`）。
  - `read_saved_file` 是無限制的任意檔案讀取 IPC（縱深防禦缺口；目前未發現可用的 XSS）。
  - 收到的檔名未消毒就送進原生另存對話框。
  - `MAINTAINER_PUBKEY = ""` → ADR-0039/0069/0092 的簽章清單鏈在生產環境是死碼（使用者裁示暫緩）。
  - `ARCHITECTURE.md` / `PRD.md` 嚴重過時（仍寫 D1、SQLCipher、Rust net 模組、30 秒心跳）。
  - 所有 UI 測試都是 SSR（`renderToStaticMarkup`）→ **`useEffect` 從不執行**，
    例如已讀回條的觸發完全沒有覆蓋。
