# 03｜搜尋優先與架構定位（Search-First & Architecture-First）

## 原則

- **先 Architecture**：先讀 `ARCHITECTURE.md`，確認變更屬於哪一層。
- **先搜尋**：用 `rg` / `fd` 搜尋既有實作、相似命名與相關資料流。
- **延伸，不複製**：不要產生平行 relay client、加密封裝、連線管理或事件處理邏輯。

## Cinderous 常見搜尋落點

- 共用核心（Nostr 事件、加密、SQLite schema、型別）：`packages/core/`
- Tauri UI：`apps/desktop/src/`
- Rust bridge（SQLite、WebSocket、WebRTC、金鑰）：`apps/desktop/src-tauri/`
- 中繼站：`relay/`
- 驗證與 fixture：`tests/`
- 規格與設計：`PRD.md`、`ARCHITECTURE.md`、`docs/`

## 禁止事項

- 重複檔案或重複資料流，造成多個 SSOT
- 為了趕進度新增 `*_v2`、`new_*`、`enhanced_*` 平行路徑
- 把私鑰、relay endpoint 或隱私策略硬寫在程式中

## 整併策略

- 發現 Nostr 事件建構、加密封裝、連線管理有重疊時，儘早抽成 `packages/core` 共用模組
- 不要讓共用核心、Rust、UI、Worker 各自維護不同的事件或加密定義

## 推薦流程

1. 讀 `ARCHITECTURE.md`
2. 搜尋相關模組與關鍵字
3. 閱讀最接近的現有實作
4. 決定延伸點與測試策略
5. 實作
6. 補測試與同步文件
