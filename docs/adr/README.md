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
| [0019](./0019-background-relay-connection.md) | 背景長連線：政策驅動器 + I/O 執行期（Phase B3） | **被取代 by 0105**（原生實作已退役；目標由系統匣達成，0106 實測無節流） |
| [0020](./0020-native-persistence-sqlite-sqlcipher.md) | 原生持久化：SQLite / SQLCipher（Phase B4） | **被取代 by 0054**（加密 blob）；死碼由 0105 移除 |
| [0021](./0021-stickers.md) | 貼圖（Stickers，M7） | 已接受 |
| [0022](./0022-voice-messages.md) | 語音訊息（Voice Messages，M7） | 已接受 |
| [0023](./0023-media-album.md) | 媒體相簿（Album，M7） | 已接受（⚠ 內文的「跨 session 需 B4 SQLite」已作廢 → 由 **0102** 以縮圖重新設計） |
| [0024](./0024-qr-add-friend.md) | QR 加好友：npub QR 產生（M9） | 已接受 |
| [0025](./0025-call-signaling.md) | 語音/視訊通話信令核心（M8） | 已接受（⚠ 內文的「尚未接 RTCPeerConnection/通話 UI」已過時——桌面早已實作，行動端見 **0101**） |
| [0026](./0026-call-runtime-ui.md) | 通話執行期與 UI（M8） | 已接受 |
| [0027](./0027-group-encryption.md) | 群組聊天加密方案（M9） | 已接受 |
| [0028](./0028-forward-secrecy.md) | 前向保密：維持靜態金鑰、FS/PCS 交由未來 MLS（F2） | 已接受 |
| [0029](./0029-datachannel-binary-framing.md) | 資料通道檔案分塊改用二進位框架（F3/C4） | 已接受 |
| [0030](./0030-presence-ux-idle-away-and-status-formatting.md) | 在線狀態 UX：閒置自動離開與狀態列表情/格式 | 已接受 |
| [0031](./0031-animated-stickers.md) | 動態貼圖：宣告式 SVG 動畫（CSS keyframes） | 已接受 |
| [0032](./0032-custom-stickers.md) | 自製貼圖：內容隨訊息、SVG 統一表示、點擊即擁有 | 已接受 |
| [0033](./0033-sticker-editor.md) | 貼圖編輯器：筆劃模型序列化為 SVG path（桌面優先） | 已接受 |
| [0034](./0034-multi-relay-routing.md) | 跨中繼通訊：客戶端 Relay Pool 與收件人路由 | 已接受 |
| [0035](./0035-relay-hint-learning.md) | Relay hint 自動學習：帶內加密 hint（否決 NIP-65） | 已接受（其「可取代事件未實作」已由 **0099** 收斂） |
| [0036](./0036-relay-hint-staleness.md) | Hint 陳舊偵測與離線回退；群訊 rumor 帶 hint | 已接受 |
| [0037](./0037-sticker-text-triggers.md) | 文字觸發貼圖：composer 尾端比對 + 建議列（Tab 送出） | 已接受 |
| [0038](./0038-url-hygiene.md) | 網址衛生：貼上清除追蹤參數 + 本地啟發式高風險警告 | 已接受 |
| [0039](./0039-hybrid-bootstrap-routing.md) | 混合式引導路由：錨點常數 + 簽章清單 + home 自動遞補 | 已接受 |
| [0040](./0040-group-local-labels.md) | 群組本地標籤與置頂（自訂標籤，純客戶端） | 已接受 |
| [0041](./0041-outbox-paced-delivery.md) | 可靠訊息節流外送匣：OK 感知重試 + 重連補送 | 已接受 |
| [0042](./0042-custom-sticker-limits.md) | 自製貼圖容量與規格限制（標籤上限 + 現有 SVG 上限盤點） | 已接受 |
| [0043](./0043-animated-sticker-norms.md) | 自製動態貼圖規範（借鏡 LINE：reduced-motion 護欄 + 維持 SVG/上限） | 已接受 |
| [0044](./0044-enterprise-closed-relay.md) | 企業模式：封閉 allowlist 中繼 + 自架單節點 | 已接受 |
| [0045](./0045-multi-identity-profiles.md) | 單一 App 多身分並存與切換（工作＋個人） | 已接受（⚠ 內文的「nsec 應改存 OS 金鑰庫」已由 **0053** 完成） |
| [0046](./0046-enterprise-membership-and-boundary.md) | 企業成員判定與對外通訊邊界（威脅模型） | 已接受 |
| [0047](./0047-enterprise-provisioning-roster.md) | 企業佈建與組織通訊錄（管理者簽章名冊） | 已接受 |
| [0048](./0048-enterprise-policy-and-turn.md) | 企業政策開關與強制 TURN（relay allowedKinds + 名冊政策） | 已接受 |
| [0049](./0049-org-groups-and-announcements.md) | 組織群組與公告（管理者佈建） | 已接受 |
| [0050](./0050-mentions.md) | @提及 Mention：NIP-01 p-tag 攜帶於加密 rumor 內層 | 已接受 |
| [0051](./0051-threads.md) | 對話串 Thread：NIP-10 reply e-tag + 右側面板（Slack 佈局） | 已接受 |
| [0052](./0052-enterprise-identity-rotation.md) | 企業工作身分輪替/重佈建（否決金鑰托管，無後門） | 已接受 |
| [0053](./0053-tauri-native-substrate-integration.md) | Tauri 原生整合：基質替換（重用 TS 引擎）＋ B5 金鑰庫 | 已接受 |
| [0054](./0054-encrypted-storage-substrate-aes-gcm.md) | 加密儲存基質：AES-256-GCM 加密 blob（純 Rust，免 SQLCipher/Perl） | 已接受 |
| [0055](./0055-block-cross-identity-friending.md) | 禁止跨身分互加好友（保護分身不可連結） | 已接受 |
| [0056](./0056-offline-store-durable-object-sqlite.md) | 離線留言持久層：Durable Object 內建 SQLite（非獨立 D1） | 已接受 |
| [0057](./0057-open-relay-nip42-auth.md) | 開放中繼 NIP-42 AUTH（讀取＋發布；企業維持 allowlist） | 已接受 |
| [0058](./0058-delivery-read-receipts.md) | 送達／已讀回條（Gift Wrap 回條，已讀 opt-in＋互惠） | 已接受 |
| [0059](./0059-relay-hibernation-heartbeat.md) | 中繼站 WebSocket 休眠化 + 心跳 30s（降免費層 duration/請求） | 已接受 |
| [0060](./0060-local-ollama-rewrite.md) | 本機 Ollama 訊息改寫（Rust IPC、localhost 限定、先預覽再採用） | 已接受 |
| [0061](./0061-encrypted-display-name.md) | 顯示名稱以加密個人檔廣播給聯絡人（非公開 kind 0） | 已接受 |
| [0062](./0062-online-llm-providers.md) | 桌面版接線上 LLM provider（OpenAI 相容、API key 存金鑰庫、localhost 守則把關） | 已接受 |
| [0063](./0063-phase-d-mobile-scaffold.md) | Phase D 行動端骨架：react-native-web 於此環境開發、重用 core/i18n | 已接受 |
| [0064](./0064-custom-accent-color.md) | 自訂主題色（本地儲存、單一 --accent 覆寫、吉祥物連動） | 已接受 |
| [0065](./0065-offline-store-ttl-cap.md) | 離線留言壽命上限（無標籤給預設 TTL、超長截斷——孤兒資料不可能） | 已接受 |
| [0066](./0066-home-relay-migration.md) | Home relay 搬家（個人檔廣播帶 hint ＋ 舊站排水） | 已接受 |
| [0067](./0067-local-password.md) | 本地密碼：密碼衍生金鑰包裹身分祕密（否決 nsec 日常登入） | 已接受 |
| [0068](./0068-group-snapshot-broadcast.md) | 管理員開機群組快照廣播（群組成員資格自癒） | 已接受 |
| [0069](./0069-auto-relay-assignment-migration.md) | Relay 自動分配與自動搬家（簽章清單驅動） | 已接受 |
| [0070](./0070-encrypted-backup-code.md) | 加密備份碼（NIP-49 混合式、使用者自持） | 已接受 |
| [0071](./0071-encrypted-cloud-snapshot.md) | 加密雲端快照（三檔模式、可尋址取代、opt-in） | 已接受 |
| [0072](./0072-desktop-pairing-clone.md) | 桌面配對克隆（D4a：一次性 P2P 全量搬家＋SAS 互認） | 已接受 |
| [0073](./0073-forgotten-password-nsec-rescue.md) | 忘記密碼救援：nsec 解鎖並重設密碼（雙重包裹） | 已接受 |
| [0074](./0074-frontend-extensibility-engine-package.md) | 社群自訂前端：三層封裝與 @cinder/engine 抽取 | 已接受 |
| [0075](./0075-containerized-relay-self-hosting.md) | 容器化中繼站自架（Dockerfile＋HTTP 健康端點） | 已接受 |
| [0076](./0076-desktop-native-notifications.md) | 桌面原生通知（外掛＋點擊回跳＋傳訊者/預覽/音效） | 已接受 |
| [0077](./0077-local-personalization.md) | 本地個人化（對話框縮放＋本地頭像＋每對話背景） | 已接受 |
| [0078](./0078-secondary-accent-color.md) | 副色（次要主題色：標題列＋頂部漸層） | 已接受 |
| [0079](./0079-three-column-layout-toggle.md) | 桌面三欄整合佈局＋經典/新版一鍵切換 | 已接受 |
| [0080](./0080-shared-theme-tokens-package.md) | 跨前端設計 token 套件 @cinder/theme（桌面/行動端共用主題色 SSOT） | 已接受 |
| [0081](./0081-mobile-signin-nsec-and-pairing.md) | 行動端登入：nsec 匯入＋配對匯入（同帳號跨裝置） | 已接受 |
| [0082](./0082-user-facing-naming-glossary.md) | 使用者可見名稱統一詞彙表（登入／同步／搬家／備份／配對） | 已接受 |
| [0083](./0083-drain-fully-internal.md) | 舊站排水完全內部化（移除所有 UI，機制不變） | 已接受 |
| [0084](./0084-code-identifier-naming.md) | 程式碼識別字命名：行動端 i18n 前綴一致化，其餘刻意保留 | 已接受 |
| [0085](./0085-mobile-app-shell-navigation.md) | 行動端 app 殼與導覽：聊天清單（最近互動排序）＋對話（LINE/Signal 風格） | 已接受 |
| [0086](./0086-mobile-real-relay-backend.md) | 行動端接真實 relay：RelayChatBackend＋加好友（npub） | 已接受（其列出的四項落差已由 **0100／0101** 全數補齊） |
| [0087](./0087-mobile-bottom-tabs.md) | 行動端底部分頁：聊天／聯絡人／設定 | 已接受 |
| [0088](./0088-presence-metadata-minimization-jitter-and-p2p-offload.md) | 元資料最小化（第一階段）：在線 jitter/隱身＋心跳 P2P 卸載 | 已接受 |
| [0089](./0089-relay-operator-donation-entry.md) | Relay 營運者贊助入口（NIP-11 擴充＋桌面角落卡＋純導流） | 已接受 |
| [0090](./0090-official-website-donation-and-fund-transparency.md) | 官方網站、官方捐款與資金透明度（靜態站＋簽章 JSON runway） | 已接受 |
| [0091](./0091-forward-secrecy-mls-upgrade-design.md) | 前向保密升級：統一採 MLS（含正常使用者可靠性護欄） | 已棄用（暫緩未採納，維持 0028） |
| [0092](./0092-node-membership-self-report-and-conformance-audit.md) | 節點成員自報＋一致性稽核＋簽章可驗證記錄（申請/審查/稽核介面化） | 已接受 |
| [0093](./0093-multi-device-delivery-and-file-persistence.md) | 多設備即時投遞與檔案接收：檔案 metadata 中繼化＋位元組 P2P＋收檔另存至使用者選定路徑 | 已接受 |
| [0094](./0094-retention-limit-and-plaintext-export.md) | 本地紀錄保留上限（可設定、預設無上限）與明文紀錄導出（TXT/MD/JSON、範圍可選） | 已接受 |
| [0095](./0095-group-receipts-and-message-status-icons.md) | 群組送達/已讀分級（≤5 名單／6–10 計數／>10 不記）＋failed 狀態與眼睛圖示語言＋行動端狀態同步 | 已接受 |
| [0096](./0096-mobile-vector-icons-react-native-svg.md) | 行動端向量圖示改採 react-native-svg＋web 端解析設定；補行動端群組已讀 UI（收斂 0095 後續） | 已接受 |
| [0097](./0097-inline-math-preview-and-calc-panel.md) | 對話算式預覽：composer 即時預覽＋右欄計算機（純本地純函式、禁用 eval、保守觸發） | 已接受 |
| [0098](./0098-cli-and-ai-mcp-boundaries.md) | 無頭 CLI（無狀態：不留私鑰/明文歷史）＋AI/MCP 接取邊界（致命三角、只提議不直送、雲端 LLM 預設關） | 已接受 |
| [0099](./0099-replaceable-events-and-kind-collision-fix.md) | 中繼站實作 NIP-01 可取代事件（收斂 0035：清單不再囤積）＋修正 kind 10038 撞號 | 已接受 |
| [0100](./0100-mobile-parity-anchors-cloud-files.md) | 行動端補齊：錨點/簽章清單、加密雲端備份、檔案傳輸（收斂 0086）＋引導設定移入 engine（SSOT） | 已接受 |
| [0101](./0101-mobile-calls.md) | 行動端通話（語音/視訊）：媒體平台縫（<video> 收斂於單一檔）＋react-native-webrtc 移植路徑 | 已接受 |
| [0102](./0102-image-thumbnails-and-relocate-original.md) | 圖片跨 session：持久化縮圖＋從 savedPath 讀回原圖＋原檔搬走可重新指定（收斂 0023） | 已接受 |
| [0103](./0103-native-file-picker-sender-path.md) | 送出端改走原生選檔對話框以取得原檔路徑（補完 0102：自己傳的圖也看得到原圖） | 已接受 |
| [0104](./0104-native-file-drop.md) | 原生檔案拖放（Tauri onDragDropEvent）＋修好「打包後拖放根本沒作用」；拖放也取得真實路徑 | 已接受 |
| [0105](./0105-retire-native-backend-dead-code.md) | 退役原生後端死碼（0019 背景連線／0020 SQLite）＋讓 cargo test 真的測到出貨的密碼學 | 已接受 |
| [0106](./0106-webview-throttling-measurement.md) | 實測：隱藏視窗的 webview 不會被節流（心跳全速）→ 推翻「引擎下沉 Rust」的主要理由，決策不下沉 | 已接受 |
| [0107](./0107-nip17-self-copy.md) | NIP-17 自封副本：自己發的訊息也包一份給自己 → 多裝置對話完整；訊息 id 統一為 rumor.id | 已接受 |
| [0108](./0108-read-watermark-local.md) | 已讀水位本機持久化（未讀不再重載歸零）＋訊息時間改用 rumor.created_at（修正順序錯亂） | 已接受 |
