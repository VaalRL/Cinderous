# AGENTS.md

## Project Summary

Cinderous 是一款結合 **Nostr 協議**、**WebRTC**、**Rust Tauri** 與 **React/TypeScript** 的去中心化即時通訊軟體。核心目標不是一般 Web CRUD，而是建立極致隱私、無中央資料庫、低延遲的雙軌混合通訊管線，並高度還原 MSN Messenger 的經典互動（離線留言、上線狀態、音樂狀態、震動 Nudge、檔案傳輸）。本機 SQLite 為唯一真相來源；明文與私鑰絕不離開裝置。

## Read Order

1. `PRD.md`
2. `ARCHITECTURE.md`
3. `CLAUDE.md`
4. 依任務型別閱讀 `claude/` 下對應指南

## Repository Contract

### Allowed root docs

下列檔案可以存在於 root：

- `README.md`
- `PRD.md`
- `ARCHITECTURE.md`
- `AGENTS.md`
- `CLAUDE.md`
- `gemini.md`
- 必要設定檔

### Implementation directories

- `packages/core/`: 共用 TS — Nostr 事件建構/驗證、簽章（secp256k1 Schnorr）、加密（NIP-44）、SQLite schema、型別、Kind 常數
- `apps/desktop/src/`: Tauri 前端 React/TS UI（好友列表、對話視窗、狀態列、Nudge）
- `apps/desktop/src-tauri/`: Rust bridge — 原生 SQLite、Nostr WebSocket、WebRTC、金鑰儲存、IPC
- `apps/mobile/`: React Native + SQLite（輔助平台，預留）
- `relay/`: Cloudflare Worker + D1（Nostr 中繼站）
- `tests/`: 跨層測試與 fixture
- `docs/`: 進一步設計決策與流程補充

不要在 root 新增臨時文件、平行設計稿或輸出檔。

## Engineering Rules

1. **Architecture First / Search First**
   - 先讀 `ARCHITECTURE.md`，再搜尋既有實作。
   - 優先延伸現有模組，不要平行新建 `v2`、`new_*`、`enhanced_*`。

2. **Fix First**
   - 先修正或收斂既有設計，不要遇到不順就另起一套 relay client、加密封裝或連線入口。

3. **TDD by Layer**
   - 共用核心（TS）：Nostr 事件建構/驗證、加密、SQLite schema 行為
   - Rust / Tauri：SQLite 讀寫、WebSocket 連線、WebRTC 通道、timeout / fallback
   - UI：狀態渲染、對話視窗、Nudge 互動
   - Worker：Ephemeral 轉發、NIP-40 過期留言處理

4. **Local-First Privacy**
   - 明文與私鑰絕不離開裝置；中繼站只看得到密文與 Ephemeral 狀態。
   - 雲端中繼僅處理非同步狀態，不應成為訊息明文的依賴。

5. **Document Sync**
   - 若模組邊界、Nostr 事件契約、WebRTC 流程或資料流有變更，必須同步更新 `ARCHITECTURE.md` 與相關入口文件。

6. **Be Honest About Project State**
   - 如果 manifest、腳本或目錄尚未建立，不要在文件或回報中假裝它們已存在。

## Initial Priorities

1. `M0`: 文件與專案骨架
2. `M1`: Nostr 中繼連線與心跳（含最小金鑰簽章、上線/離線狀態）
3. `M2`: 離線文字留言（Kind 4/44、NIP-40 過期）
4. `M3`: WebRTC P2P 直連（SDP 信令、Nudge、檔案傳輸）
5. `M4`: 多設備同步（QR Code + Happy Eyeballs）
6. `M5`: 經典體驗還原（音樂狀態、正在輸入中）與行動端

若使用者沒有另外指定，預設先推進 `M1`。

## Change Checklist

- 變更前確認對應模組落點
- 變更前搜尋既有實作與相關文件
- 變更後補測試或驗證結果
- 變更後同步更新文件
