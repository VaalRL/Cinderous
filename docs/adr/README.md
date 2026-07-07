# 架構決策紀錄（ADR）

本目錄記錄 Cinder 的重大架構與設計決策（Architecture Decision Records）。

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
| [0017](./0017-webrtc-file-transfer.md) | WebRTC P2P 檔案傳輸整合（Phase A4） | 已接受 |
| [0018](./0018-tauri-desktop-shell.md) | Tauri 桌面殼與 IPC 契約（Phase B1/B2） | 已接受 |
| [0019](./0019-background-relay-connection.md) | 背景長連線：政策驅動器 + I/O 執行期（Phase B3） | 已接受 |
| [0020](./0020-native-persistence-sqlite-sqlcipher.md) | 原生持久化：SQLite / SQLCipher（Phase B4） | 已接受 |
| [0021](./0021-stickers.md) | 貼圖（Stickers，M7） | 已接受 |
| [0022](./0022-voice-messages.md) | 語音訊息（Voice Messages，M7） | 已接受 |
| [0023](./0023-media-album.md) | 媒體相簿（Album，M7） | 已接受 |
| [0024](./0024-qr-add-friend.md) | QR 加好友：npub QR 產生（M9） | 已接受 |
| [0025](./0025-call-signaling.md) | 語音/視訊通話信令核心（M8） | 已接受 |
| [0026](./0026-call-runtime-ui.md) | 通話執行期與 UI（M8） | 已接受 |
| [0027](./0027-group-encryption.md) | 群組聊天加密方案（M9） | 已接受 |
| [0028](./0028-forward-secrecy.md) | 前向保密：維持靜態金鑰、FS/PCS 交由未來 MLS（F2） | 已接受 |
| [0029](./0029-datachannel-binary-framing.md) | 資料通道檔案分塊改用二進位框架（F3/C4） | 已接受 |
| [0030](./0030-presence-ux-idle-away-and-status-formatting.md) | 在線狀態 UX：閒置自動離開與狀態列表情/格式 | 已接受 |
| [0031](./0031-animated-stickers.md) | 動態貼圖：宣告式 SVG 動畫（CSS keyframes） | 已接受 |
| [0032](./0032-custom-stickers.md) | 自製貼圖：內容隨訊息、SVG 統一表示、點擊即擁有 | 已接受 |
| [0033](./0033-sticker-editor.md) | 貼圖編輯器：筆劃模型序列化為 SVG path（桌面優先） | 已接受 |
| [0034](./0034-multi-relay-routing.md) | 跨中繼通訊：客戶端 Relay Pool 與收件人路由 | 已接受 |
| [0035](./0035-relay-hint-learning.md) | Relay hint 自動學習：帶內加密 hint（否決 NIP-65） | 已接受 |
| [0036](./0036-relay-hint-staleness.md) | Hint 陳舊偵測與離線回退；群訊 rumor 帶 hint | 已接受 |
| [0037](./0037-sticker-text-triggers.md) | 文字觸發貼圖：composer 尾端比對 + 建議列（Tab 送出） | 已接受 |
| [0038](./0038-url-hygiene.md) | 網址衛生：貼上清除追蹤參數 + 本地啟發式高風險警告 | 已接受 |
| [0039](./0039-hybrid-bootstrap-routing.md) | 混合式引導路由：錨點常數 + 簽章清單 + home 自動遞補 | 已接受 |
| [0040](./0040-group-local-labels.md) | 群組本地標籤與置頂（自訂標籤，純客戶端） | 已接受 |
| [0041](./0041-outbox-paced-delivery.md) | 可靠訊息節流外送匣：OK 感知重試 + 重連補送 | 已接受 |
| [0042](./0042-custom-sticker-limits.md) | 自製貼圖容量與規格限制（標籤上限 + 現有 SVG 上限盤點） | 已接受 |
| [0043](./0043-animated-sticker-norms.md) | 自製動態貼圖規範（借鏡 LINE：reduced-motion 護欄 + 維持 SVG/上限） | 已接受 |
| [0044](./0044-enterprise-closed-relay.md) | 企業模式：封閉 allowlist 中繼 + 自架單節點 | 已接受 |
| [0045](./0045-multi-identity-profiles.md) | 單一 App 多身分並存與切換（工作＋個人） | 已接受 |
| [0046](./0046-enterprise-membership-and-boundary.md) | 企業成員判定與對外通訊邊界（威脅模型） | 已接受 |
| [0047](./0047-enterprise-provisioning-roster.md) | 企業佈建與組織通訊錄（管理者簽章名冊） | 已接受 |
| [0048](./0048-enterprise-policy-and-turn.md) | 企業政策開關與強制 TURN（relay allowedKinds + 名冊政策） | 已接受 |
| [0049](./0049-org-groups-and-announcements.md) | 組織群組與公告（管理者佈建） | 已接受 |
| [0050](./0050-mentions.md) | @提及 Mention：NIP-01 p-tag 攜帶於加密 rumor 內層 | 已接受 |
| [0051](./0051-threads.md) | 對話串 Thread：NIP-10 reply e-tag + 右側面板（Slack 佈局） | 已接受 |
| [0052](./0052-enterprise-identity-rotation.md) | 企業工作身分輪替/重佈建（否決金鑰托管，無後門） | 已接受 |
| [0053](./0053-tauri-native-substrate-integration.md) | Tauri 原生整合：基質替換（重用 TS 引擎）＋ B5 金鑰庫 | 已接受 |
