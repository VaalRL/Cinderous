# 05｜檔案與目錄規範（Repo Structure）

## Root 允許的入口文件

Cinderous 的 root 允許以下專案入口文件與必要設定：

- `README.md`
- `PRD.md`
- `ARCHITECTURE.md`
- `AGENTS.md`
- `CLAUDE.md`
- `gemini.md`
- 版本控制與工具設定檔（`.gitignore`、`.gitattributes`、`.claude/` 等）

除此之外，請不要在 root 增加臨時輸出、設計草稿或平行文件。

## 目錄分工

- `packages/core/`：共用 TS — Nostr 事件、簽章（secp256k1 Schnorr）、加密（NIP-44）、SQLite schema、型別、Kind 常數（SSOT 邏輯所在）
- `apps/desktop/src/`：Tauri 前端 React/TS UI 與互動
- `apps/desktop/src-tauri/`：Rust bridge — 原生 SQLite、Nostr WebSocket、WebRTC、金鑰儲存、IPC
- `apps/mobile/`：React Native + SQLite（輔助平台，預留）
- `relay/`：Cloudflare Worker + D1（Nostr 中繼站）
- `tests/`：整合測試與跨層 fixture
- `docs/`：設計決策、流程細節與補充規格
- `claude/`：AI 協作規範

## 強制規範

- 文件除入口文件外，請放入 `docs/` 或模組目錄
- 實作請放在對應技術層，不要把共用核心、Rust、UI、Worker 混在同一層
- Nostr 事件與加密邏輯一律收斂於 `packages/core`，不要在 UI 與 Worker 各自重造一份
- 避免新增與既有概念重疊的檔案或資料夾
- 不要為同一功能建立多個入口點（如重複的 relay client、連線管理或加密封裝）

## 建議骨架

```text
.
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   └── src-tauri/
│   └── mobile/
├── packages/
│   └── core/
├── relay/
├── tests/
├── docs/
└── claude/
```
