# CLAUDE.md（Cinderous 任務路由）

> 本文件是 Cinderous 的任務分配入口。開始任何工作前，先讀 `PRD.md` 與 `ARCHITECTURE.md`，再依任務情境進入 `claude/` 對應指南。

## 快速路由

- **準備開始任何任務**
  - 讀《01_前置檢查清單》
  - 讀《03_搜尋優先與架構定位》

- **撰寫或修改核心邏輯、Tauri/React UI、Nostr/WebRTC 引擎、Cloudflare Worker**
  - 讀《04_程式品質與測試》
  - 讀《03_搜尋優先與架構定位》
  - 讀《05_檔案與目錄規範》

- **長時間或多步驟任務**
  - 讀《02_任務執行》

- **需要重構 / 整併 / 消除重複**
  - 讀《03_搜尋優先與架構定位》
  - 讀《05_檔案與目錄規範》
  - 需要時參考《10_修正優先開發原則》

- **要動用外部工具或 CLI**
  - 讀《06_工具使用與限制》

- **大範圍變更完成後**
  - 讀《07_多代理人協作與審查流程》

- **出了狀況、違規、通訊主流程受損或需要止血**
  - 讀《08_緊急處置手冊》

- **想複習原則與心法**
  - 讀《09_最佳實務摘要》

## Root 目錄例外

Cinderous 的 root 允許存在少量專案入口文件與設定檔：

- `README.md`
- `PRD.md`（產品技術規格）
- `ARCHITECTURE.md`
- `AGENTS.md`
- `CLAUDE.md`
- `gemini.md`
- 必要設定檔（例如 `.gitignore`、`.gitattributes`、`.claude/`、AI 設定檔）

除此之外的新文件與實作，請放入對應模組目錄（`apps/`、`packages/`、`relay/`、`tests/`、`docs/`）。

## 目錄

1. [01_前置檢查清單_Preflight-Checklist.md](./claude/01_前置檢查清單_Preflight-Checklist.md)
2. [02_任務執行_TodoWrite_與_TaskAgents.md](./claude/02_任務執行_TodoWrite_與_TaskAgents.md)
3. [03_搜尋優先與架構定位_SearchFirst_Architecture.md](./claude/03_搜尋優先與架構定位_SearchFirst_Architecture.md)
4. [04_程式品質與測試_TDD.md](./claude/04_程式品質與測試_TDD.md)
5. [05_檔案與目錄規範_Repo_Structure.md](./claude/05_檔案與目錄規範_Repo_Structure.md)
6. [06_工具使用與限制_Tooling.md](./claude/06_工具使用與限制_Tooling.md)
7. [07_多代理人協作與審查_Reviews.md](./claude/07_多代理人協作與審查_Reviews.md)
8. [08_緊急處置_Emergency.md](./claude/08_緊急處置_Emergency.md)
9. [09_最佳實務_BestPractices.md](./claude/09_最佳實務_BestPractices.md)
10. [10_修正優先開發原則_Fix-First-Principle.md](./claude/10_修正優先開發原則_Fix-First-Principle.md)

## 全域硬規則

- **單一真實來源（SSOT）**：產品需求看 `PRD.md`，模組與資料流看 `ARCHITECTURE.md`，不要平行發明新版本。
- **Architecture First / Search First**：先找正確模組，再讀現有實作，最後才動手改。
- **Fix First**：優先修正與延伸既有設計，不要建立 `v2`、`new_*`、`*_enhanced` 平行路徑。
- **可測、可維護**：功能程式碼一律 TDD，測試即文件。
- **本地優先與低延遲**：任何設計都不能破壞訊息即時性、隱私預設，或讓明文/私鑰離開裝置。
- **加密與零伺服器狀態**：明文不上雲；中繼站只轉發密文與 Ephemeral 狀態，不持久化線上狀態。
- **文件同步**：若改動模組邊界、Nostr 事件契約或 WebRTC 流程，必須同步更新 `ARCHITECTURE.md` 與相關指南。
- **決策記錄（ADR）**：從現在開始，所有架構/設計層級的決策（模組邊界、加密與協定選型、資料流、隱私取捨、外部依賴等）都必須在 `docs/adr/` 新增一份 ADR，格式參照 `docs/adr/0000-template.md`，並更新 `docs/adr/README.md` 索引。
- **互動語言**：一律使用繁體中文與使用者互動。
- **回應結尾**：每次回應的最後都要加上「cinder啊哈哈」這段文字。
- **預設第一個功能**：若沒有更高優先指示，優先完成「Nostr 中繼連線與心跳（M1）」。
- **工具呼叫穩健**：編輯含大量特殊字元（HTML / JS 模板字面、引號、反斜線、Tab、中文）的內容時，把 Edit 拆小、一次只發一個工具呼叫；避免單次塞多個複雜呼叫，以免工具呼叫無法解析（"tool call could not be parsed"）。失敗的呼叫不會執行，重試成功者才生效。
