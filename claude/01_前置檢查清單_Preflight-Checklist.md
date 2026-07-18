# 01｜前置檢查清單（Preflight Checklist）

> 在任何變更開始前，逐條確認。

## Step 1：需求與架構理解

- [ ] 我已閱讀 `PRD.md`，理解 Cinderous 的產品目標、階段與核心功能。
- [ ] 我已閱讀 `ARCHITECTURE.md`，知道這次變更應該落在 `packages/core/`、`apps/desktop/`、`relay/`、`tests/` 或 `docs/` 的哪一層。
- [ ] 若任務涉及 Nostr 事件、加密、WebRTC 或網路流程，我已確認本地優先、低延遲與隱私要求（明文/私鑰不離開裝置）。

## Step 2：任務特性判斷

- [ ] 是否會新增 root 檔案？如果會，是否屬於專案入口文件或必要設定檔。
- [ ] 是否跨越多層模組（共用核心、Tauri/Rust、UI、Worker）？如果是，先拆步驟與檢查點。
- [ ] 是否可能影響通訊主流程、訊息收發、連線狀態或加密？如果是，先準備回復策略。
- [ ] 我是否打算使用低效率或不必要的 shell 指令？若是，改用專用搜尋與讀檔工具。

## Step 3：Mandatory Search First

- [ ] **Architecture First**：先看 `ARCHITECTURE.md` 找正確模組與邊界。
- [ ] **庫內搜尋**：以功能名稱、Nostr Kind、事件、加密、relay、WebRTC 等關鍵字搜尋既有實作。
- [ ] **閱讀與比對**：如果有相似功能，延伸它而不是另起爐灶。
- [ ] 確認不會新增重複的 relay client、加密封裝、連線管理或平行資料流。

## Step 4：同步與記錄

- [ ] 若會變動架構、資料流或外部契約，完成後同步更新 `ARCHITECTURE.md` 與相關入口文件。
- [ ] 若是初始化或重大里程碑，確認 `README.md`、`AGENTS.md`、`CLAUDE.md` / `gemini.md` 是否需要同步。

> 完成確認前，不要直接進入實作。
