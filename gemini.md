# Gemini Context & Rules (Cinderous Gateway)

> 本檔是 Cinderous 的 Gemini 入口。產品需求以 `PRD.md` 為源頭，系統分層以 `ARCHITECTURE.md` 為源頭，工程規範以 `claude/` 目錄為共用準則。

## 建議閱讀順序

1. [PRD.md](./PRD.md)
2. [ARCHITECTURE.md](./ARCHITECTURE.md)
3. 依任務類型閱讀 `claude/` 對應指南

## 快速路由

- **準備開始任何任務**
  - 讀取 [01_前置檢查清單](./claude/01_前置檢查清單_Preflight-Checklist.md)
  - 讀取 [03_搜尋優先與架構定位](./claude/03_搜尋優先與架構定位_SearchFirst_Architecture.md)

- **撰寫或修改功能**
  - 讀取 [04_程式品質與測試](./claude/04_程式品質與測試_TDD.md)
  - 讀取 [05_檔案與目錄規範](./claude/05_檔案與目錄規範_Repo_Structure.md)

- **長時間、多步驟或跨層任務**
  - 讀取 [02_任務執行](./claude/02_任務執行_TodoWrite_與_TaskAgents.md)

- **重構或整併**
  - 讀取 [03_搜尋優先與架構定位](./claude/03_搜尋優先與架構定位_SearchFirst_Architecture.md)
  - 讀取 [05_檔案與目錄規範](./claude/05_檔案與目錄規範_Repo_Structure.md)

- **使用工具與 CLI**
  - 讀取 [06_工具使用與限制](./claude/06_工具使用與限制_Tooling.md)

- **大範圍變更完成後**
  - 讀取 [07_多代理人協作與審查](./claude/07_多代理人協作與審查_Reviews.md)

- **緊急狀況、除錯或回滾**
  - 讀取 [08_緊急處置](./claude/08_緊急處置_Emergency.md)

## Gemini 核心指令

1. **Architecture First / Search First**
   - 開始任何任務前，先讀 `ARCHITECTURE.md`，再搜尋現有實作。
   - 優先延伸現有模組，不要建立平行版本。

2. **單一真實來源 (SSOT)**
   - 產品行為以 `PRD.md` 為準。
   - 模組邊界、資料流與初始化規劃以 `ARCHITECTURE.md` 為準。
   - AI 工程規範以 `claude/` 目錄為準。
   - Nostr 事件、加密與 SQLite 共用邏輯收斂於 `packages/core`，不要在 UI 與 Worker 各自重造。

3. **Root 目錄契約**
   - root 僅允許專案入口文件與必要設定檔，例如 `README.md`、`PRD.md`、`ARCHITECTURE.md`、`AGENTS.md`、`CLAUDE.md`、`gemini.md`。
   - 其餘新文件請放入 `docs/` 或對應模組目錄。
   - 實作請放入 `apps/`、`packages/`、`relay/`、`tests/` 等既定目錄。

4. **測試驅動**
   - 功能程式碼遵循 `Red -> Green -> Refactor`。
   - 共用核心（TS）、Tauri/Rust、React UI、Cloudflare Worker 各層都應有對應測試或明確驗證策略。

5. **隱私與延遲**
   - 預設本地優先：明文與私鑰絕不離開裝置，中繼站只轉發密文與 Ephemeral 狀態。
   - 任何變更都不能破壞訊息即時性與互動體驗（如 Nudge 震動同步感）。

6. **Fix First**
   - 先修正既有設計與模組，再考慮新增替代路徑。
   - 禁止建立重複的 relay client、加密封裝或連線管理入口。

## 資源索引

- 產品需求：`./PRD.md`
- 架構規劃：`./ARCHITECTURE.md`
- 共用規範：`./claude/`
- Codex 入口：`./AGENTS.md`
- MCP 設定：`./.claude/mcp_config.json`（目前為空白佔位，待需要時填入）
