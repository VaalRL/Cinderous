# 0293. White Noise 實作拆解：他們踩過的坑，有幾個我們形狀相同（研究記錄）

- 狀態：**研究記錄（未決策，本文不改變任何產品行為）**
- 日期：2026-07-28
- 相關文件：**0271**（Marmot 規格分析——本文補上其自列的限制「只讀了規格、沒讀實作」）、
  **0237**（連線歸屬打穿事件層——**§3 找到一個我們沒想到的具體緩解**）、
  0044（企業 allowlist——§3 的張力所在）、0057（NIP-42 預設開）、
  **0267**（檔案塊靜默截斷／訂閱無水位——**§2.1 指出那是更大結構問題的症狀**）、
  0045（多身分命名空間隔離）、0269（追趕路徑：Rust/WASM 的取捨）、0268（對手盤點）
- 資料來源：**clone `github.com/parres-hq/whitenoise`（whitenoise-rs，v0.2.1）並閱讀其
  `Cargo.toml`、`README.md`、`docs/{relay-control-plane-rearchitecture,session-projection-rearchitecture,storage-architecture,SECURITY}.md`**（2026-07-28）

> ADR-0292 只讀了 Marmot 規格。本文讀實作。**最有價值的不是他們做對了什麼，
> 而是他們的兩份「re-architecture」文件——那裡寫著他們踩到的坑，
> 而其中兩個我們的形狀一模一樣，只是還沒痛到寫文件。**

## 1. 架構取捨：他們用 Rust 換掉了網頁版

| | White Noise | 本專案 |
|---|---|---|
| 密碼學核心 | **不自己實作 MLS**——用 `mdk-core` / `mdk-sqlite-storage`（marmot-protocol 的 MDK） | 自寫 TS（`@cinderous/core`） |
| 核心語言 | Rust，`crate-type = ["cdylib", "rlib"]` | TypeScript |
| 前端接法 | **原生 FFI** 給 Flutter（`src/ffi.rs`）＋ CLI | 直接 import TS library |
| 網頁版 | **沒有**（cdylib 是原生動態庫，不是 WASM） | 有（瀏覽器版是既有交付形式） |
| 執行模型 | `wnd` 常駐 daemon 持有單例，`wn` 瘦客戶端走 Unix socket | engine 被各 App 直接 import |

⇒ **ADR-0290 §3 說「成熟 MLS 實作在 Rust、TS 沒有同級品」是對的，但漏了下半句：
對手是靠放棄網頁版換到 Rust 的。** 我們若走 Rust→WASM，要付的是 WASM 體積與三平台載入；
他們付的是「沒有網頁版」。兩邊都不是免費，**但這讓「照抄他們的技術選擇」不成立**——
他們的取捨前提與我們不同。

另一個可借鑑的點：**他們不自己實作 MLS**。若我們日後要做，同樣不應自己寫——
但 MDK 是 Rust，這又繞回上面那個取捨。

## 2. ⚠ 他們寫下的兩個坑，我們形狀相同

### 2.1 一個共用 client 扮演五種角色 —— 我們一模一樣，而且已經痛了

`docs/relay-control-plane-rearchitecture.md` 開頭：

> The issue is that White Noise currently treats one shared `nostr-sdk::Client` as if it were all of these at once:
> a stable discovery and indexing client / a stable group-message listener / an authenticated inbox listener /
> **an anonymous publisher** / a transient query engine.
> Those workloads need **different relay sets, connection lifetimes, authentication rules, retry policies, and observability.**

對照本專案（已查證）：

- `this.client` **一條連線**同時負責發布（`publishAddressed`）與訂閱；
- 開機時一次 `client.subscribe("all", filters)`，`filters` 裡有 **13 組 `kinds`**——
  presence 心跳、離線私訊收件匣、雲端快照、SDP/通話/在線信令、引導清單、
  **檔案塊**、組織名冊……全部混在同一個訂閱。

**ADR-0288 查到的「檔案塊 filter 沒有水位、離線私訊 filter 有」不是一個孤立的疏漏，
是這個結構的必然症狀**——不同工作負載需要不同的重取策略（收件匣要增量水位、
信令是 ephemeral 不需要、檔案塊需要分頁），塞進同一個訂閱就一定會有人被漏掉。
他們的結論值得抄：**把重取策略當成 plane 的屬性，而不是每個 filter 各自記得要加。**

### 2.2 「帳號範圍是慣例、不是型別保證」——他們已經因此出過 bug

`docs/session-projection-rearchitecture.md`：

> Every account-mutating method takes `pubkey: PublicKey` as an argument. **The compiler can't catch a bug
> that passes the wrong pubkey.** At least one table (`message_delivery_status`) already has a scope bug where
> **sender-local state bleeds across accounts in the same group.**

我們的多身分隔離（ADR-0045）是**命名空間字串前綴**（`nb.<ns>.…`），同樣是慣例不是型別保證。
他們的解法是「每個帳號一個資料庫檔，刪帳號＝`fs::remove_file`」。

⇒ **建議自查**：本專案有沒有同類洩漏（某個以 pubkey 為參數的路徑拿到錯的身分）。
本文**沒有查**——這需要一次針對性審查，不是閱讀對手文件能得到的結論。

### 2.3 檔案過大、單例阻礙測試

他們的觸發點是「核心檔超過 2,000 行、貢獻者不知道新程式該放哪」。
本專案：`relay-backend.ts` **3,819 行**、`App.tsx` **3,740 行**。
⚠ 這是**觀察不是結論**——我們的測試不受單例阻礙（engine 可多實例，本 session 的測試就是這樣寫的），
所以他們三個動機裡我們只命中一個。不必照抄他們的重構，但檔案尺寸值得記在心裡。

## 3. ⚠ 最可行動的發現：「匿名發布」應該是獨立的 plane

他們列的五種角色裡有一項是 **anonymous publisher**，並明確指出問題：

> **Relay auth becomes global even though only some relay classes should auth.**

這句話直接對上 ADR-0237 的洩漏，而且指出了洩漏**發生在哪一側**：

- Gift Wrap 外層由**一次性金鑰**簽署（NIP-59 藏寄件者）——事件本身確實匿名；
- 但**發布走的是 AUTH 成本人的那條連線**（`this.client`），
  而我們的中繼在 `requireAuth` 時**連 EVENT 都要求 AUTH**（`relay/src/relay-core.ts:328`）；
- ⇒ **中繼知道「這顆匿名 wrap 是 Alice 送的」。事件層藏起來的東西，被發布側的連線身分打穿。**

**拆開就能修掉這一半**：
`REQ` 保留 AUTH（收件匣必須只給本人，ADR-0057 的核心），`EVENT` 不要求 AUTH，
發布走一條**不 AUTH 的連線**。反濫用退回既有機制——**NIP-13 PoW（`minPow`，ADR-0002）
與速率限制本來就在那裡**，且它們正是為「無身分的發布者」設計的。

### ⚠ 但這有一個張力，而且它說明 AUTH-on-EVENT 不是疏忽

企業 allowlist（ADR-0044 `allowedAuthors`）要擋「非本組織成員發布」。
而 **Gift Wrap 的 `author` 是一次性金鑰，對 allowlist 完全沒用**
⇒ **AUTH 身分很可能正是 allowlist 唯一的執行點**。拿掉 AUTH-on-EVENT，企業節點的成員管制就破了。

⇒ 只能**分部署**，而且分界線與 ADR-0290 §1 的推播是同一條：

| | AUTH-on-EVENT | 得失 |
|---|---|---|
| **公共節點** | **可拿掉** | 換得寄件者對中繼不可連結（補上 ADR-0237 的一半）；反濫用靠 PoW＋速率 |
| **企業自架節點** | **保留** | allowlist 需要它；且洩漏對象是「你自己的組織」，危害本來就小得多 |

**本文不主張現在改**——這動到 ADR-0057 的既有契約，需要單獨評估
（尤其：拿掉 AUTH 後公共節點的濫用面有多大、PoW 參數夠不夠）。
但它是 ADR-0237 目前列出的緩解（Tier 0/1）之外，**一個成本明確、方向乾淨的新選項**。

## 4. 佐證：他們也走 Blossom

`docs/storage-architecture.md` 的媒體層有 `BlossomClient` 分支（群組圖片、聊天媒體）。
⇒ **佐證 ADR-0288 把 NIP-B7 從 Tier 2 升到第一名的判斷**——這不是我們一廂情願的方向，
是這條路上的人已經在走的。

## 5. 順帶觀察：他們公開記錄「已知接受的風險」

`docs/SECURITY.md` 逐條列出 `cargo audit` 中**刻意忽略的 advisory**，每條都寫
component／severity／justification／risk assessment／mitigation（例如 `rsa` 經由 `sqlx-mysql`
傳遞進來但只用 SQLite，該路徑永不執行）。

⇒ 這與本專案 ADR 的「誠實記錄否決理由」是同一種紀律，只是套用在**依賴風險**上。
本專案目前沒有等價文件。**值得考慮**（尤其若要做企業銷售——這正是資安問卷會要的東西）。

## 決策（研究記錄，未決策）

- 本文**不改變任何產品行為**。
- 最有價值的產出是 §3：**ADR-0237 的洩漏有一半發生在發布側，而那一半有明確解法。**
- 次之是 §2.1：**ADR-0288 的檔案塊問題應該被理解為「訂閱工作負載混用」的症狀**，
  修水位是治標；把重取策略變成 plane 屬性才是治本。

## 後果

- 正面：把對手的工程教訓變成我們的自查清單；為 ADR-0237 找到一個新的緩解方向；
  佐證 Blossom 的優先序；發現我們與對手的技術選擇前提不同（不可直接照抄）。
- 已知限制：
  - **只讀了 repo 的文件、manifest 與少量原始碼路徑，沒有通讀實作**。
  - **兩份 re-architecture 文件是 plan/draft**（session-projection 標 `Drafted: 2026-04-10`），
    **不確定是否已完成**——引用的是他們的「問題陳述」，那部分不受完成度影響，
    但不應據此宣稱他們現在的架構就長那樣。
  - §3 的建議**未做濫用面評估**：公共節點拿掉 AUTH-on-EVENT 之後的實際風險沒有算過。
  - §2.2 的「我們可能有同類 scope bug」**是類比不是發現**——本文沒有查證。
- 後續行動（**皆待決策，本 ADR 不執行**）：
  1. 評估 §3 的「匿名發布 plane」：先算公共節點的濫用面，再決定是否修訂 ADR-0057。
  2. 修 ADR-0288 的檔案塊水位時，順手把「重取策略屬於哪個工作負載」寫成明確結構，
     不要再讓每個 filter 各自記得。
  3. 針對 §2.2 做一次多身分範圍的針對性審查（以 pubkey 為參數的寫入路徑）。
