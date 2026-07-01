# ARCHITECTURE.md — Nostr Buddy 系統架構（草稿）

> 本文件是模組邊界、資料流與初始化規劃的**單一真實來源（SSOT）**。產品行為以 [`PRD.md`](./PRD.md) 為準；本文件定義「落在哪一層、如何連接」。
>
> 狀態：**草稿（M0）**。隨實作推進，模組邊界、事件契約或資料流如有變更，必須同步更新本檔與相關入口文件。

## 1. 設計原則

- **本地優先（Local-First）**：本機 SQLite 是唯一真相來源；網路層只負責同步與轉發。
- **零伺服器狀態**：中繼站不持久化線上狀態與信令（Ephemeral），僅暫存有過期時間的離線留言。Ephemeral 不寫 D1，但仍消耗 Worker 請求數（非零成本）。
- **端到端加密**：明文不離開裝置；內容以 NIP-44 加密。
- **元資料隱藏**：私訊以 NIP-17/59 Gift Wrap 包封收發雙方，中繼站無法重建社交圖譜（詳見 PRD §6–§7 與 `docs/adr/0002`）。
- **靜態落地加密**：私鑰與本機 SQLite 不以明文落地（OS 安全儲存 + 資料庫加密），以對抗設備竊取。
- **雙軌動態切換**：能 P2P 直連就走 WebRTC；不能直連或對方離線時退回 Nostr 中繼；P2P 失敗以 TURN／經中繼降級保底。

## 2. 雙軌混合網路

```text
        ┌─────────────────────────────┐         ┌─────────────────────────────┐
        │        裝置 A（桌面）        │         │        裝置 B（桌面）        │
        │  React UI ── Tauri(Rust)     │         │  React UI ── Tauri(Rust)     │
        │   │            │             │         │             │          │   │
        │  SQLite(SSOT)  金鑰/加密      │         │       金鑰/加密  SQLite(SSOT) │
        └───────┬────────────┬─────────┘         └────┬────────────┬──────────┘
                │            │                         │            │
   引擎 A：Nostr │            │ 引擎 B：WebRTC P2P       │            │ 引擎 A：Nostr
   (WebSocket)  │            └─────────────────────────┘            │ (WebSocket)
                │              即時：Nudge / 檔案 / 動畫              │
                ▼                                                    ▼
        ┌──────────────────────────────────────────────────────────────┐
        │              Cloudflare Worker（Nostr Relay）                  │
        │  Ephemeral(20000-29999)：純記憶體轉發，不寫 D1                  │
        │  離線留言(NIP-17 GiftWrap)：寫入 D1，NIP-40 7 天過期，定時銷毀      │
        └──────────────────────────────────────────────────────────────┘
```

- **引擎 A — Nostr（Cloudflare Workers + D1）**：離線留言暫存、線上狀態廣播、WebRTC 初始 SDP 信令交換。
- **引擎 B — WebRTC（P2P）**：雙方上線並完成 SDP 交換後打通資料通道，後續即時互動繞過中繼站。

## 3. 模組與目錄落點

| 模組 | 目錄 | 職責 |
| --- | --- | --- |
| 共用核心 | `packages/core/` | Nostr 事件建構/驗證、簽章（secp256k1 Schnorr, BIP-340）、加密（NIP-44）、SQLite schema 與型別、事件 Kind 常數。跨平台共用，**SSOT 邏輯所在**。 |
| 桌面前端 | `apps/desktop/src/` | React/TS UI：好友列表、對話視窗、狀態列、Nudge 動畫。 |
| 桌面原生橋 | `apps/desktop/src-tauri/` | Rust：原生 SQLite 讀寫、背景 Nostr WebSocket 長連線、WebRTC 資料通道、金鑰安全儲存、IPC。 |
| 行動端 | `apps/mobile/`（預留） | React Native + SQLite；Silent Push 喚醒背景同步。 |
| 中繼站 | `relay/` | Cloudflare Worker + D1：Nostr relay，處理 Ephemeral 轉發與 NIP-40 過期留言。 |
| 測試 | `tests/` | 跨層整合測試與共用 fixture。 |
| 文件 | `docs/` | 設計決策與流程補充。 |

> 分層原則：TS 共用邏輯一律收斂到 `packages/core/`，不要在 UI 與 Worker 各自重造一份 Nostr/加密邏輯（避免多重 SSOT）。

## 4. 身分與資料模型

- **身分**：首次啟動生成 secp256k1 金鑰對（Nostr/NIP-01，簽章採 BIP-340 Schnorr）；公鑰 `npub` 為全網唯一 ID。私鑰寫入 OS 安全儲存（Keychain/DPAPI/libsecret/Keystore），**絕不離開裝置、無雲端備份、不提供金鑰輪替/撤銷**（取捨見 PRD §4、§7）。
- **SQLite（SSOT）**：好友（npub、顯示名稱、上線狀態）、對話訊息（明文僅存本機）、金鑰、設定、聯絡人同意/封鎖清單。資料庫以裝置綁定金鑰加密落地（如 SQLCipher）；對外傳輸前一律以 NIP-44 加密。
- **多設備同步（首次）**：QR Code 僅含「一次性 AES-256-GCM 金鑰 + 內網 IP + WebRTC 房間號」；通道與該 AEAD 金鑰綁定並雙向認證（challenge-response）。手機端以 **Happy Eyeballs（RFC 8305）** 同時發起 LAN 直連與 WAN 打洞，優先連通者整包加密傳輸 SQLite 與私鑰。
- **多設備同步（持續）**：首次整包同步後，各設備就「新訊息、已讀位置、聯絡人/封鎖變更」持續對帳（自封 NIP-17 同步事件或設備間 P2P）；可變狀態採 LWW/CRDT，定案見 ADR。

## 5. 事件契約（Nostr Kind 對照）

> 內容一律 NIP-44 加密；私訊以 NIP-17（kind 14 → kind 13 seal → kind 1059 Gift Wrap）隱藏收發雙方。中繼站要求 NIP-42 AUTH，持久化事件要求 NIP-13 PoW 並設每 pubkey 速率/大小上限。

| 功能 | Kind | 持久化 | 機制 |
| --- | --- | --- | --- |
| 離線文字留言 | 1059（Gift Wrap，內含 13/14） | D1（NIP-40，7 天過期） | NIP-44 加密 + Gift Wrap 隱藏雙方後存中繼，對方上線拉取解密 |
| 好友上線/離線 | 20000 | 否（Ephemeral） | 每 30 秒心跳；斷線 60 秒判離線；僅向雙向同意聯絡人訂閱 |
| 正在聆聽音樂 | 20002 | 否（Ephemeral） | 系統 API 狀態字串廣播（與上線狀態分流不同 kind） |
| 正在輸入中 | 20001 | 否（Ephemeral） | 對話視窗觸發，中繼轉發 |
| WebRTC SDP 交換 | 21000-21999（NIP-59 包封） | 否（Ephemeral） | 信令交換，純記憶體轉發，避免洩漏「誰呼叫誰」 |
| 震動（Nudge） | — | — | WebRTC Data Channel；P2P 不可用時降級走中繼 |
| 檔案傳輸 | — | — | WebRTC Data Channel，不受 JSON 大小限制；對稱 NAT 經 TURN 保底 |
| 訊息回應（Reaction，✅ M6） | 1059（內含 kind 7） | 依訊息 | NIP-25 emoji 回應，`e` tag 指向目標訊息，Gift Wrap 隱藏雙方（已實作，見 ADR-0011） |
| 收回訊息（Unsend，✅ M6） | 1059（內含 kind 5） | 短期 | NIP-09 刪除，`e` tag 指向目標；收件端顯示「訊息已收回」（已實作，見 ADR-0012） |
| 限時訊息（Disappearing，規劃 M6） | 1059（+較短 NIP-40） | D1 至過期 | 送訊即帶較短過期；客戶端讀後或到期即刪 |
| 語音訊息／貼圖（規劃 M7） | WebRTC / 1059 | P2P 優先 | 錄音與媒體複用檔案分塊傳輸；貼圖以 `pack/id` 參照客戶端渲染 |
| 通話信令（規劃 M8） | 21000-21999（NIP-59 包封） | 否（Ephemeral） | 通話 offer/answer/candidate/hangup，複用 SDP 信令；媒體走 WebRTC track |
| 加好友請求（規劃 M9） | 1059（內含請求 rumor） | D1（NIP-40） | QR/npub 交換後送出，對方核准前不建立聯絡（隱私同意） |
| 群組訊息（規劃 M9） | 待定（群組加密） | — | 需群組金鑰管理（MLS/sender-key），另立 ADR |

## 6. 第一個功能（M1）：Nostr 中繼連線與心跳

**目標資料流**：

```text
本機金鑰 ──簽署──> Kind 20000 心跳事件 ──WebSocket──> Cloudflare Relay
                                                          │（Ephemeral：純轉發，不寫 D1）
好友端 UI <── 渲染上線狀態 <── 訂閱接收 <───────────────────┘
（每 30 秒一次心跳；連續 60 秒未收到即判定離線）
```

**範圍**：relay WebSocket 連線管理、最小 secp256k1 Schnorr 簽章、Kind 20000 心跳發送與訂閱、上線/離線狀態判定與 UI 渲染。
**依賴**：最小金鑰生成（簽章用）。完整身分流程與多設備同步屬後續里程碑。

## 7. 里程碑

> 狀態圖例：✅ 核心邏輯完成且有測試覆蓋（`packages/core` / `relay`）；
> ⏳ 執行期整合（真實 WebRTC / Tauri GUI / Rust 背景連線 / Cloudflare 部署）待具該環境時接線。

- **M0**：文件與專案骨架、pnpm monorepo、ADR 機制。✅
- **M1**：Nostr 中繼連線與心跳。✅ 核心（金鑰/事件/簽章/心跳/上線判定、relay 協定與 Ephemeral 扇出、TS RelayClient、端到端測試）；⏳ Rust 背景長連線(T9 退避邏輯已備)、OS 金鑰儲存、IPC、Worker 部署。
- **M2**：離線文字留言（NIP-17/59 Gift Wrap、NIP-44 加密、NIP-40 過期）。✅ 核心（加密、Gift Wrap、relay 儲存/過期/`#p`、端到端測試）；⏳ Worker D1 綁定、收發 UI。
- **M3**：WebRTC P2P 直連（SDP 信令、Nudge 震動、檔案傳輸）。✅ 核心（信令封裝與端到端交換、資料通道分塊、雙軌降級）；⏳ 真實 `RTCPeerConnection`/ICE/TURN。
- **M4**：多設備同步（QR Code + Happy Eyeballs）。✅ 核心（配對載荷與 AES-GCM 同步包、競速、多設備收斂）；⏳ 真實 LAN/WAN 連線器與背景同步。
- **M5**：經典體驗還原（音樂狀態、正在輸入中）與行動端。✅ 核心（Kind 20001/20002 事件與追蹤器）；⏳ 系統 API 取狀態、行動端。

> 以下為借鏡 LINE 熱門功能的路線圖（📋 規劃中，見 `docs/adr/0010`）：

- **M6**：訊息互動——訊息回應（NIP-25）、收回訊息（NIP-09）、限時訊息（NIP-40 較短過期）。📋
- **M7**：富媒體——語音訊息、圖片/媒體相簿（複用檔案傳輸 + 本機媒體庫）、貼圖包。📋
- **M8**：語音/視訊通話——WebRTC media track，信令複用 SDP 信令通道。📋
- **M9**：聯絡人與群組——QR 加好友（`npub` 交換 + 同意流程）、群組聊天（群組加密待 ADR）。📋

## 8. 待決議（Open Questions）

- 中繼站採自建 Worker relay 還是相容既有 Nostr relay 實作？
- `packages/core` 的加密原語選型（Web Crypto vs Rust 端 `ring`/`ed25519-dalek`）與跨平台一致性策略。
- monorepo 工具（pnpm workspace / turborepo）與行動端共用程度。
- ~~Ephemeral 心跳的 Worker 請求容量估算與批次/合併策略~~（已由 `docs/adr/0006` 定案：30s 心跳 + jitter，免費天花板約數十並行使用者，列出擴充旋鈕）。
- 是否導入棘輪（Double Ratchet）以取得前向保密／後妥協安全，或維持 Nostr 靜態金鑰模型（另立 ADR）。
- 多設備持續同步的衝突解法（LWW vs CRDT）定案。
- 群組聊天（M9）的群組加密方案（MLS vs sender-key）與多設備下的群組金鑰管理（另立 ADR）。
- 語音訊息（M7）離線傳遞受中繼大小限制時的退回策略。

> 已定案決策見 `docs/adr/`（例如 `0002` 隱私元資料與協定基線、`0010` LINE 借鏡功能路線圖）。
