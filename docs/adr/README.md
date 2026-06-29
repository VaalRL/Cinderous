# 架構決策紀錄（ADR）

本目錄記錄 Nostr Buddy 的重大架構與設計決策（Architecture Decision Records）。

> 自此之後，任何架構/設計層級的決策（模組邊界、加密與協定選型、資料流、隱私取捨、外部依賴等）都必須新增一份 ADR。`PRD.md` 與 `ARCHITECTURE.md` 描述「規格現況」，ADR 描述「為何如此決策」。

## 規則

- 一個決策一份檔案，檔名格式：`NNNN-簡短標題.md`（四位流水號）。
- 狀態使用：`提議中 (Proposed)`、`已接受 (Accepted)`、`已棄用 (Deprecated)`、`被取代 (Superseded by NNNN)`。
- ADR 一旦 `已接受` 即不可竄改內容；若決策改變，新增一份 ADR 並把舊的標記為 `被取代`。
- 撰寫格式參考 `0000-template.md`。

## 索引

| 編號 | 標題 | 狀態 |
| --- | --- | --- |
| [0001](./0001-record-architecture-decisions.md) | 採用 ADR 記錄架構決策 | 已接受 |
| [0002](./0002-privacy-metadata-and-protocol-baseline.md) | 隱私元資料保護與 Nostr 協定基線（NIP-44/17/59/42/13） | 已接受 |
