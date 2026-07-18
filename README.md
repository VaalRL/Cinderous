> 🌐 **English** · [English version](./README.en.md)

# Cinderous

> **Life is short, connect buddies.**

> 去中心化、無中央資料庫的即時通訊軟體。融合 **Nostr 協議** 與 **WebRTC**，高度還原早期 MSN Messenger 的經典互動體驗（震動、音樂狀態、離線留言），並以「零伺服器維護成本」為營運目標。

## 簡介

Cinderous 透過「狀態信令」與「巨量資料傳輸」雙軌混合網路，達成極致隱私與低延遲：

- **零知識身分**：首次啟動於本機生成 secp256k1 金鑰對（Nostr/NIP-01），公鑰（`npub`）即為全網唯一 ID，無帳號密碼。同一裝置可並存多個身分（工作／個人）。
- **本機優先・靜態加密**：對話與私鑰留在裝置；localStorage／OPFS 上的資料以**裝置金鑰（由 nsec 導出）AES-256-GCM 加密**（ADR-0112），Tauri 桌面另把私鑰託給 OS 金鑰庫。明文永不上雲。
- **端到端加密**：訊息以 Nostr **NIP-17/44/59 Gift Wrap** 加密後才離開裝置——中繼站看不到內容，也看不到寄件者與社交圖譜。
- **換裝置有路、預設純本機**：預設純本機（裝置全毀＝身分終止）；也提供**選擇性**的還原路徑——本地密碼記住（Argon2id）、裝置配對搬家（P2P 全程加密）、加密雲端備份與備份碼（NIP-49），全程仍是密文，明文/私鑰不外流。

## 技術架構摘要

雙軌混合網路（依連線狀態動態切換）：

| 引擎 | 技術 | 定位 |
| --- | --- | --- |
| **引擎 A：狀態與信令** | Nostr 協議（Cloudflare Workers + D1） | 離線留言暫存、線上狀態廣播、WebRTC 初始 SDP 信令交換 |
| **引擎 B：巨量資料傳輸** | WebRTC 直連（P2P） | 即時互動：震動（Nudge）、動畫快遞、大檔案傳輸，繞過中繼站達成毫秒級延遲 |

資料生命週期靠 **NIP-40**（7 天過期）與 **Ephemeral Events**（Kind 20000-29999 純記憶體轉發、不寫資料庫），確保 Cloudflare 永久免費額度不被耗盡。

### 終端平台

- **桌面端（第一優先）**：Rust **Tauri** + **React/TypeScript**，可打包成 Windows（MSI／NSIS）／macOS／Linux 安裝檔；私鑰託 OS 金鑰庫、背景 WebSocket 長連線、原生檔案存取（公司儲存槽等）。**同一套 React UI 也能直接跑在瀏覽器**（開發與 web 執行環境），以加密 localStorage／OPFS 落地——並非捨棄網頁，而是把「明文絕不落盤」做到瀏覽器（ADR-0112）。
- **行動端**：**React Native Web**，與桌面**共用同一套 `RelayChatBackend`**（engine），故功能高度對齊——訊息、群組、通話、檔案、企業模式等皆可用；需 OS 層能力（真檔案系統、原生金鑰庫）的少數項目待原生打包（EAS）。
- **中繼站**：Cloudflare Worker（Durable Objects 扇出），另有 Node 版可自架於容器。

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

從核心協定到桌面／行動客戶端與**企業模式**皆**已實作並通過測試**（pnpm monorepo、TypeScript strict、全程 TDD）。摘要如下（詳見 [`docs/adr/`](./docs/adr) 逾 180 份決策紀錄）：

**核心通訊**
- Nostr 中繼：心跳／上線狀態、Ephemeral 扇出、離線留言（NIP-17/44/59 Gift Wrap ＋ NIP-40 過期）
- WebRTC：真實 P2P（`RTCPeerConnection`／ICE／TURN）語音／視訊通話、資料通道分塊檔案傳輸、雙軌降級與自動改道
- 多裝置：QR／配對搬家（P2P，AES-256-GCM）、加密雲端備份（opt-in）、備份碼（NIP-49）、多身分並存

**即時通體驗（懷舊 MSN 風）**
- 敲一下（Nudge／震動）、正在輸入、正在聽（音樂狀態）、自訂狀態文字、隱身、上線狀態本機還原
- 表情回應、收回訊息、已讀回條、@提及、內嵌回覆／對話串、限時訊息（閱後即焚）
- 群組（建立／成員管理）、貼圖（內建＋自製）、對話背景、私人便條（加密）、媒體相簿
- 頭像廣播、本地暱稱／標籤、依聯絡人音效、訊息請求／封鎖／移除聯絡人

**企業模式（公司帳號）**
- 組織名冊（管理者簽章）、邀請碼入職、公司帳號金鑰託管＋離職接管
- 公司設定（歡迎詞／上下班時間、下班自動靜音）、訊息保留天數、公司儲存槽（檔案存放）
- 企業成員鎖公司座；桌面與行動端皆可管理（唯「企業主收儲存槽落盤」限桌面＝需原生檔案系統）

- **測試**：core 327／engine 265／relay 88／theme 14／i18n 8／desktop 406／mobile 197（TS 逾 **1,300**）＋ Rust，含 relay↔client 端到端整合測試。
- **可眼見**：桌面客戶端可打包成安裝檔（見上「終端平台」），亦可直接在瀏覽器跑（`/`）；另有端到端 `demo.html`／真實 WebRTC `webrtc.html`。
- **完整施工計畫**（現況、各平台待辦、M6–M9 進階功能、相依順序）：見 [`docs/ROADMAP.md`](./docs/ROADMAP.md)。
- **使用者教學**（給一般使用者：身分與鑰匙、加好友、本地密碼、換裝置三條路、搬家、常見問題）：見 [`docs/使用手冊_User-Guide.md`](./docs/使用手冊_User-Guide.md)。
- **前端開發指南**（給社群開發者：三層架構、重用 core/i18n、消費 `ChatBackend` 接自己的 UI、AGPL）：見 [`docs/前端開發指南_Frontend-Guide.md`](./docs/前端開發指南_Frontend-Guide.md)（ADR-0074）。

## 開發起始步驟（Getting Started）

需求：**Node 22+**、**pnpm 10+**（Rust 測試另需 stable toolchain）。

```bash
# 1. 取得原始碼並安裝 workspace 相依
git clone https://github.com/VaalRL/Nostr-buddy.git cinder && cd cinder
pnpm install

# 2. 驗證環境（全綠代表就緒）
pnpm -r test            # 全部 TS 測試（core / engine / i18n / relay / desktop / mobile）
pnpm -r typecheck       # 全部型別檢查

# 3. 起本機真實 relay，再跑桌面前端（瀏覽器開發、不需 Tauri）
pnpm --filter @cinderous/relay build:dev && pnpm --filter @cinderous/relay dev   # ws://localhost:8787
pnpm --filter @cinderous/desktop dev                                          # 前端；開 /?relay=ws://localhost:8787
```

> **想接自己的前端、加語言、做擴充或貢獻核心？** 開發者入口見 [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md)（三層架構、環境、參與方式、規範），接前端的完整教學見 [`docs/前端開發指南_Frontend-Guide.md`](./docs/前端開發指南_Frontend-Guide.md)。

### 常用指令

| 任務 | 指令 |
| --- | --- |
| 桌面前端（懷舊即時通風格） | `pnpm --filter @cinderous/desktop dev`，開啟 `/`（另有端到端 demo `/demo.html`、真實 WebRTC `/webrtc.html`） |
| 前端建置 | `pnpm --filter @cinderous/desktop build` |
| 共用核心測試 | `pnpm --filter @cinderous/core test` |
| 中繼站測試 | `pnpm --filter @cinderous/relay test` |
| 本機真實 relay（開發用） | `pnpm --filter @cinderous/relay build:dev && pnpm --filter @cinderous/relay dev`（起 `ws://localhost:8787`；前端開 `/?relay=ws://localhost:8787` 即連真實 relay） |
| Rust 測試 | `cargo test`（於 `apps/desktop/src-tauri/`） |
| 桌面端開發（需 Tauri 工具鏈） | `pnpm --filter @cinderous/desktop tauri dev` |
| 中繼站本地開發 / 部署（需 wrangler） | `wrangler dev` / `wrangler deploy`（於 `relay/`） |

## 🚀 在 Cloudflare Workers 架設中繼站（Nostr / WebRTC 信令 relay）

中繼站（`relay/`）是一個自建的最小 Nostr relay，跑在 Cloudflare Workers 上，以
**Durable Object** 持有所有 WebSocket 連線並做記憶體扇出。它的職責是：

- **線上狀態廣播**（心跳 Kind 20000）、**正在輸入中**（20001）、**音樂狀態**（20002）；
- **WebRTC 的 SDP / ICE 信令交換**（NIP-59 包封的 ephemeral 事件，Kind 21000-21999）；
- **離線留言**暫存（NIP-17/59 Gift Wrap ＋ NIP-40 過期；`message-store` 邏輯已實作並測試——每收件人配額、以 `#p` 為索引。持久化：Cloudflare 版接 D1、Node 自架版用內建 SQL）。

> WebRTC 一旦 P2P 打通，**震動、檔案傳輸等資料完全走點對點，永遠不經過 relay**。
> Ephemeral 事件只在記憶體轉發、不落地；relay 看不到訊息明文，也看不到（經 Gift Wrap 隱藏的）社交圖譜。

### 前置需求

- 一個 [Cloudflare 帳號](https://dash.cloudflare.com/sign-up)
- Node 22+、pnpm 10+
- **注意**：本 relay 使用 Durable Objects。Durable Objects 目前需要 **Workers 付費方案（約 US$5/月）** 或符合 Cloudflare 當前免費方案條件——部署前請以 [官方計費說明](https://developers.cloudflare.com/durable-objects/platform/pricing/) 為準。

### 步驟

```bash
# 1. 取得原始碼並安裝相依（會建立 workspace 連結，wrangler 打包時需要）
git clone <your-fork-url> cinder && cd cinder
pnpm install

# 2. 登入 Cloudflare（會開瀏覽器授權）
cd relay
pnpm dlx wrangler login

# 3. 本地開發：在 ws://127.0.0.1:8787 起一個本機 relay
pnpm dlx wrangler dev

# 4. 部署到 Cloudflare，取得 wss://cinder-relay.<你的帳號>.workers.dev
pnpm dlx wrangler deploy
```

部署設定在 [`relay/wrangler.toml`](./relay/wrangler.toml)：Worker 名稱、進入點 `src/worker.ts`、
以及 Durable Object 綁定（`RELAY_ROOM` → `RelayRoom` 類別與 migration）。wrangler 會直接打包
TypeScript，無需額外建置步驟。可在 `wrangler.toml` 修改 `name` 換成你自己的 Worker 名稱。

### 連線測試

relay 講標準 Nostr 的 `REQ` / `EVENT` / `CLOSE` 協定，可用 `@cinderous/core` 的 `RelayClient`：

```ts
import { RelayClient, createHeartbeat, generateSecretKey } from "@cinderous/core";

const ws = new WebSocket("wss://cinder-relay.<你的帳號>.workers.dev");
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

Copyright (C) 2026 Cinderous contributors.
