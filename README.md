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
│   │   ├── src/        # React/TS 前端 UI
│   │   └── src-tauri/  # Rust：SQLite、Nostr WebSocket、WebRTC、金鑰管理
│   └── mobile/         # React Native + SQLite（輔助平台，預留）
├── packages/
│   │   └── demo.html   # 純瀏覽器端到端 demo（雙用戶經記憶體 relay 互動）
│   └── mobile/         # React Native + SQLite（輔助平台，預留）
├── packages/
│   └── core/           # 共用 TS：Nostr 事件、secp256k1 簽章、NIP-44/17/59、型別、Kind 常數
├── relay/              # Cloudflare Worker + D1（Nostr 中繼站）
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
- **可眼見**：`demo.html` 在瀏覽器即可看到上線狀態、即時/離線留言、輸入中、音樂、Nudge 跑通。
- **尚待執行期環境**（⏳）：真實 WebRTC（`RTCPeerConnection`/ICE/TURN）、Tauri GUI 與 Rust 背景連線、OS 金鑰儲存、Cloudflare Worker 部署。詳見 [`ARCHITECTURE.md`](./ARCHITECTURE.md) §7 與 [`docs/adr/`](./docs/adr)。

## 開發指令

需求：Node 22+、pnpm 10+（Rust 測試另需 stable toolchain）。

```bash
pnpm install            # 安裝 workspace 相依
pnpm -r test            # 所有 TS 測試（core / relay / desktop）
pnpm -r typecheck       # 所有套件型別檢查
```

| 任務 | 指令 |
| --- | --- |
| 瀏覽器 demo（端到端） | `pnpm --filter @nostr-buddy/desktop dev`，開啟 `/demo.html` |
| 前端建置 | `pnpm --filter @nostr-buddy/desktop build` |
| 共用核心測試 | `pnpm --filter @nostr-buddy/core test` |
| 中繼站測試 | `pnpm --filter @nostr-buddy/relay test` |
| Rust 測試 | `cargo test`（於 `apps/desktop/src-tauri/`） |
| 桌面端開發（需 Tauri 工具鏈） | `pnpm --filter @nostr-buddy/desktop tauri dev` |
| 中繼站本地開發 / 部署（需 wrangler） | `wrangler dev` / `wrangler deploy`（於 `relay/`） |

## 開發規範

本專案採 AI 協作開發，硬規則如下（詳見 [`CLAUDE.md`](./CLAUDE.md)、[`gemini.md`](./gemini.md) 與 [`claude/`](./claude)）：

- **單一真實來源（SSOT）**：產品需求看 `PRD.md`，模組與資料流看 `ARCHITECTURE.md`。
- **Architecture First / Search First**：先定位模組、再讀現有實作、最後才動手。
- **Fix First**：延伸既有設計，不建立 `v2`、`new_*`、`*_enhanced` 平行路徑。
- **TDD**：功能程式碼遵循 Red → Green → Refactor，測試即文件。
- **本地優先與低延遲**：任何變更都不得破壞訊息即時性與隱私預設。

## 授權

待補。
