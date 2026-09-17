# 研究：Cinderous 檔案傳輸現況審計與前沿協議借鑑——大檔案突破與海量小檔案串流折疊優化藍圖

> **研究目的**：全面審計 Cinderous 現行檔案傳輸機制（WebRTC DataChannel P2P ✕ Nostr 離線信箱），深入剖析在面對「單一超大檔案（>100MB ~ GB 級）」與「海量小檔案（數百至數千檔 / 專案資料夾）」時的底層物理極限與架構瓶頸；借鑑業界成熟開源協議（tus.io、Tar-over-SSH、W3C Streams、Git Packfile、BitTorrent Merkle Tree 與 WebTransport），提出兼顧「零伺服器成本、極致隱私、高吞吐量」之工程演進藍圖。  
> **相關文檔**：ADR-0008（WebRTC 信令與通道）、ADR-0017（P2P 傳檔）、ADR-0029（二進位框架）、ADR-0093（元資料中繼化）、ADR-0103/0104（原生選檔與拖放）、ADR-0119/0128（partfile 檔案防禦）、ADR-0124（群組傳檔）、ADR-0162（組織 Relay 離線分塊暫存）、ADR-0273（圖片 EXIF／GPS 擦除）、**ADR-0355（本稿的審查結論與實施順序）**。  
> **文件狀態**：研究稿（已審查）——決策見 **ADR-0355**；2026-09-17 依審查結論回寫修正，原稿需更正處以「🔴 審查修正」標示。

---

## 🔴 二次修正（2026-09-17 對齊 origin/main 之後）

本稿與第一版審查結論都是在一棵**落後 origin/main 23 個 commit** 的樹上寫的。對齊之後發現：

- §2 的「串流化送出」與「串流化落盤」**遠端已經做完了**，分別是 **ADR-0346**（`OutgoingFileStream`／
  `blobStream`，惰性來源）與 **ADR-0347**（`FileSink.write(offset, chunk)`，來一塊寫一塊），
  桌面的原生暫存區則是 **ADR-0349**（`inbox.rs`）。單檔上限也已放寬到 1 GiB。
- 因此 **ADR-0355 的範圍縮小成本稿剩下的三件事**：合集（大量小檔／資料夾）、斷點續傳、整檔校驗，
  而且全部建在上述既有介面之上，不另立平行路徑。
- 本稿原先預留的「壓縮／依賴選型待決」也已解掉：tar 自己寫、不壓縮，零新相依。

## 🔴 審查修正摘要（2026-09-17，對應 ADR-0355）

§1 的現況審計經逐項對照 `datachannel.ts`、`webrtc.ts`、`App.tsx`、`ConversationWindow.tsx`、`relay-backend.ts`、`file-relay.ts` **全部屬實**，且 ADR 索引中無任何一份處理過大檔串流、續傳或資料夾打包，空缺為真。處方部分需修正四點：

1. **自動打包會繞過 ADR-0273 的圖片清理**：`sanitizeImage` 在送出前逐檔擦除 EXIF／GPS；先折疊成 tar 再送，圖片變成「檔案內容」，清理不會執行 ⇒ **清理必須先於打包**。
2. **解包是路徑穿越入口**（zip-slip）：tar entry 可含 `../` 或絕對路徑；ADR-0119/0128 的 `sanitize_filename` 目前只管單一檔名 ⇒ 解包須逐 entry 消毒並限制在目標目錄之下。
3. **「>3 檔自動打成 tar」改變 IM 體驗**：收件端拿到壓縮包而非可預覽的相片 ⇒ 多檔走 §3.2 方案 B（批次清單）；tar 只用於**拖放資料夾**。
4. **ADR-0162 的 16 MB 是刻意的配額設計**，大檔本來就只走 P2P ⇒ relay 暫存上限**不放寬**。

另：上限不是「移除」而是改為**磁碟／OPFS 配額檢查**；接收端落盤要 **≥1 MiB 批次寫入**，不是每 16 KB 一次 Tauri IPC。實施順序改為：串流 I/O → 批次多檔幀 → 資料夾打包（選配）→ 續傳；群組 Micro-Swarm 否決。

---

## 結論摘要 (Executive Summary)

1. **現況架構定位**：
   - Cinderous 建立了極為優雅的「Nostr NIP-59 隱私信令 ✕ WebRTC DataChannel P2P」傳輸雙軌，具備 **16 KB 二進位框架（ADR-0029，省去 Base64 33% 膨脹）** 與 **1 MiB 高水位發送端背壓控制（Backpressure）**。
   - 但其本質定位為「IM 聊天日常相片、短語音與小型辦公文件交換」，**未針對大檔案與海量小檔案做架構特化**。
2. **大檔案致命瓶頸**：
   - **純記憶體加載（In-Memory Buffering）**：發送端 `await f.arrayBuffer()` 一次性吃滿 RAM；接收端在 RAM 中開闢整塊 `new Uint8Array(size)` 拼接。
   - **硬性上限防爆**：`DEFAULT_MAX_FILE_SIZE` 寫死 **100 MiB**（超過直接拒收）；組織 Relay 離線模式上限更嚴苛至 **16 MB**。
   - **無斷點續傳**：P2P 中途斷線則當前檔案所有已收分塊整檔丟棄，必須從第 0 位元組重新傳送。
3. **海量小檔案致命瓶頸**：
   - **逐檔握手與元資料廣播 ($O(N)$ 乘法爆炸)**：若拖入 500 個小檔案，系統會發送 500 次獨立 Nostr 加密事件（kind 1059）、500 次 `file-begin` 控制握手，接收端跳出 500 次儲存對話框。
   - **資料夾拖放直接略過**：`file-drop.ts` 遇目錄直接回傳 `null` 略過。
   - **群組傳檔頻寬放大（ADR-0124）**：群組無群播，10 人群組傳 50 個小檔等同在背景進行 500 次獨立傳輸。
4. **推薦最佳落地處方**（🔴 審查修正：順序依 ADR-0355）：
   - **第一段：大檔案 ➔ 借鑑 W3C Streams**：以流式讀寫取代全量 RAM 加載（記憶體佔用降至恆定 2MB），100 MiB 常數改為**磁碟／OPFS 配額檢查**；不動 ADR-0162 的 relay 暫存上限。
   - **第二段：多檔 ➔ 批次清單多檔幀（§3.2 方案 B）**：一次握手、一則元資料，每個檔案仍可單獨預覽；每檔照舊先過 `sanitizeImage`。
   - **第三段：資料夾 ➔ Tar 串流（§3.2 方案 A，限拖放資料夾、選配）**：先清理後打包、解包逐 entry 消毒。
   - **第四段：續傳（tus 式 bitset）＋整檔 SHA-256**。
   - ~~海量小檔案 ➔ Tar-over-SSH 最優先實作~~ 🔴 不採用為第一步：先做會引進隱私回歸（繞過 ADR-0273）與新依賴，而硬上限未解。

---

## 1. Cinderous 既有傳輸機制深度審計

```
                                【傳輸請求入口】
                                       │
            ┌──────────────────────────┴──────────────────────────┐
    【軌道 A：WebRTC DataChannel P2P】                  【軌道 B：企業 Relay 離線暫存】
    (packages/engine/src/backend/webrtc.ts)             (packages/core/src/file-relay.ts)
            │                                                     │
 1. 經 Nostr NIP-59 (kind 21000) 交換 SDP/ICE          1. 切分為 48 KB 明文分塊
 2. 建立 P2P WebRTC DataChannel ("buddy")                 (`FILE_CHUNK_BYTES = 48_000`)
 3. 先發送 `file-begin` JSON 控制幀                   2. 封裝為 NIP-44 加密事件
 4. 連續發送 16 KB 二進位分塊 (`[type][id][seq][data]`)     `FILE_WRAP (kind 1060)`
 5. 並行向 Relay 發送一則加密元資料 (kind 1059，ADR-0093) 3. 存入 Relay 專屬 500MB 配額桶
 6. 接收端在記憶體 Map 收集後拼裝完整 ArrayBuffer        4. **硬性限制：單檔 ≤ 16 MB (360塊)**
 7. **硬性限制：單檔 ≤ 100 MiB (超限直接拋錯)**
```

### 1.1 既有實作優點
1. **二進位框架與零拷貝（ADR-0029）**：
   - 自訂二進位幀：`[FRAME_CHUNK=1 (1B)][idLen (1B)][id (ASCII)][seq (uint32 BE, 4B)][raw bytes]`。
   - `dc.binaryType = "arraybuffer"`，分塊直接送出原生二進位緩衝區，杜絕 Base64 膨脹與 JSON 序列化 CPU 負擔。
2. **流量控制背壓機制（Backpressure）**：
   - `webrtc.ts` 定義 `HIGH_WATER = 1 << 20`（1 MiB）。
   - 當 `dc.bufferedAmount > HIGH_WATER` 時，`flush()` 自動暫緩並透過 `setTimeout(pump, 50)` 等待緩衝區排空，防止無節制將資料灌入網路層導致記憶體爆炸。
3. **元資料中繼化解耦（ADR-0093）**：
   - 大檔案二進位位元組走 P2P（零伺服器成本），同時向 Relay 發送一則輕量加密元資料（kind 1059）。多設備情境下一台設備收到二進位位元組，另一台設備也能在 UI 上看到「📎 檔案通知」，兼顧多終端同步與頻寬節省。
4. **本機落盤防禦（`partfile.rs` / ADR-0119）**：
   - 檔名消毒 `sanitize_filename`：過濾路徑穿越（`../`）與 Windows 保留字元（`CON`, `PRN`, `AUX`, `COM1-9` 自動加上前綴底線 `_`）。
   - 圖片隱私清理 `sanitizeImage`（ADR-0273）：圖片送出前主動擦除 EXIF 與 GPS 定位。

---

## 2. 針對「大檔案傳送」的瓶頸剖析與改良協議借鑑

### 2.1 物理痛點與當前限制
1. **全記憶體加載（RAM Exhaustion）**：
   - 發送端：[`App.tsx` L2381](../../apps/desktop/src/App.tsx#L2381) 執行 `const raw = new Uint8Array(await f.arrayBuffer())`，若發送 1GB 檔案，V8 堆疊記憶體瞬間暴漲 1GB。
   - 接收端：[`datachannel.ts` L263](../../packages/core/src/datachannel.ts#L263) 執行 `const bytes = new Uint8Array(partial.meta.size)`，在 RAM 中完整組裝。
   - 為防止崩潰，核心層寫死 `DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024`（100 MiB），超過直接報錯。🔴 審查修正：串流化後此常數**不是移除**，而是改為「軟上限＋`file-begin` 時檢查目標磁碟／OPFS 可用空間」——零伺服器狀態下客戶端磁碟是唯一儲存，塞滿磁碟比拒收更糟。
2. **無斷點續傳（Zero Resumability）**：
   - WebRTC 連線在中途斷開時，已接收的 chunks 全數消失，重新傳輸必須從 0% 重來。
3. **無區塊校驗和（Integrity Blind Spot）**：
   - 分塊未附帶 Checksum，依賴底層 WebRTC SCTP 封包校驗，若應用層重組出錯或軟體 bug 導致位元組翻轉，無法在傳輸中途精準發現。

### 2.2 前沿協議借鑑與改良方案

#### 方案 A：借鏡 W3C Streams & Rclone —— 流式讀寫徹底去除 RAM 瓶頸
- **機制**：
  - 發送端：以 `f.stream().getReader()`（Web）或 Rust 檔案讀取流（Tauri），每次只讀取 16 KB 數據。配合現有的 1MB 背壓控制，**發送端全生命週期記憶體佔用穩定在 2MB 以內**。
  - 接收端：收到 `file-begin` 後，立即在磁碟或 OPFS 開闢寫入流（WritableStream / Tauri fs），不再於記憶體中維護整塊陣列。🔴 審查修正：Tauri 端以 **≥1 MiB 批次**寫入 `.cinder-part`（延伸 ADR-0119 的 `partfile.rs`），不是每 16 KB 一次 IPC；瀏覽器端走 ADR-0111 已在用的 OPFS。
- **收益**：解除 100 MiB 硬性上限；實際預設上限在實作 PR 量測後定，並受磁碟配額檢查約束。

#### 方案 B：借鏡 tus.io —— 分塊狀態機與 P2P 斷點續傳
- **機制**：
  - 擴充 `packages/core/src/datachannel.ts` 的 `DataMessage` 控制幀：
    ```typescript
    | { t: "file-query"; id: string }
    | { t: "file-status"; id: string; receivedChunks: number[] } // 或壓縮的 Bitset
    ```
  - 接收端收到分塊寫入 `.cinder-part` 臨時檔，並記錄已收到的區塊清單。
  - 斷線重連或手動重試時，發送端發送 `file-query`，接收端回傳 `file-status`，發送端只發送缺失的區塊。
- **收益**：大檔案傳輸具備工業級容錯能力，惡劣網路環境下斷線重連無縫續傳。

#### 方案 C：借鏡 BitTorrent v2 (BEP 52) —— 默克爾樹區塊校驗
- **機制**：
  - 在 `file-begin` 宣告檔案的 SHA-256 Merkle Root Hash。
  - 每個 16KB 分塊可計算獨立哈希校驗，接收端邊收邊驗，損壞區塊當場單獨重傳。

---

## 3. 針對「海量小檔案傳送」的瓶頸剖析與改良協議借鑑

### 3.1 物理痛點與當前限制
1. **$O(N)$ 乘法放大災難**：
   - 拖入 1,000 個小檔案（如原始碼、相簿）時，[`ConversationWindow.tsx` L1141](../../apps/desktop/src/ui/ConversationWindow.tsx#L1141) 使用 `for (const f of files) props.onSendFile(f)`。
   - 產生 1,000 則 Nostr kind 1059 加密元資料訊息 ➔ 中繼站瞬間被刷爆；
   - 產生 1,000 次 `file-begin` 握手與 `outbox.shift()` 循序排隊；
   - 接收端跳出 1,000 次原生檔案另存對話框。
2. **資料夾（Directories）直接被放棄**：
   - [`file-drop.ts`](../../apps/desktop/src/native/file-drop.ts) 與 [`App.tsx` L2407](../../apps/desktop/src/App.tsx#L2407) 呼叫 `readFileAtPath(path)`，遇到資料夾時回傳 `null` 並直接忽略，無法傳送資料夾結構。
3. **群組傳檔的頻寬極限乘數（ADR-0124）**：
   - 群組內傳檔必須對每一位成員各走一條 P2P 連線（$N$ 份拷貝）。在 10 人群組傳送 100 個檔案，發送端需執行 $100 \times 10 = 1,000$ 次傳輸，上行頻寬嚴重飽和。

### 3.2 前沿協議借鑑與改良方案

#### 方案 A：借鏡 Tar-over-SSH —— 客戶端串流打包折疊（Streaming Tarball）
> ~~這是對 Cinderous 現狀收益最高、程式碼改動最小的降維打擊方案！~~
> 🔴 **審查修正（ADR-0355 §3）**：改為**選配、限拖放資料夾**。多檔不自動打包（改變 IM 體驗，收件端失去逐檔預覽）。打包前**逐檔先過 ADR-0273 圖片清理**；解包端**逐 entry 套 `sanitize_filename`、拒絕 `..`／絕對路徑／符號連結**（zip-slip）；依賴選型（`fflate` 或 `tar-stream`，repo 目前皆無）為外部依賴決策，實作 PR 須附體積與授權比較。瀏覽器模式無資料夾寫入能力，收到即存 `.tar`。

- **機制**：
  - 在 Tauri 端引入極輕量、純 JS/TS 的流式 Tar 打包器（瀏覽器版可不載入）。
  - **觸發規則**（🔴 修正）：僅當**拖放目標為資料夾**時：
    1. 在記憶體/管道中自動將多個小檔案封裝為單一連續串流：`bundle-[時間戳].tar`；
    2. Nostr 中繼**僅發送 1 則元資料訊息**（帶有標籤 `tags: [["type", "archive"], ["file_count", "100"]]`）；
    3. WebRTC 通道上**只傳輸 1 個連續二進位串流**，零 RTT 往返等待；
    4. 接收端收到後，Tauri 桌面端可自動解壓縮還原資料夾結構，或在聊天視窗中呈現為「可展開預覽的檔案合集卡片」。
- **收益**：**將 1,000 個小檔案的網路往返與中繼事件由 $O(N)$ 降為 $O(1)$**，傳輸速度暴增數十倍，同時原生解鎖「整個專案資料夾拖放傳送」。

#### 方案 B：借鏡 Git Packfile —— 批次清單（Batch Manifest）多檔幀
> 🔴 **審查修正（ADR-0355 §2）**：**這才是多檔情境的採用方案**——聊天情境需要逐檔預覽與單次儲存詢問；批次只是傳輸層聚合，每檔照舊先過 `sanitizeImage`；幀格式擴充沿用 ADR-0029 的版本欄位向前相容，舊客戶端退回逐檔模式。群組（ADR-0124）沿用逐成員扇出，但一批一次握手。

- **對話框中依然展示一個個獨立檔案，而非壓縮包**：
- **機制**：
  - 擴充資料通道協議，新增 `batch-begin` 控制幀：
    ```json
    {
      "t": "batch-begin",
      "batchId": "b_123",
      "files": [
        { "fileIndex": 0, "name": "app.ts", "size": 1200 },
        { "fileIndex": 1, "name": "style.css", "size": 3400 }
      ]
    }
    ```
  - 二進位幀修改為包含 `fileIndex`：`[FRAME_CHUNK][batchId][fileIndex][seq][data]`。
  - 所有小檔案在單一連續管線中緊湊傳輸，完全消滅每檔獨立的 `file-begin` 狀態機等待。

#### 方案 C：借鏡 BitTorrent Swarm —— 群組微集群對等互補（Micro-Swarm）
> 🔴 **審查修正（ADR-0355 §5）：否決。** 需要多節點狀態協調與成員間額外 P2P 排程，複雜度與「成對加密、無群組共用金鑰」（ADR-0027）的容量模型不成比例；群組大檔頻寬倍數另案評估。以下保留為研究記錄。

- **機制（針對 ADR-0124 群組傳檔優化）**：
  - 在多人群組中，發送端不再對 10 個人各自全量上傳 100% 檔案；
  - 發送端將前 50% 分塊發給成員 A，後 50% 分塊發給成員 B；
  - A 與 B 之間本就存在 P2P 通道，雙方自動對傳缺漏分塊；
  - 發送端上行頻寬壓力直接減半，解決群組傳大檔案/多檔案時的癱瘓問題。

---

## 4. 具體工程改造路徑與代碼修改指引

```
+===================================================================================================+
|                                  Cinderous 檔案傳輸升級工程矩陣                                    |
+-------------------+---------------+---------------------------------------+-----------------------+
| 升級方向          | 推薦實作方式  | 核心修改檔案與符號                    | 預估難度 / 優先級     |
+-------------------+---------------+---------------------------------------+-----------------------+
| **① 多小檔折疊**  | 客戶端流式    | • `apps/desktop/src/App.tsx`          | 🟡 中等 / 第三段(選配)|
| (Streaming Tar)   | 限拖放資料夾  |   (僅資料夾；先清理後打包)            | (🔴 見 ADR-0355 §3)   |
|                   |               | • `apps/desktop/src/ui/Conversation`  |                       |
+-------------------+---------------+---------------------------------------+-----------------------+
| **② 大檔流式讀寫**| W3C Streams / | • `packages/core/src/datachannel.ts`  | 🟡 中等 / 第一段      |
| (Stream I/O)      | Tauri fs 管道 |   (移除 DEFAULT_MAX_FILE_SIZE 限制)   | (徹底打破 100MB 上限) |
|                   |               | • `packages/engine/src/backend/webrtc`|                       |
|                   |               |   (改用 Readable/WritableStream)      |                       |
+-------------------+---------------+---------------------------------------+-----------------------+
| **③ 斷點續傳**    | tus 式狀態機  | • `packages/core/src/datachannel.ts`  | 🟡 中等 / 第四段      |
| (Resumable Part)  | + Bitset 點陣 |   (新增 file-query / file-status 幀)  | (提升弱網傳輸強韌度)  |
|                   |               | • `DataChannelReceiver` (寫入 .part)  |                       |
+-------------------+---------------+---------------------------------------+-----------------------+
| **④ 群組對等互傳**| Micro-Swarm   | • `packages/engine/src/backend/`      | 🔴 否決（ADR-0355 §5）|
| (P2P Swarm)       | 區塊互補分發  |   `relay-backend.ts` (sendGroupFile)  | (需多節點狀態協調)    |
+-------------------+---------------+---------------------------------------+-----------------------+
```

### 具體改造步驟（🔴 審查修正：以 ADR-0355 待辦為準，上表的優先級以此為準）
1. **第一段：串流 I/O**——`App.tsx` 改 `File.stream()`；`DataChannelReceiver` 移除 `new Uint8Array(meta.size)`，Tauri 走 `partfile.rs` 批次落盤、瀏覽器走 OPFS；`DEFAULT_MAX_FILE_SIZE` 改為軟上限＋磁碟配額檢查（TDD，先寫接收端測試）。ADR-0162 的 relay 暫存上限不動。
2. **第二段：批次多檔幀**——`batch-begin` 控制幀＋`fileIndex` 幀欄位，取代 `ConversationWindow.tsx` 的逐檔迴圈；一批一則 kind 1059 元資料；多檔卡片 UI；每檔仍先過 `sanitizeImage`。
3. **第三段：資料夾打包（選配）**——僅拖放資料夾觸發；先清理後打包；解包逐 entry 消毒；依賴選型另附比較。
4. **第四段：續傳**——`file-query`／`file-status` bitset 控制幀＋`.cinder-part` 側錄檔；`file-begin` 帶整檔 SHA-256，分塊 Merkle 校驗列為可選延伸。
5. **同步更新 `ARCHITECTURE.md` 資料通道協定段。** 群組 Micro-Swarm 否決。
