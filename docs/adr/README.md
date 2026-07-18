# 架構決策紀錄（ADR）

本目錄記錄 Cinderous（原名 Cinder，ADR-0191 更名）的重大架構與設計決策（Architecture Decision Records）。

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
| [0109](./0109-relay-traffic-reduction.md) | 中繼流量削減約 90%：自適應心跳（閒置放慢）＋心跳自報節奏＋訂閱合併為單一 REQ＋收件箱增量抓取 | 已接受 |
| [0110](./0110-long-conversation-hot-paths.md) | 長對話熱路徑：id 索引（O(n²)→O(n)）、批次回條（3.5s→18ms）、增量未讀、分部位持久化 | 已接受 |
| [0111](./0111-message-archive.md) | 訊息封存（冷熱分離）：熱區 5,000 則、更舊者移入加密塊檔／OPFS；把 N 綁住，並修好 0094 的資料遺失 | 已接受 |
| [0112](./0112-web-at-rest-encryption.md) | 網頁/行動端靜態加密（DEK=HKDF(nsec)）＋**nsec 不再明文落盤**；推翻 0067 的「瀏覽器＝假安全感」 | 已接受 |
| [0113](./0113-local-launcher.md) | 本地啟動器 `cinder serve`：固定 port（origin ＝ 資料的身分）、撞埠不自動換、路徑穿越防護 | 已接受 |
| [0114](./0114-mobile-parity-messaging.md) | 行動端對齊（一）：修好群訊（點進群組送訊會爆）＋補上收回／emoji 回應／封鎖 | 已接受 |
| [0115](./0115-mobile-parity-groups.md) | 行動端對齊（二）：建立群組與成員管理、敲一下（可發）、上線狀態 | 已接受 |
| [0116](./0116-mobile-notifications.md) | 行動端通知（＋隱藏預覽的隱私開關）；Web Notification 基質收斂為單一來源；不做推播 | 已接受 |
| [0117](./0117-mobile-remember-me.md) | 行動端「記住我」：Argon2id 密碼包裹 nsec（絕不無密碼記住）；忘記密碼無救援但可改用 nsec | 已接受 |
| [0118](./0118-pairing-source-identity.md) | **修好桌面配對搬家**（捆包一直沒有 nsec）＋行動端補上送出端與真實的匯入 | 已接受 |
| [0119](./0119-health-check-fixes.md) | **全面健檢**：分部位寫入失敗＝靜默資料遺失、Rust 非原子寫入（斷電毀一整個對話）、**ADR-0112 在桌面瀏覽器路徑上整個是死碼**、瀏覽器「新增身分」造出打不開的身分、`stop()` 不關連線、群組回應／收回兩端皆爆 | 已接受 |
| [0120](./0120-seal-typing-nudge.md) | **typing／nudge 以 NIP-59 封裝**——明文的「正在輸入」是一條已簽章的社交圖譜邊，且能靠時間相關性**反推 Gift Wrap 的寄件人**；訂閱改為只靠 `#p`，並補上「只收聯絡人」的把關 | 已接受 |
| [0121](./0121-message-requests.md) | **訊息請求**：陌生人的訊息不再自動讓他變成聯絡人——在你接受前，他碰不到通知、未讀徽章、自動開窗、nudge、typing、上線狀態、個人檔、已讀回條 | 已接受 |
| [0122](./0122-browser-identity-persistence.md) | **瀏覽器版重載會把你換成另一個人**——身分不得被靜默替換（`expectPubkey` 守衛）＋接上一直是死碼的瀏覽器本地密碼 | 已接受 |
| [0123](./0123-relay-scoped-subscriptions.md) | **中繼訂閱必須具名**——`{kinds:[20000]}` 這種無 scope 的 filter 可一次收割全站線上名冊；順帶修好「一致性探測不做 AUTH → 每次 cron 都把自己的中繼判成不存活」 | 已接受 |
| [0124](./0124-group-file-transfer.md) | **群組傳檔**：metadata 扇給每位成員（共用 rumor 與 tid）、位元組各自 P2P；順帶修正 `onFileBytes` 回報 peer 而非對話鍵 | 已接受 |
| [0125](./0125-mobile-pair-import-apply-bundle.md) | **行動端配對搬家要套用捆包**——過去只還原身分，換手機後聯絡人與訊息全部沒搬過去（只搬空身分）；順帶補上行動端的 ADR-0122 身分守衛 | 已接受 |
| [0126](./0126-retention-cap-archives-not-deletes.md) | **保留上限＝封存而非刪除**——統一與 HOT_CAP 各說各話的兩個上限；使用者設上限不再靜默刪歷史，溢出移進封存（web/mobile 移出 localStorage 紓解配額） | 已接受 |
| [0127](./0127-message-request-flood-control.md) | **訊息請求防洪**：數量上限 100（FIFO 逐出，連訊息一起清）＋「全部刪除」一鍵出路；速率限制由硬上限上位替代 | 已接受 |
| [0128](./0128-file-ipc-hardening.md) | **檔案 IPC 縱深防禦**：收檔檔名消毒（遠端可控 → 乾淨 basename）＋ `read_saved_file` 路徑白名單（只讀原生對話框授權過的路徑，雜湊持久化） | 已接受 |
| [0129](./0129-sealed-presence-state.md) | **在線狀態內容改走封裝**：心跳降為無內容存活信標；狀態文字與音樂改以 NIP-59 封裝、只在改變/對方上線時發給「在線✕無P2P」的聯絡人——relay 再也讀不到你在聽什麼、狀態寫什麼 | 已接受 |
| [0130](./0130-jsdom-effect-tests.md) | **UI 測試補上會跑 `useEffect` 的環境**（jsdom 逐檔切、`createRoot`+`act`，不churn 既有 SSR 測試）——關掉「effect 從不執行」的測試盲區（ADR-0122 的 P0 就藏在那裡） | 已接受 |
| [0131](./0131-buffer-early-group-messages.md) | **早到的群訊不再被丟掉**——群訊比 group-create 先到（NIP-59 jitter 打亂順序）時緩存、加入後依時間重放；有界＋去重防假 `g` tag 撐爆記憶體 | 已接受 |
| [0132](./0132-image-share.md) | **圖片分享**：行動端走原生分享選單（Web Share API，與其他手機 app 同體驗，不支援退回下載）、桌面燈箱走快速複製（複製圖片轉 PNG／複製路徑，僅在已另存時）；掛在圖片訊息上、不綁相簿 | 已接受 |
| [0133](./0133-mobile-mentions.md) | **行動端補 @提及**：建議純函式（`suggestMentions`／`applyMention`）下沉 `@cinder/core`、兩端共用；行動端加建議列、送出解析成 `p` tag、被提及氣泡凸顯 | 已接受 |
| [0134](./0134-mobile-chat-background.md) | **行動端補對話背景**：背景 token（預設漸層／CSS 產生／儲存鍵）下沉 `@cinder/theme`、桌面 re-export 零改動；行動端加標題列入口＋預設漸層挑選，純本地不上雲（圖片上傳待原生） | 已接受 |
| [0135](./0135-mobile-identity-security-ui.md) | **行動端身分安全 UI**：改本地密碼（舊解新包）、產生加密備份碼（ADR-0070 core 早備）、登入/救援欄位同時吃 nsec 與備份碼；密碼學全在 core，行動端只接線 | 已接受 |
| [0136](./0136-mobile-inline-reply.md) | **行動端對話串/回覆**：內嵌引用（Signal/LINE 風），同 `replyTo` 資料、與桌面討論串面板各自呈現；長按→回覆→引用列→送出帶 NIP-10 reply e-tag；引用對已收回/檔案/引用不到皆安全處理 | 已接受 |
| [0137](./0137-mobile-stickers.md) | **行動端貼圖**：貼圖格式/內建資料/SVG 驗證下沉 `@cinder/core`、桌面 import 改指 core；行動端渲染收到的貼圖（含收端驗證惡意 SVG）＋內建貼圖挑選送出；編輯器留桌面 | 已接受 |
| [0138](./0138-mobile-multi-identity.md) | **行動端多身分**：採用 engine `profiles` 登錄、每身分 Argon2id 密碼包裹的 nsec（`nb.remembered.<pubkey>`）、舊單一身分無縫遷移；切換即解該身分密碼、新增、逐一登出；禁跨身分交友（ADR-0055） | 已接受 |
| [0139](./0139-unified-custom-dialog.md) | **統一自訂對話框**：Promise 介面的 confirm/alert/prompt（`useDialog`＋`DialogProvider`）取代瀏覽器內建；重用視窗樣式、主題感知、Esc/Enter/背景鍵盤操作、破壞性紅鈕；非元件走 `dialog()` 橋接、無 provider 回退 | 已接受 |
| [0140](./0140-fix-identity-switch-duplicate.md) | **修復切換身分→掉登入頁→建重複身分（帶舊聯絡人）**：Tauri 取不到金鑰改救援分流（`setNeedNsec`，與瀏覽器對稱）；`signIn` 命名空間隔離（純函式 `pickSignInNamespace`，非第一身分不重用 `""`）；救回即補寫金鑰庫治本 | 已接受 |
| [0141](./0141-unified-button-system.md) | **統一按鈕系統**：主要動作＝主色實心（隨主題色，取代所有綠色漸層）、中性＝描邊淺底、危險＝單一紅；裸 `<button>` 給中性預設不再落回 OS 灰；全域一致焦點環/停用態；語意色（接聽綠/掛斷紅）保留 | 已接受 |
| [0142](./0142-modern-layout-settings-and-status.md) | **三欄版改善**：設定入口移到上方 nav（idbar）不再擠頭像旁；左側欄補回自訂狀態文字＋正在聽（與經典版對齊）；設定改分頁（外觀/身分安全/連線備份/隱私通知/進階），只顯有內容分頁 | 已接受 |
| [0143](./0143-embedded-conversation-flush.md) | **三欄中欄內嵌對話整塊填滿**：去除外框/視窗底色/彩色標題列（不再像浮動視窗），標題列改扁平對話標頭；並修正把 JSX `//` 註解當文字渲染的 bug | 已接受 |
| [0144](./0144-change-display-name.md) | **更改顯示名稱（桌面＋行動）**：後端加 `setSelfName`（落地本機＋廣播加密 profile 給聯絡人 ADR-0061）；設定加改名欄，同步 self/登錄/記住的 blob；不換金鑰、不換身分 | 已接受 |
| [0145](./0145-add-identity-type-picker.md) | **新增身分先選類型（個人／組織）**：`AddIdentityModal` 改兩步——先以圖示＋說明選 👤 個人／🏢 組織（ADR-0047），再填表單；`mode` 取代 `enterprise` 布林、管理者 npub 欄只在組織出現、可回頭改選；`onAdd` 簽章不變 | 已接受 |
| [0146](./0146-signin-by-name-and-unique-names.md) | **登入以顯示名稱解析既有身分＋本機名稱唯一**：桌面登入打既有名字＝`setActive`+reload 進那個身分（重用解鎖/救援路徑，Fix First），不建重複；純函式 `resolveSignIn`／`nameTaken`（排除 hidden、trim 比對）下沉 engine；新增/改名兩端擋重名；名稱只是查找鍵非加密鍵，安全不變；行動端登入係 nsec 導向故只做名稱唯一 | 已接受 |
| [0147](./0147-self-hosted-web-app-separate-origin.md) | **自架網頁版部署——app 與官網分子網域**：瀏覽器版＝`apps/desktop` 的 web build（`isTauri()=false`，金鑰本機加密 ADR-0112/0122）；自架須把 app 與官網放**不同 origin**（延續 ADR-0090 隔離）、app origin HTTPS＋嚴格 CSP；relay 經 `?relay=`／`ANCHOR_RELAYS`／手動指定；官方 `apps/website` 維持硬隔離不變。附 `docs/self-hosting-web-app.md` 指南 | 已接受 |
| [0148](./0148-local-contact-alias.md) | **本地暱稱**：給聯絡人取**只有自己看得到**的顯示名（`Contact.alias`＋`setContactAlias`），恒優先於廣播名顯示（純函式 `contactLabel` 兩端共用）；**絕不廣播/上雲**，只隨自己的加密快照/搬家流動；不覆寫廣播名——對話標頭點名字可在暱稱↔廣播名切換、✎ 設定/清除（1:1、桌面＋行動） | 已接受 |
| [0149](./0149-notification-chime-presets-per-contact.md) | **通知音效自訂（桌面）**：6 種 Web Audio 合成預設集（`CHIME_PRESETS` 純資料配方，零音檔，未知 id 退回叮咚）；設定面板全域音效下拉＋試聽（`nb.notifyChime`）；依聯絡人覆寫 `Contact.notifySound`＋`setContactNotifySound`（比照 ADR-0148：**絕不廣播/上雲**，隨加密快照流動），對話標頭 🔔 指定；自訂音檔留待後續 ADR | 已接受 |
| [0150](./0150-custom-window-frame-configurable-controls.md) | **自繪視窗外框＋按鈕位置/順序可自訂（桌面）**：`decorations:false`＋前端自繪標題列（簡約扁平、吃主題 token）；`nb.titlebarControls`（左/右＋─□✕ 任意排，`parseTitlebarControls` 防呆永遠有效）；`WindowChrome` 包所有畫面（登入/解鎖也有外框）、瀏覽器版透傳；設定→外觀迷你預覽＋←→ 逐顆調；取捨：Win11 Snap Layouts 懸停選單消失。設定模型由 [0151](./0151-titlebar-settings-button-drag-autohide.md) 升級為雙帶 | 已接受 |
| [0151](./0151-titlebar-settings-button-drag-autohide.md) | **標題列 ⚙ 上移外框＋滑鼠拖曳排位＋平時隱藏**：設定模型升級雙帶 `{left[], right[], autoHide}`（v1 同鍵自動遷移、⚙ 補對側）；⚙ 成為第四顆可拖控制項（App 以 context 註冊開啟器、沒註冊不畫；Tauri 下 nav bar ⚙ 不重複畫）；設定頁改「編輯器即預覽」HTML5 拖放（拖到某顆前/帶尾，`placeControl` 純函式）；`autoHide`＝按鈕平時 opacity 0、hover 標題列才顯示。拖曳機制與 ⚙ 預設位置由 [0152](./0152-titlebar-drag-pointer-events-default-position.md) 修正 | 已接受 |
| [0152](./0152-titlebar-drag-pointer-events-default-position.md) | **拖曳改 pointer events＋⚙ 預設貼最小化左側（修 0151）**：Tauri `dragDropEnabled`（ADR-0104）在 WebView2 吞 HTML5 DnD → 改 `setPointerCapture`＋`elementFromPoint` 命中 `data-drop-side`/`data-piece` 自行實作（in-app 拖曳日後一律走 pointer events）；預設改 `{left:[], right:[⚙,─,□,✕]}`，v1 遷移 ⚙ 補帶最前、0151 舊預設視為未自訂自動轉新預設（autoHide 保留） | 已接受 |
| [0153](./0153-autohide-whole-titlebar.md) | **平時隱藏＝整條標題列滑出（修 0151 語意）**：autoHide 改為標題列 fixed 覆蓋層 `translateY(-100%)` 滑出、視窗頂端 6px 熱區或標題列 hover 才滑入（z-index 100/101 蓋過 app 內一切；reduced-motion 關動畫）；內容拿回全高（`--viewport-h` 回 100vh）；外框本體抽 `ChromeFrame` 供 SSR 測試；`TitleBar` 不再感知 autoHide | 已接受 |
| [0154](./0154-avatar-encrypted-broadcast.md) | **頭像加密廣播**：`wrapProfile` content 擴成 `{name, avatar?}`（128px data URI 縮圖；`""`＝移除；缺席＝無變更）；收端白名單 `data:image/*` ＋48KB 上限；**網址只當輸入方式**（本人裝置抓圖轉縮圖，不把 URL 發給對方＝不做追蹤信標）；雲端快照剝除 avatar（180KB 預算）；0077 本地頭像不自動廣播（`setSelfAvatar` 明確觸發）；顯示優先序 本地覆寫＞廣播＞生成；補三平台入口（DeckSidebar／行動端設定頁） | 已接受 |
| [0155](./0155-org-owner-identity-converged-roster-entry.md) | **企業主身分＋名冊入口收斂**：`Profile.orgOwner` 標記（一般身分＋名冊管理權，後端語意同個人）；新增身分第三類型 🗂 企業主（0145 兩步流程加一顆，表單無管理者欄——自己就是管理者）；建立後首次進入自動開名冊管理（`nb.rosterIntro.<pubkey>` 跨 reload）；idbar 🗂 從「人人可見」收緊為僅企業主顯示；idbar tooltips 進 i18n | 已接受 |
| [0156](./0156-org-invite-code-auto-join.md) | **入職邀請碼與自動入職**：`cinderinvite1…` 單一 token（relay＋管理者 pubkey＋核准權杖；可嵌任意文字中抽取）；成員三入口（登入畫面貼碼轉「加入組織」面板／企業成員表單貼碼自動填／開機重送入職請求直到入冊）；企業主自動核准（訂自己的可取代名冊找回狀態、驗權杖、自動併入重發、自動加聯絡人；首發前排隊）；入職請求為加密 rumor（`ORG_JOIN=42`，走離線信箱） | 已接受 |
| [0157](./0157-org-profile-welcome-work-hours.md) | **公司設定隨名冊分發**：`OrgRosterDoc` 擴 `welcome`（歡迎詞/基本規範，≤2000 字）與 `workHours`（HH:MM，支援跨夜）；成員端 `onOrgInfo` → 歡迎詞一次性彈窗（內容變更再彈）＋設定「組織資訊」區＋**下班自動靜音**組織通知（純函式判定；未讀照常）；企業主名冊視窗新增欄位＋ `currentRoster()` 預填（不再每次重打）；自動核准重發保留公司設定 | 已接受 |
| [0158](./0158-contact-labels-and-org-title.md) | **聯絡人標籤補全＋企業頭銜**：經典佈局補標籤入口（對話視窗對方頭像旁 chips＋🏷）；`forget()` 刪除/封鎖一併清標籤；**企業頭銜**自填隨加密個人檔廣播（`ProfileData.title` ≤24 字、`""`＝移除；工作身分聯絡人＝全組織同事 → 自然全員可見）；顯示以實心 `chip--role` 與私標 outline chip 色彩區隔；`selfTitle` 三態持久化隨快照/搬家；手機版標籤與同步留待後續 | 已接受 |
| [0159](./0159-off-hours-sender-hint.md) | **下班時間發訊提示**（0157 的發訊端另一半）：組織對話（成員 1:1/組織群組）在表定時間外，輸入區上方顯示非阻斷橫幅「對方通知已靜音，可能不會即時看到；訊息照常送達」；同一份名冊班表本地判定、每分鐘重算、不擋送出；明文確認靜音不影響投遞/入庫/未讀 | 已接受 |
| [0160](./0160-org-message-retention.md) | **企業訊息保留天數**：名冊政策 `messageTtlDays`（1–365，管理者設定、全組織一致）→ 發送端對聊天/檔案 metadata 蓋 `now+N天` 外層過期（閱後即焚不受影響）；中繼站 `MAX_TTL_DAYS` 環境變數放寬 TTL 上限（CF Worker＋node；未設＝7 天不變，站方上限恆為權威、超章截斷）；任何新舊組合都取兩者較小值、不會壞 | 已接受 |
| [0161](./0161-company-slot-queued-deposit.md) | **公司儲存槽**：員工**主動選擇**檔案存入（自主動作非監控）→ 本地佇列（存 savedPath 不存位元組）→ 企業主上線即背景 P2P 傳輸；`slot` rumor 標籤讓兩端不建聊天訊息；企業主端只收名冊成員、靜默落盤 `<槽>/<員工>/<日期>-<檔名>`＋index.jsonl（Rust 指令、基底外拒寫、逐段消毒）；未設槽目錄＝appData 預設；Tauri 桌面限定 | 已接受 |
| [0162](./0162-org-relay-file-transfer.md) | **組織檔案經 relay 暫存**（企業限定、預設關）：獨立外層 kind `FILE_WRAP=1060`（密文分塊 ≤48KB/塊，`FILE_CHUNK=43`）讓中繼站能整類拒收＋獨立配額桶（預設 4000 顆/收件人，**不與聊天 500 則互踐**）；`MAX_FILE_MB` 環境變數未設＝拒收（公共站零影響）；名冊政策 `relayFilesMaxMb`（1–16）啟用後名冊成員 1:1 小檔自動走 relay——離線收件人上線即收；大檔/群組維持 P2P | 已接受 |
| [0163](./0163-org-key-escrow-offboarding.md) | **入職金鑰託管＋離職接管**（公司帳號模型）：邀請碼 `escrow` 旗標（揭露、員工同意）→ 入職請求（0156 Gift Wrap E2E）順帶 nsec＝以管理者公鑰加密託管；企業主 `onOrgEscrow` 持久化 `nb.orgEscrow.<admin>`；離職＝名冊移除→`rosterAllowlist` 排除→舊金鑰連公司站都發不了（可執行的封鎖）；接管＝託管 nsec 匯入為 `orgOffboarded` 本機身分查看/刪除；ADR 明載「歷史＝relay 殘留＋同事副本、防不住在職自行外洩」的誠實極限 | 已接受 |
| [0164](./0164-local-presence-persistence.md) | **本機記住上線狀態與自訂狀態文字**：`nb.presence.<pubkey>` 存 `{status, statusMessage}`（純本機、依身分、不進 Nostr/雲端）；只記**手動**選擇（閒置自動 away 不落地）；上線還原（塞進 self 讓 idle 以此為基準＋`start()` 後同步後端廣播）；`nowPlaying` 維持 Ephemeral；**中繼站仍不持久化狀態**、鐵則不變 | 已接受 |
| [0165](./0165-usage-aware-heartbeat-shedding.md) | **依使用習慣的心跳時段降載**（研究記錄）：降載接入點單一（`beatInterval()`）、`hb` 自報已支援任意節奏、IDLE→ACTIVE 即時喚醒現成；方案 A 學習時段直方圖／方案 B 漸進閒置退避（推薦、不用學習）；最大浪費 ADR-0109 已消除、再降載為增量效益（省電/省額度）→ **暫緩**，待量測支撐先做方案 B | **暫緩（未實作）** |
| [0166](./0166-monetization-surface-and-trademark.md) | **營利面盤點與商標建議**（研究記錄）：**AGPL 不禁止收費**（自由非價格）——只擋閉源圈地（copyleft）＋要求 SaaS 揭露源碼；「作者不營利」已結構性達成（零站內金流＋簽章資金透明度）；「他人不營利」AGPL 做不到，盤點六種營利面（付費 relay/改名販售/fork 站內營利/賣元資料/賣支援/冒充官方）；唯一有效防線＝**註冊 Cinder 商標＋Logo＋商標政策**；非商業授權為代價大的備選 → **暫緩** | **暫緩（未實作）** |
| [0167](./0167-per-identity-appearance-and-titlebar-styles.md) | **外觀依身分覆寫、回退裝置層**：`identity-scoped` 儲存（`nb.<pubkey>.<suffix>` → `nb.<suffix>`）套用於**主色/佈局/標題列**；主題/語言維持全域（裝置偏好）；遷移零痛（舊全域值＝裝置層預設）；**標題列按鈕風格** `TitlebarControls.style`（flat/rounded/mac 交通燈/compact，隨身分層走）＋設定即時預覽 | 已接受 |
| [0168](./0168-mobile-parity-batch-1-presence.md) | **行動端功能對齊批次一**（引擎已就緒、只差 UI）：**自訂狀態文字**（`setStatus(status,msg)` 接上＋設定頁輸入）、**正在聽**（`setNowPlaying`＋對話副標題 ♪ 優先）、**上線狀態本機還原**（移植 `presence.ts`＝桌面 ADR-0164 同契約，`initialStatus` 塞進後端建構→首次心跳即正確、不洩漏舊狀態）、**敲一下收到即震動**（`navigator.vibrate`，不支援則靜默）；全純本機／依身分，中繼鐵則不動；輸入中提示、限時訊息、移除聯絡人等留待後續批次 | 已接受 |
| [0169](./0169-mobile-parity-batch-2-conversation.md) | **行動端功能對齊批次二**（對話／聯絡人層）：**輸入中提示**（送＝`onChangeText` 每 3 秒節流 `sendTyping`；收＝`onTyping` 6 秒易失、對話副標最優先顯示）、**限時訊息**（燒毀鈕循環 關/1m/1h/1d，`onSend` 帶 `ttlSeconds`→`sendMessage`，1:1 才有、群組扇出不帶 ttl）、**移除聯絡人**（長按「移除／封鎖」並排，`window.confirm` 後 `removeContact`＝清對話但不封鎖）、**連線狀態細條**（`onConnection`→非 online 顯示琥珀/紅細條，僅真實 relay）；SSR testID 斷言條件渲染 | 已接受 |
| [0199](./0199-unlock-hidden-entry-gating.md) | **「解鎖隱藏身分」🔒 入口收斂**：原本桌面永遠顯示（`isTauri()`），沒設過密碼的人點了只得「密碼不符」＝困惑。改閘在 `shouldOfferUnlockHidden`＝「本機有任一**已啟用密碼**的身分」（純函式、單測）。**刻意不**閘在「有隱藏身分」——否則 🔒 出現本身就洩漏「這裡藏了帳號」、反噬 ADR-0067 否認性；「有密碼」≠「有隱藏」故不可區分＝保住否認性。三方平衡（乾淨 UI／否認性／可發現性）| 已接受 |
| [0198](./0198-desktop-close-dialog-in-app.md) | **桌面關閉確認改用 app 風格對話框**（取代原生 rfd）：ADR-0197 的 `rfd` YesNo 是 OS 原生視窗，與無邊框自訂 UI 格格不入且無法本地化。改為 `CloseRequested`→`prevent_close`＋**`emit("app://close-requested")`** 交回前端，`App.tsx` `listen`→既有 `useDialog().confirm`（ADR-0139）彈 app 風格框；確認＝新命令 `quit_app`（`exit(0)`）、取消＝`hide_to_tray`（`hide()`）。新增 i18n `close_title/message/quit/tray`（中英）。移除 `rfd::MessageDialog`（`FileDialog` 仍用）。typecheck＋cargo check＋406 測試綠 | 已接受 |
| [0197](./0197-desktop-lifecycle-single-instance-tray-cache.md) | **桌面生命週期：單一實體＋關閉提示＋版本更新清快取**（修「更新後仍見舊前端」）：根因＝Tauri 編譯期把前端嵌進 exe，純前端改動不重編譯→留舊前端（清 WebView2 快取無效）。三項 Rust 改動（`tauri-plugin-single-instance` 第二次啟動聚焦既有窗；`CloseRequested`→縮 tray＋rfd YesNo 問是否直接結束；`main()` 於建 webview 前比對版本清 `EBWebView\Default\{Cache,Code Cache}`＝保留 Local Storage）**強制重編譯→重嵌新前端**（治本）＋快取雙保險。cargo check 綠 | 已接受 |
| [0196](./0196-flame-icon-redesign.md) | **圖示改火焰造型並同步桌面＋官網 favicon**：三層同心圓餘燼→**尖端向上的火焰**（外焰暖色漸層 `#e8531a→#ffab3d`＋亮內焰 `#ffd66b`，深藍圓角底）；桌面 `tauri icon` 由火焰來源（`icons/cinderous-ember.svg`）重生整套、官網 `index.html` favicon 同步為火焰 path（純色版）。行動端無 favicon、hero `CinderMark` 不在範圍。需重建＋重發 v0.0.1；website build 綠 | 已接受 |
| [0195](./0195-signin-relay-button-and-app-icon.md) | **登入 relay 切換改明確按鈕＋桌面圖示改真標誌**：relay 展開入口從右下角低調 📡 改為收合狀態列旁的明確「使用其他中繼站」文字鈕（`relay-change` testid 保留；預設仍不必填＝自動選座錨點）；桌面圖示以官網餘燼意象（深藍圓角＋暖橙/琥珀/亮黃三層，`icons/cinderous-ember.svg`）經 `tauri icon` 生成整套取代藍色佔位圖。需重建＋重發 v0.0.1；desktop 406 綠 | 已接受 |
| [0194](./0194-remove-demo-mode-hints.md) | **移除登入的「示範模式」提示文字**（未填 relay ＝自動選座預設錨點）：`ANCHOR_RELAYS` 已就緒後「留空＝示範模式」已誤導——中性化 `signIn_relayUrl`（去掉「留空使用示範模式」）、`signIn_relayDemo`/`settings_relayDemo`/`mobileSettings_relayDemo`（→「尚未連線中繼站/未設定中繼站」）；`SignIn` 的 `probing` 初值 seed（有錨點且無預設 relay 即 true）消除首個 render 閃「示範模式」。demo 後端保留但不再宣傳；未動 relay＝用預設錨點（ADR-0069）。desktop 406＋i18n 綠 | 已接受 |
| [0193](./0193-bilingual-outward-docs.md) | **對外說明文件中英雙語**：每份對外文件 `X.md` 增 `X.en.md`＋頂端語言切換 header（中↔英互指）；英文版互連指向對方 `.en.md`。納入 10 份（README、CONTRIBUTING、SECURITY、SELF-HOSTING、NODE-SUBMISSION、MAINTAINER-ACTIVATION、三份 self-hosting、User-Guide）；內部文件（PRD/ARCHITECTURE/ADR/ROADMAP/dev guide）維持單一中文。翻譯保留 code/路徑/NIP/ADR/連結、術語統一；斷鏈驗證全過 | 已接受 |
| [0192](./0192-website-fonts-multinode-selfhosting.md) | **官網字型統一＋多節點協作圖＋自架文件單一入口**：英文一律 **Manrope**（自架 woff2、Vite 指紋化、**不走 CDN** 以維持零第三方宣稱），中文走 `Noto Sans TC→PingFang TC→Microsoft JhengHei` 堆疊，單一 `--font` 套全站＋強制表單元素繼承；技術頁新增 `MultiNodeDiagram`（原創主題色 SVG：任一節點離線自動改走其他、簽章清單自動選座、P2P 直連）；新增 `docs/SELF-HOSTING.md` 單一入口比較四種 relay 部署＋web app 並連向詳細文件，`node_docs` 改指它。typecheck/build/test 綠、字型 base-aware 進 dist | 已接受 |
| [0191](./0191-rename-cinderous.md) | **專案更名 Cinder→Cinderous（含 npm scope）＋錨點子網域 whoami885→cinderous1**：`@cinder/*`→`@cinderous/*`（9 套件＋全 import＋workflow filter＋lockfile 重產）、產品顯示名大寫 `Cinder`→`Cinderous`、relay 子網域＋`GITHUB_URL`＋Pages `base /Cinderous/`＋git remote。**刻意保留**小寫內部識別字（keyring `app.cinder.desktop`／bundle id／Rust crate `cinder-desktop`／worker `cinder-relay`）避免金鑰失聯/身分變動。ADR 0001–0190 歷史不動；BMC 帳號 whoami885 修回。typecheck 9/9＋1341 測試全綠。**舊 whoami885 relay 已死→客戶端需重建** | 已接受 |
| [0190](./0190-relay-list-publish-auth-fix.md) | **修簽章清單帶內發佈的 NIP-42 AUTH 缺口**：首次實跑發現簽章清單（kind 10037）發佈全失敗（`⚠`）——因 relay `requireAuth`，`relay-core` 對 **EVENT 亦要求先 AUTH**，但 `health-check.ts` 的 `publishEvent` 直接送 EVENT 未認證 → 被回 `OK false`（探測 `conformance.ts` 早有 AUTH、發佈這支漏了）。改為**重用** `conformance.ts` 匯出的 `withWs`/`autoAuth`/`parse`，先臨時鑰 NIP-42 AUTH 再發佈（公共站不限事件作者）；契約已由 `relay-core.test.ts` 覆蓋，I/O 以真實 workflow 重跑驗證。typecheck＋88 測試綠 | 已接受 |
| [0189](./0189-second-anchor-relay.md) | **第二座錨點 relay＋簽章池收錄**：部署第二座 Cloudflare Worker relay 於**獨立帳號**（隔離帳號層故障、不重用 `whoami885`；預設 email 推導子網域已改中性 `jt0856` 後才對外）；`ANCHOR_RELAYS` 加入 `wss://cinder-relay.jt0856.workers.dev`→ 錨點 2 座（ADR-0039 最低韌性）；`relays.json` 收錄兩座為候選（每小時探測＋分級＋簽章發佈）。殘留：兩座皆 CF（全域故障仍同倒，第三座宜換平台）、中性子網域降低但未全消關聯；生效需設 `MAINTAINER_NSEC`＋重建客戶端 | 已接受 |
| [0188](./0188-maintainer-trust-root-activation.md) | **啟用維護者信任根**（填入 `MAINTAINER_PUBKEY`）：把休眠的簽章 relay 池（ADR-0039/0092）轉為運作——`bootstrap-config.ts` 填入**專用**維護者公鑰（`genkey:maintainer` 本機產、nsec 只落地＋離線備份、絕不進 code）；客戶端重建後訂閱 `kind 10037`＋`verifyRelayList` 驗簽採用。**非破壞**：relays.json 仍空/secret 未設時退回 `ANCHOR_RELAYS`。信任根風險＋輪替需重建客戶端，防護見 `MAINTAINER-ACTIVATION.md`。待辦：設 `MAINTAINER_NSEC` secret→收錄首座→重建客戶端→驗證 | 已接受 |
| [0187](./0187-website-vision-first-ia.md) | **官網資訊架構改版（願景優先）**：首頁改闡述**核心價值觀＋「取回通訊自主權」願景**（hero `eyebrow`＋願景段 `vision_*`＋核心價值四卡 `val_*` 以「對你的意義」框架）；新增 **技術原理頁** `pages/Tech.tsx`（`nav_tech`，吸收訊息傳遞圖＋四大技術支柱 `feat_*`＋協定基線卡 `tech_proto_*`：NIP-17/44/59/42/13＋WebRTC P2P）；**下載直連 `GITHUB_URL/releases`**（移除站內 `Download.tsx` 與 `download_*`，`View` `home\|download\|node`→`home\|tech\|node`）。沿用既有設計系統零新增 CSS；typecheck/build/test 6/6 綠 | 已接受 |
| [0186](./0186-website-project-page.md) | **官網改採 GitHub 專案頁 `/Cinder/`**（修訂 0185 位置選擇）：專案頁「每 repo 一個」＝不占帳號唯一 user-page 名額、不必改主 repo 名，符合「在專案下開、不要在根」；`vite.config` 設 `base: "/Cinder/"`，`Transparency.tsx` 的 `fetch("/funds.json")`→base-aware `import.meta.env.BASE_URL + "funds.json"`（尾斜線＝根站/專案頁/自訂網域三者皆正確，一勞永逸）；全站掃描僅此一處執行期絕對路徑會壞，其餘（index.html src、SVG `url(#id)`、外部 href、client-side 導覽）皆安全。build asset 前綴 `/Cinder/`＋website 6/6 綠 | 已接受 |
| [0185](./0185-website-github-pages-deploy.md) | **官網以 GitHub Pages 部署**（GitHub Actions＋根站）：新增 `.github/workflows/pages.yml`——push main 動到 `apps/website/**` 或其相依（i18n/theme/core）即 `pnpm --filter @cinder/website build`→`upload-pages-artifact`→`deploy-pages`（pnpm/Node 鏡像 ci.yml、**不加 pnpm version**、concurrency 防重疊）；站為純靜態＋**無 URL 路由**（`useState<View>`）＝無 SPA fallback 坑；採**根站**（base `/` 與 `fetch("/funds.json")` 零改動，需 repo 命名為 `<user>.github.io` 或自訂網域）；修 `GITHUB_URL` `Nostr-buddy`→`Cinder`。Pages Source＝Actions 為人工前置；專案頁 `/<repo>/` 走法（base＋fetch 兩改）已於註解標明 | 已接受 |
| [0184](./0184-mobile-aux-panel-review-fixes.md) | **行動端輔助面板審查修正**：**`auxImages`/`auxThreads` 改 `useMemo([messages])`**（原每次打字都重算整份訊息）；**行動端便條文案不再承諾算式**（新增 `note_placeholderM`/`note_hintM`，計算在輸入框、便條只筆記——與 ADR-0183 意圖一致）；便條分頁設閘改 `onNoteLoad && onNoteSave`；更正誤導註解；清桌面死 CSS（`.daux__calc*`）。加密/隱私/零廣播審查全過、無 CRITICAL。mobile 197＋desktop 406 綠 | 已接受 |
| [0183](./0183-mobile-conversation-aux-panel.md) | **行動端對話輔助面板**（桌面右欄的行動端版）：對話標頭一顆 📋 → 分頁面板（**媒體相簿／對話串／便條**），不搬三欄佈局；`thread-util`（replyCounts 等）上移共用引擎（消除桌面/行動重複，桌面改自 `@cinder/engine` 匯入）；便條每對話一張、**加密落盤**（身分 nsec 導出金鑰 `sealValue`，比桌面明文更嚴）；計算不併入便條（行動端計算已 inline 在輸入框，刻意不同於桌面）。engine 265＋mobile 197＋desktop 406 綠 | 已接受 |
| [0182](./0182-deck-right-note-tab.md) | **右欄「計算」分頁改為「便條」**：`CalcPanel`→`NotePanel`——每對話一張私人便條（`note-store.ts`，`nb.note.<id>`，純本機不上雲，多行 textarea）；**計算是其中一個功能**（ADR-0097 保留：便條最後一非空行若是算式即時算出、可插回對話）；`AuxTab "calc"→"note"`，移除無引用的 calc-only i18n 鍵。desktop 411 綠 | 已接受 |
| [0181](./0181-mobile-enterprise-residual-cleanup.md) | **行動端企業模式殘留清理**（ADR-0180 列的 3 項）：**儲存槽佇列 UI**（設定頁狀態/移除/重試）＋`completeSlot` done 時**釋放位元組**（記憶體不累積）；**企業成員鎖公司座**（`createRelayChat` 對 `org.enterprise` 不帶 `anchors`/`connectorFor`——鏡像桌面，不漫遊不外洩心跳；owner/個人照舊漫遊）；**接管/刪除二次確認**（`confirmAction`，刪除明講不可逆）。mobile 192 綠 | 已接受 |
| [0180](./0180-mobile-enterprise-review-fixes.md) | **行動端企業模式審查修正**（3 高）：**離職接管上線洩漏**（`start()` 首拍 beat 早於 setInvisible→引擎加 `initialInvisible` 建構即隱身，`takeoverOffboarded` 以 `forceInvisible` seed）；**配對企業身分連錯座**（idRelay 鏈漏 `bundle.relayUrl`＋prof stale→抽 `resolveIdRelay` 純函式補回優先序）；**隱身跨身分殘留**（`signInWith` 統一 `setInvisible(!!forceInvisible)`）；signInWith 位置參數重構為選項物件。engine 260＋mobile 190＋desktop 408 綠 | 已接受 |
| [0179](./0179-mobile-offboarding-takeover.md) | **行動端離職接管（企業主端，加密託管）＋儲存槽收檔桌面限定提示**：`org-escrow.ts` 託管清單以企業主 nsec 導出金鑰 `sealValue` **加密落盤**（`c1:` 密文、不含明文 nsec，比桌面明文更嚴，ADR-0112 不破）；`onOrgEscrow` 加密 upsert；離職＝託管中但不在名冊在世成員→名冊畫面「離職帳號接管」區：**接管查看**（以託管 nsec 登入指向公司座＋立即隱身查看歷史，`signInWith` overrideRelay）／**刪除託管**；企業主收儲存槽落盤**不做**（原生 FS）但手機介面明確文字提示。**A~D 全落地** | 已接受 |
| [0178](./0178-mobile-enterprise-owner-management.md) | **行動端企業模式・階段 D v1（企業主管理）**：`PairBundleOrg.orgInviteToken` 跨端流通（核准權杖持久/搬家）；`createCompany` 生成 `orgOwner`＋權杖身分（`signInWith` overrideOrg）→ 新 `RosterAdminScreen`（組織名/成員/歡迎詞/工時/保留天數/**邀請碼複製＋託管勾選**，`publishRoster` 契約鏡像桌面）；設定頁「組織名冊」入口（企業主限定）。**一家公司可全在手機組起**；離職接管（onOrgEscrow 持久＝紅線敏感）與群組/進階政策留 v2，收儲存槽落盤留桌面 | 已接受 |
| [0177](./0177-mobile-company-vault-deposit.md) | **行動端企業模式・階段 C（公司儲存槽員工端）**：桌面靠 `savedPath` 重讀原檔（限 Tauri），行動端 web 無持久路徑→新增 `slot-queue.ts` 佇列**直接持有位元組**（v1 session 內）；對話 🗄 鈕（企業成員限定）主動挑檔入佇列，`origin`＝對話名；背景效果＝企業主在線且有 pending→`depositFile` P2P 直送（不需讀檔）。**員工端完全獨立**（消費＋入職＋存槽齊備）；企業主接收/落盤仍桌面（原生 FS）；durable/佇列 UI 後續 | 已接受 |
| [0176](./0176-mobile-enterprise-invite-join.md) | **行動端企業模式・階段 B（邀請碼入職）**：`NsecSignInScreen` 顯示名稱欄貼邀請碼→「加入組織」面板（公司座 host＋escrow 明示同意）→ `joinOrg` **生成全新企業成員身分**（`inviteToOrg`）；`backend.ts` 放開 ADR-0173 唯讀＝轉發 `orgJoinToken`/`orgEscrow`（冪等，開機自動入職＋公司帳號託管）；`signInWith` per-identity relay 鎖公司座；有密碼＝`rememberInProfile(org)` 跨重啟持久。**員工端完全獨立** | 已接受 |
| [0175](./0175-mobile-enterprise-consumer-completion.md) | **行動端企業模式・階段 A（消費端補完）**：保留天數已由引擎內部套用（傳 orgAdminPubkey 即免費）；**下班自動靜音**（`shouldMuteOrgNotification` 上移共用引擎消除桌面/行動重複，桌面再匯出保持 import 不變；行動端 `onOrgInfo` 存工時+成員、`onMessage` 通知閘門加靜音判定）；**歡迎詞**變更時顯示一次。路線圖 A~D 的 A，接續 B 邀請碼入職 | 已接受 |
| [0174](./0174-mobile-enterprise-identity-persist.md) | **行動端配對企業身分跨重啟持久**：配對匯入可「記住此裝置」（`PairImportScreen` 加本地密碼欄，留空＝暫時 session）；`rememberInProfile` 把 org 精華寫進登錄 Profile（enterprise/orgOwner/adminPubkey/…）；`signInWith` 的企業精華改取 `bundle?.org ?? profileOrg(登錄 Profile)`＝重啟解鎖即以企業身分啟動（連公司座/採用名冊/頭銜設閘）。打通「桌面建立→配對帶來→後端運作→跨重啟持久」；nsec 仍只 Argon2id 包裹（ADR-0112 不變）；仍唯讀 | 已接受 |
| [0173](./0173-mobile-enterprise-backend-roster.md) | **行動端企業身分後端接線**（唯讀採用公司名冊）：`MobileBackendOptions.org` 透傳給 `createRelayChat`＝鏡像桌面——`org.adminPubkey`→`orgAdminPubkey`（後端訂閱並採用管理者名冊：同事自動進通訊錄＋allowlist＋政策＋組織資訊）、`org.orgOwner`→`orgOwner`；**只讀不寫**（不帶 orgJoinToken/orgEscrow，不從行動端重觸發入職/託管）；`onOrgInfo`→`selfEnterprise=true`（實際名冊採用確認會員身分，設閘雙來源）。durable 化與寫入流程留待下一批 | 已接受 |
| [0172](./0172-enterprise-identity-via-pairing.md) | **企業身分經配對搬家帶到行動端**（審查 #6）：`PairBundle.org`（enterprise/orgOwner/adminPubkey/orgJoinToken/orgEscrow，向後相容＋雙向淨化）讓工作身分從桌面搬到手機時保留企業脈絡；桌面 `runPairSource` 帶上作用中 profile 的 org；行動端以執行期 `selfEnterprise`（取自 `bundle.org`）設閘頭銜編輯器＝**企業/企業主身分才顯示**（與桌面一致），解掉 ADR-0170 遺留；後端連公司座/抓名冊與登錄持久化留待下一批 | 已接受 |
| [0171](./0171-status-message-broadcast-coalescing.md) | **自訂狀態文字廣播節流**（審查 #5）：引擎 `setStatus` 同步廣播是**刻意契約**（ADR-0129 catch-up＋測試依賴，不改）；改在 UI 層合併——`changeStatusMessage` 本機狀態/持久化即時、`setStatus` 廣播走 ~600ms debounce（停手才送目前文字一次、不外送半成品）；離散狀態變更仍立即並清待送文字計時器；卸載/登入/登出清計時器。桌面仍逐字（後續比照） | 已接受 |
| [0170](./0170-mobile-parity-batch-3-groups-title.md) | **行動端功能對齊批次三**（群組／頭銜）：**新增群組成員**（成員面板「＋新增成員」列出尚非成員的聯絡人逐一加入，僅管理者＋後端支援時顯示；群組無共用金鑰＝免 rekey）、**企業自報頭銜 chip**（`Contact.title` 於聯絡人列與 1:1 標頭以實心主色 chip 顯示、群組不顯示；設定頁草稿＋「更新」鈕呼叫 `setSelfTitle` 全量重播個人檔）；頭銜編輯暫未依企業身分設閘（行動端尚無該旗標，對所有真實 relay 身分顯示、預設空、Hint 說明會廣播）；SSR 斷言 chip 條件渲染 | 已接受 |
