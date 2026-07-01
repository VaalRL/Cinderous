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
| [0003](./0003-monorepo-tooling-pnpm-workspace.md) | Monorepo 工具採用 pnpm workspace | 已接受 |
| [0004](./0004-crypto-primitives-secp256k1-noble-in-core.md) | 加密原語：secp256k1（@noble）收斂於 packages/core | 已接受 |
| [0005](./0005-relay-self-built-worker.md) | 中繼站：自建最小 Cloudflare Worker relay | 已接受 |
| [0006](./0006-heartbeat-capacity-and-free-tier.md) | 心跳容量估算與免費額度策略 | 已接受 |
| [0007](./0007-nip44-via-nostr-tools.md) | NIP-44 加密採用 nostr-tools，事件/簽章維持自有 core | 已接受 |
| [0008](./0008-webrtc-signaling-and-datachannel-protocol.md) | WebRTC 信令與資料通道協定（M3） | 已接受 |
| [0009](./0009-multidevice-sync.md) | 多設備同步：QR 配對、競速與收斂語意（M4） | 已接受 |
| [0010](./0010-line-inspired-feature-roadmap.md) | 借鏡 LINE 的功能路線圖與範疇界線（M6–M9） | 已接受 |
| [0011](./0011-message-reactions.md) | 訊息回應（Reactions，M6） | 已接受 |
| [0012](./0012-message-unsend.md) | 收回訊息（Unsend，M6） | 已接受 |
| [0013](./0013-disappearing-messages.md) | 限時訊息（Disappearing，M6） | 已接受 |
| [0014](./0014-contact-management.md) | 聯絡人管理：刪除與封鎖（Phase A3） | 已接受 |
| [0015](./0015-settings-identity-backup-notifications.md) | 設定面板：身分備份、桌面通知與未讀（Phase A5） | 已接受 |
| [0016](./0016-relay-reconnect-and-connection-status.md) | 中繼站自動重連與連線狀態（Phase A5） | 已接受 |
