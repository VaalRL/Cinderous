# Nostr Buddy 長期施工計畫（ROADMAP）

> 本文件是「還有哪些要蓋、依什麼順序蓋」的單一入口。里程碑定義見 `ARCHITECTURE.md §7`，決策理由見 `docs/adr/`，產品規格見 `PRD.md`。功能實作前先立/查對應 ADR。

## 圖例

- 狀態：✅ 完成且測試 ｜ 🔧 進行中 ｜ 📋 規劃 ｜ ⏳ 待執行期環境
- 環境：🌐 可在瀏覽器/CI 驗證 ｜ 🖥️ 需 Tauri 工具鏈（`webkit2gtk`/`tauri-cli`）｜ ☁️ 需 Cloudflare 帳號 ｜ 📱 需 React Native 工具鏈

---

## 0. 現況快照

- **共用協定/邏輯層（`packages/core`、`relay`）**：secp256k1 身分 → NIP-01 事件/簽章 → NIP-44 加密 → NIP-17/59 Gift Wrap → 心跳/輸入中/音樂 → WebRTC 信令/資料通道/降級 → QR 配對/競速/多設備收斂 → RelayClient → 防濫用(PoW/訂閱上限)/時鐘·重放防護。**約 90%，127 測試。** ✅
- **桌面前端 UX 外殼（`apps/desktop`）**：登入、聯絡人清單、對話視窗、表情、Markdown、Nudge、輸入中、深色/明亮、多語系。**約 80%（外殼）**，但接的是**模擬後端**（記憶體 relay + 機器人好友），無持久化、聯絡人寫死。✅（UX）／🔧（產品化）
- **Demo**：`demo.html`、`webrtc.html`（真實 WebRTC）、主應用 `/`，皆 Playwright 驗證。✅
- **治理**：pnpm monorepo、TS strict、TDD、CI、10 份 ADR、AGPL-3.0。✅

**缺口總覽**：真實後端整合、本機持久化、聯絡人管理、Tauri 桌面殼、relay 生產部署、行動端、以及 M6–M9 進階功能。

---

## Phase A — 讓現有前端「真的能用」（大多 🌐 可在此驗證）

先把 UX 外殼從「接模擬後端」推進到「接真實通訊 + 會記住東西」。

| # | 任務 | 環境 | 說明 / 驗證 |
| --- | --- | --- | --- |
| A1 | 前端接真實 relay | 🌐 | ✅ **完成**：`RelayChatBackend` + `webSocketConnector` 連真 relay；`relay/src/dev-server.ts` 本機真實 WebSocket relay；以 npub 加好友。Playwright 兩 context 經真實 relay 對話已驗證。 |
| A2 | 本機持久化（前端層） | 🌐 | ✅ **完成**：`AppStorage`(localStorage) 存身分/聯絡人/訊息；重整自動登入、身分不再每次重生、歷史保留。Playwright 重整驗證通過。（Tauri 版再換 SQLite/SQLCipher。） |
| A3 | 聯絡人管理 UI | 🌐 | 新增/刪除、封鎖；**QR 加好友**（`npub` 交換 + 雙向同意，對應 M9 前半 + PRD §10）。 |
| A4 | 檔案傳輸 UI | 🌐 | 接既有 `datachannel`：拖放/附件、傳送進度、接收下載。 |
| A5 | 設定與狀態 UI | 🌐 | 設定頁（relay URL、身分備份警語、通知）、連線/重連中狀態、未讀徽章、自己的音樂狀態輸入口（backend 已有 `setNowPlaying`）。 |
| A6 | 前端技術債收斂 | 🌐 | 收斂/移除孤立的 `presence-store.ts`；`relay-source.ts` 併入 A1；視窗 `_ ×` 按鈕接上最小化/關閉或移除裝飾。 |

**Phase A 完成定義**：桌面前端能連真實 relay、重整不失資料、可自行管理好友並傳檔——不再是純 demo。

---

## Phase B — Tauri 桌面殼落地（🖥️ 需 Tauri 環境）

把前端裝進原生殼，補上背景與安全能力。對應 `ARCHITECTURE §7` M1–M5 的 ⏳ 部分。

| # | 任務 | 說明 |
| --- | --- | --- |
| B1 | Tauri 二進位 | `main.rs`、tauri 設定、視窗、打包（Win/mac/Linux）。 |
| B2 | `TauriChatBackend`（IPC） | 以相同 `ChatBackend` 介面接 Tauri `invoke`/event，UI 不改。 |
| B3 | Rust 背景長連線 | tokio + tungstenite 背景 WebSocket，套用既有 `reconnect::Backoff`；視窗關閉仍在線。 |
| B4 | 原生持久化 | `rusqlite` + SQLCipher 落地加密資料庫；A2 的資料層換成 SQLite。 |
| B5 | OS 金鑰儲存 | `keyring`（Keychain/DPAPI/libsecret）存私鑰。 |
| B6 | 打包/更新 | 簽章、自動更新、系統匣/通知。 |

**完成定義**：可安裝的桌面 App，背景在線、資料與私鑰安全落地。

---

## Phase C — Relay 生產部署（☁️ 需 Cloudflare 帳號）

對應 M2 relay 的 ⏳ 部分與數個 review 待辦。

| # | 任務 | 說明 |
| --- | --- | --- |
| C1 | Worker 接 D1 | `worker.ts` 的 `RelayCore` 接以 D1 為後備的 `MessageStore`（行為已定義/測試）；加 D1 binding。 |
| C2 | NIP-40 排程 prune | DO `alarm()` 定期清過期留言（review 項 A3）。 |
| C3 | NIP-42 AUTH | 訂閱/發布前認證，補齊防濫用（PoW/速率上限已完成）。 |
| C4 | 部署與容量校準 | `wrangler deploy`；上線後實測請求數回填 `docs/adr/0006`。 |

**完成定義**：公開可用的中繼站，離線留言真正持久化並自動過期。

---

## Phase D — 行動端（📱 需 React Native 工具鏈）

對應 M5 行動端的 ⏳ 部分。**大量重用** `packages/core` 與 `packages/i18n`。

| # | 任務 | 說明 |
| --- | --- | --- |
| D1 | RN App 骨架 | Expo/RN + 重用 core/i18n；移植聯絡人/對話 UI（可先 react-native-web 於瀏覽器驗證）。 |
| D2 | 行動持久化 | RN SQLite + Keystore/Secure Enclave。 |
| D3 | 無聲推播喚醒 | Worker 存 APNs/FCM 憑證，Silent Push 喚醒背景拉取（PRD §3）。 |
| D4 | 多設備同步接線 | 接既有 QR 配對 + 持續對帳邏輯。 |

---

## Phase E — 進階功能（借鏡 LINE，M6–M9；核心 🌐 可驗、UI 隨平台）

決策與範疇見 `docs/adr/0010`；一律沿用 NIP-44 + NIP-17/59 隱私機制。每項實作時補細節 ADR。

| 里程碑 | 功能 | 機制 | 環境 |
| --- | --- | --- | --- |
| M6 | 訊息回應 Reaction | ✅ **完成**：NIP-25(kind 7) 指向訊息，Gift Wrap 包封；桌面 UI + 持久化，經真實 relay 驗證（ADR-0011） | 🌐 |
| M6 | 收回訊息 Unsend | ✅ **完成**：NIP-09(kind 5) 指向訊息，Gift Wrap 包封；收件端顯示「訊息已收回」＋持久化，經真實 relay 驗證（ADR-0012） | 🌐 |
| M6 | 限時訊息 | ✅ **完成**：rumor 內帶較短 NIP-40 過期（外層 wrap 同步縮短）；桌面可選限時（1 分/1 時/1 天），到期顯示「訊息已到期」，經真實 relay 驗證（ADR-0013） | 🌐 |
| M7 | 語音訊息 / 相簿 | 複用 WebRTC 檔案分塊 + 本機媒體庫 | 🌐 核心 / 🖥️📱 UI |
| M7 | 貼圖 Sticker | 內建包 `pack/id` 參照，客戶端渲染 | 🌐 |
| M8 | 語音/視訊通話 | WebRTC media track；通話信令複用 SDP 信令通道 | 🌐 信令 / 需真實 media |
| M9 | QR 加好友 | `npub` 交換 + 同意（見 Phase A3） | 🌐 |
| M9 | 群組聊天 | **需群組加密（MLS vs sender-key），先立 ADR** | 待決策 |

---

## Phase F — 安全與規模化（跨切面）

| # | 任務 | 說明 |
| --- | --- | --- |
| F1 | 群組加密 ADR | M9 群組的金鑰管理方案（MLS / sender-key）與多設備群組金鑰。 |
| F2 | 前向保密決策 | 是否導入 Double Ratchet（前向保密/後妥協安全）或維持靜態金鑰（ADR）。 |
| F3 | 剩餘 review 技術債 | A5 多設備 sync 上限、A6 信令批次 candidate、C4 檔案二進位框架（省 base64 33%）。 |
| F4 | 第三方安全稽核 | 端到端加密與金鑰處理的獨立稽核（README 已聲明尚未稽核）。 |
| F5 | 容量/成本 | 心跳合併/WebRTC 卸載/付費層評估（`docs/adr/0006` 擴充旋鈕）。 |

---

## 相依與建議順序

```text
Phase A（前端產品化，可在此環境大量推進）
   ├─→ Phase B（Tauri 殼，需 Tauri 環境）───┐
   ├─→ Phase C（relay 部署，需 CF）         ├─→ Phase E（M6–M9 進階功能）
   └─→ Phase D（行動端，需 RN）─────────────┘        └─→ Phase F（安全/規模化，跨切面）
```

- **可立即在此環境推進**：Phase A 全部、Phase E 的「核心邏輯」（M6/M7 資料層、M8 信令、M9 QR）、Phase F 的 F3。
- **需換環境**：Phase B（Tauri）、C（Cloudflare）、D（RN），以及 M8 真實通話 media、M7 媒體 UI。

## 未決策 ADR（開工前需定案）

- 群組加密方案（F1 / M9）
- 前向保密：是否導入棘輪（F2）
- 語音訊息離線傳遞的退回策略（M7，受中繼大小限制）

## 建議下一步

依 ROI 與「此環境可驗證」，建議先做 **Phase A1（接真實 relay）+ A2（持久化）**，讓桌面前端從 demo 變成真正能用；接著挑 **M6 訊息互動**（成本低、契合 ephemeral 精神）作為第一個進階功能。
