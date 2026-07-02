# Nostr Buddy

> 去中心化、無中央資料庫的即時通訊軟體。融合 **Nostr 協議** 與 **WebRTC**，高度還原早期 MSN Messenger 的經典互動體驗（震動、音樂狀態、離線留言），並以「零伺服器維護成本」為營運目標。

## 簡介

Nostr Buddy 透過「狀態信令」與「巨量資料傳輸」雙軌混合網路，達成極致隱私與低延遲：

- **零知識身分**：首次啟動於本機生成 secp256k1 金鑰對（Nostr/NIP-01），公鑰（`npub`）即為全網唯一 ID，無帳號密碼。
- **純本機資料庫**：以本機 SQLite 作為唯一真相來源（SSOT），對話與金鑰永不上雲，為未來本地 AI（RAG 摘要）預留封閉環境。
- **端到端加密**：訊息以本機私鑰加密後才離開裝置。
- **零責任歸屬**：不提供助記詞或雲端備份；設備與本機資料庫全毀即代表帳號永久死亡。

## 技術架構摘要

雙軌混合網路（依連線狀態動態切換）：

| 引擎 | 技術 | 定位 |
| --- | --- | --- |
| **引擎 A：狀態與信令** | Nostr 協議（Cloudflare Workers + D1） | 離線留言暫存、線上狀態廣播、WebRTC 初始 SDP 信令交換 |
| **引擎 B：巨量資料傳輸** | WebRTC 直連（P2P） | 即時互動：震動（Nudge）、動畫快遞、大檔案傳輸，繞過中繼站達成毫秒級延遲 |

資料生命週期靠 **NIP-40**（7 天過期）與 **Ephemeral Events**（Kind 20000-29999 純記憶體轉發、不寫資料庫），確保 Cloudflare 永久免費額度不被耗盡。

### 終端平台

- **桌面端（第一優先）**：Rust **Tauri** + **React/TypeScript**。背景 WebSocket 長連線 + 原生 SQLite 持久化。
- **行動端（輔助）**：**React Native** + SQLite。透過 Cloudflare Worker 的無聲推播（Silent Push）喚醒背景同步。
- **網頁版**：刻意捨棄（瀏覽器會靜默清空 IndexedDB，在無中央備份下將造成不可挽回的資料遺失）。

完整技術規格見 [`PRD.md`](./PRD.md)，模組邊界與資料流見 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

## 專案結構

```text
.
├── apps/
│   ├── desktop/        # Tauri + React + TypeScript（第一優先平台）
│   │   ├── src/        # React/TS 前端 UI 與瀏覽器 demo（demo.html / webrtc.html）
│   │   └── src-tauri/  # Rust：SQLite、Nostr WebSocket、WebRTC、金鑰管理
│   └── mobile/         # React Native + SQLite（輔助平台，預留）
├── packages/
│   └── core/           # 共用 TS：Nostr 事件、secp256k1 簽章、NIP-44/17/59、型別、Kind 常數
├── relay/              # Cloudflare Worker（Nostr 中繼站；Durable Objects 扇出，離線留言預留 D1）
├── docs/adr/           # 架構決策紀錄（ADR）
└── claude/             # AI 協作規範與開發指南
```

## 目前實作狀態

M1–M5 的**核心邏輯已實作並通過測試**（pnpm monorepo、TypeScript strict、全程 TDD）：

| 里程碑 | 範圍 | 狀態 |
| --- | --- | --- |
| M1 | 心跳/上線狀態、relay 協定與 Ephemeral 扇出、TS RelayClient | ✅ 核心 |
| M2 | 離線留言（NIP-44 加密、NIP-17/59 Gift Wrap、relay NIP-40 儲存） | ✅ 核心 |
| M3 | WebRTC 信令封裝、資料通道分塊、雙軌降級策略 | ✅ 核心 |
| M4 | QR 配對 + AES-256-GCM 同步包、Happy Eyeballs 競速、多設備收斂 | ✅ 核心 |
| M5 | 正在輸入中、音樂狀態 | ✅ 核心 |

- **測試**：TS 96（core 69 / relay 23 / desktop 4）＋ Rust 4，含 relay↔client 端到端整合測試。
- **可眼見**：桌面前端（`/`）是一套還原早期即時通體驗的客戶端（登入、聯絡人分組、對話視窗、表情、Nudge 震動、輸入中、音樂狀態）；另有端到端 `demo.html` 與真實 WebRTC `webrtc.html`。皆已用 Playwright 實機驗證。
- **尚待執行期環境**（⏳）：真實 WebRTC（`RTCPeerConnection`/ICE/TURN）、Tauri GUI 與 Rust 背景連線、OS 金鑰儲存、Cloudflare Worker 部署。詳見 [`ARCHITECTURE.md`](./ARCHITECTURE.md) §7 與 [`docs/adr/`](./docs/adr)。
- **完整施工計畫**（現況、各平台待辦、M6–M9 進階功能、相依順序）：見 [`docs/ROADMAP.md`](./docs/ROADMAP.md)。

## 開發指令

需求：Node 22+、pnpm 10+（Rust 測試另需 stable toolchain）。

```bash
pnpm install            # 安裝 workspace 相依
pnpm -r test            # 所有 TS 測試（core / relay / desktop）
pnpm -r typecheck       # 所有套件型別檢查
```

| 任務 | 指令 |
| --- | --- |
| 桌面前端（懷舊即時通風格） | `pnpm --filter @nostr-buddy/desktop dev`，開啟 `/`（另有端到端 demo `/demo.html`、真實 WebRTC `/webrtc.html`） |
| 前端建置 | `pnpm --filter @nostr-buddy/desktop build` |
| 共用核心測試 | `pnpm --filter @nostr-buddy/core test` |
| 中繼站測試 | `pnpm --filter @nostr-buddy/relay test` |
| 本機真實 relay（開發用） | `pnpm --filter @nostr-buddy/relay build:dev && pnpm --filter @nostr-buddy/relay dev`（起 `ws://localhost:8787`；前端開 `/?relay=ws://localhost:8787` 即連真實 relay） |
| Rust 測試 | `cargo test`（於 `apps/desktop/src-tauri/`） |
| 桌面端開發（需 Tauri 工具鏈） | `pnpm --filter @nostr-buddy/desktop tauri dev` |
| 中繼站本地開發 / 部署（需 wrangler） | `wrangler dev` / `wrangler deploy`（於 `relay/`） |

## 🚀 在 Cloudflare Workers 架設中繼站（Nostr / WebRTC 信令 relay）

中繼站（`relay/`）是一個自建的最小 Nostr relay，跑在 Cloudflare Workers 上，以
**Durable Object** 持有所有 WebSocket 連線並做記憶體扇出。它的職責是：

- **線上狀態廣播**（心跳 Kind 20000）、**正在輸入中**（20001）、**音樂狀態**（20002）；
- **WebRTC 的 SDP / ICE 信令交換**（NIP-59 包封的 ephemeral 事件，Kind 21000-21999）；
- （規劃中）**離線留言**暫存（NIP-17/59 Gift Wrap + NIP-40 過期，需接 D1）。

> WebRTC 一旦 P2P 打通，**震動、檔案傳輸等資料完全走點對點，永遠不經過 relay**。
> Ephemeral 事件只在記憶體轉發、不落地；relay 看不到訊息明文，也看不到（經 Gift Wrap 隱藏的）社交圖譜。

### 前置需求

- 一個 [Cloudflare 帳號](https://dash.cloudflare.com/sign-up)
- Node 22+、pnpm 10+
- **注意**：本 relay 使用 Durable Objects。Durable Objects 目前需要 **Workers 付費方案（約 US$5/月）** 或符合 Cloudflare 當前免費方案條件——部署前請以 [官方計費說明](https://developers.cloudflare.com/durable-objects/platform/pricing/) 為準。

### 步驟

```bash
# 1. 取得原始碼並安裝相依（會建立 workspace 連結，wrangler 打包時需要）
git clone <your-fork-url> nostr-buddy && cd nostr-buddy
pnpm install

# 2. 登入 Cloudflare（會開瀏覽器授權）
cd relay
pnpm dlx wrangler login

# 3. 本地開發：在 ws://127.0.0.1:8787 起一個本機 relay
pnpm dlx wrangler dev

# 4. 部署到 Cloudflare，取得 wss://nostr-buddy-relay.<你的帳號>.workers.dev
pnpm dlx wrangler deploy
```

部署設定在 [`relay/wrangler.toml`](./relay/wrangler.toml)：Worker 名稱、進入點 `src/worker.ts`、
以及 Durable Object 綁定（`RELAY_ROOM` → `RelayRoom` 類別與 migration）。wrangler 會直接打包
TypeScript，無需額外建置步驟。可在 `wrangler.toml` 修改 `name` 換成你自己的 Worker 名稱。

### 連線測試

relay 講標準 Nostr 的 `REQ` / `EVENT` / `CLOSE` 協定，可用 `@nostr-buddy/core` 的 `RelayClient`：

```ts
import { RelayClient, createHeartbeat, generateSecretKey } from "@nostr-buddy/core";

const ws = new WebSocket("wss://nostr-buddy-relay.<你的帳號>.workers.dev");
const sk = generateSecretKey();
const client = new RelayClient(
  { send: (data) => ws.send(data) },
  { onEvent: (subId, event) => console.log("收到", subId, event) },
);

ws.addEventListener("message", (m) => client.receive(m.data));
ws.addEventListener("open", () => {
  client.subscribe("presence", [{ kinds: [20000] }]); // 訂閱上線心跳
  client.publish(createHeartbeat(sk));                 // 廣播自己的心跳
});
```

桌面/前端可把這個 `wss://` 位址設定為連線端點（見 `apps/desktop/src/relay-source.ts`）。

### 容量與成本

Ephemeral 心跳會隨上線人數扇出，請參考 [`docs/adr/0006`](./docs/adr/0006-heartbeat-capacity-and-free-tier.md)
的容量估算（免費層約可支撐數十位並行使用者，並列出心跳間隔/合併/抖動等可調旋鈕）。

### 加上離線留言（D1，下一步）

離線留言需要持久化。在 `wrangler.toml` 加一個 D1 綁定、於 `worker.ts` 把
`RelayCore` 接上以 D1 為後備的 `MessageStore`（行為已由 `relay/src/message-store.ts`
定義並測試：NIP-40 過期、每收件人配額、以 `#p` 為索引）。詳見
[`docs/adr/0005`](./docs/adr/0005-relay-self-built-worker.md)。

## 開發規範

本專案採 AI 協作開發，硬規則如下（詳見 [`CLAUDE.md`](./CLAUDE.md)、[`gemini.md`](./gemini.md) 與 [`claude/`](./claude)）：

- **單一真實來源（SSOT）**：產品需求看 `PRD.md`，模組與資料流看 `ARCHITECTURE.md`。
- **Architecture First / Search First**：先定位模組、再讀現有實作、最後才動手。
- **Fix First**：延伸既有設計，不建立 `v2`、`new_*`、`*_enhanced` 平行路徑。
- **TDD**：功能程式碼遵循 Red → Green → Refactor，測試即文件。
- **本地優先與低延遲**：任何變更都不得破壞訊息即時性與隱私預設。

## 貢獻

歡迎參與！送 PR 前請留意：

- 先讀 [`PRD.md`](./PRD.md)（產品規格）、[`ARCHITECTURE.md`](./ARCHITECTURE.md)（模組與資料流）與 [`docs/adr/`](./docs/adr)（既有決策）。
- 功能程式碼採 **TDD**；送交前確保 `pnpm -r typecheck` 與 `pnpm -r test` 全綠（CI 也會檢查）。
- 架構/協定/隱私取捨等決策，請新增一份 ADR（格式見 [`docs/adr/0000-template.md`](./docs/adr/0000-template.md)）。
- 隱私是第一原則：任何變更都不得讓明文或私鑰離開裝置，或在未經 Gift Wrap 隱藏的情況下洩漏社交圖譜。

提交即表示你同意以本專案授權（AGPL-3.0）釋出你的貢獻。

## 安全性

這是一套處理端到端加密與私鑰的軟體，目前仍在開發階段、**尚未經過安全稽核**，請勿用於高風險場景。
發現安全問題請以私下管道回報，不要開公開 issue。完整的安全政策、加密盤點、威脅模型逐項盤點與**已知限制清單**見 [`docs/SECURITY.md`](./docs/SECURITY.md)。

## 授權

本專案採用 **GNU Affero General Public License v3.0（AGPL-3.0）**——詳見 [`LICENSE`](./LICENSE)。

這代表你可以自由使用、修改與散布；但若你**散布修改版，或將修改版作為網路服務（例如自架本中繼站）提供給他人**，
就必須以相同授權公開你的原始碼（AGPL 第 13 條）。此選擇是為了確保所有衍生版本與自架的 relay 都對使用者保持透明、可審計，貫徹本專案的隱私與去中心化精神。

Copyright (C) 2026 Nostr Buddy contributors.
