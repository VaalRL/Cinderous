# Cinder 長期施工計畫（ROADMAP）

> 本文件是「還有哪些要蓋、依什麼順序蓋」的單一入口。里程碑定義見 `ARCHITECTURE.md §7`，決策理由見 `docs/adr/`，產品規格見 `PRD.md`。功能實作前先立/查對應 ADR。

## 圖例

- 狀態：✅ 完成且測試 ｜ 🔧 進行中 ｜ 📋 規劃 ｜ ⏳ 待執行期環境
- 環境：🌐 可在瀏覽器/CI 驗證 ｜ 🖥️ 需 Tauri 工具鏈（`webkit2gtk`/`tauri-cli`）｜ ☁️ 需 Cloudflare 帳號 ｜ 📱 需 React Native 工具鏈

---

## 0. 現況快照

> **產品名：Cinder**（slogan「Life is short, connect buddies.」；npm scope `@cinder/*`）。測試現況：**core 193 / relay 52 / desktop 250 / i18n 6，全綠**。

- **共用協定/邏輯層（`packages/core`、`relay`）**：secp256k1 身分 → NIP-01 事件/簽章 → NIP-44 加密 → NIP-17/59 Gift Wrap → 心跳/輸入中/音樂 → 群組成對扇出 → WebRTC 信令/資料通道/降級 → QR 配對/競速/多設備收斂 → RelayClient → **節流外送匣 Outbox / 有界去重 BoundedSet** → 防濫用(PoW/訂閱上限/**企業 allowlist**)/時鐘·重放防護 → **@提及（p-tag）/對話串（reply e-tag）**。✅
- **桌面前端（`apps/desktop`）**：登入、聯絡人清單、對話視窗、表情、Markdown、Nudge、輸入中、深色/明亮、多語系；**Phase A 產品化完成**——接真實 relay（含自動重連/連線狀態）、本機持久化、聯絡人管理（刪除/封鎖）、設定面板（身分備份/通知）、未讀徽章、音樂狀態、**WebRTC P2P 檔案傳輸**。示範模式（記憶體 relay + 機器人）仍保留供體驗。✅
- **Demo**：`demo.html`、`webrtc.html`（真實 WebRTC）、主應用 `/`，皆 Playwright 驗證。✅
- **進階功能（Phase E，M6–M9）**：✅ 訊息回應/收回/限時、語音訊息/相簿/貼圖（含動態/自製/編輯器/觸發字）、語音視訊通話（含**來電鈴聲**）、QR 加好友、群組聊天、群組本地標籤、**@提及 Mention**、**對話串 Thread（Slack 式右側面板）**。
- **安全與規模化（Phase F）+ 審查修正**：✅ 前向保密決策、二進位框架、混合式引導路由、跨中繼互通、網址衛生；**審查規模化修正**（啟動回放批次化、訊息列視窗化、去重集合有界、孤兒清理、每對話上限）。
- **企業模式（Phase G，G0–G4 完成）**：✅ 封閉 allowlist 中繼、單一 App 多身分並存與切換（工作/個人、鎖定/開放、資料命名空間隔離）；✅ 簽章名冊佈建＋企業通訊錄（G1）、政策開關＋**強制 TURN 接入 WebRTC**（G2）、組織群組／公告（G3）、**工作身分輪替（G4，否決金鑰托管、無後門，ADR-0052）**。餘 G5 SSO/元資料稽核。
- **治理**：pnpm monorepo、TS strict、TDD、CI、**72 份 ADR**、AGPL-3.0。✅
- **本階段新增（額外需求，皆測試綠）**：✅ 跨身分互加防呆（ADR-0055）；**relay 生產部署上線**（免費層 SQLite DO）＋**WebSocket 休眠化＋心跳 30s**（降免費層 duration，ADR-0059）；**樹莓派自架 node-relay**（＋說明文件）；**送達/已讀回條**（Gift Wrap，已讀 opt-in＋互惠，ADR-0058）；**MSN 風 UI**（依上線狀態排序/彩色狀態選單/頂部漸層/大頭貼光暈）＋**分享 ID 縮短+複製**＋**長訊息右側詳情面板**；**本機 Ollama AI 改寫＋未讀摘要**（Rust IPC、localhost 硬守則、prompt injection 緩解，ADR-0060）；**顯示名稱加密個人檔**（只送聯絡人、非公開 kind 0，ADR-0061）。

**缺口總覽**：Tauri **程式碼簽章/自動更新**（B6；需憑證——安裝檔＋系統匣背景＋加密儲存＋金鑰庫皆已 Windows 實機完成）、行動端（Phase D）、企業 G5（SSO/元資料稽核）、通話 TURN 保底真機驗證、F4 第三方稽核。**relay 離線留言/AUTH 已完成並上線**（C1–C3 ✅，C4 容量校準待真實流量）。

---

## Phase A — 讓現有前端「真的能用」（大多 🌐 可在此驗證）

先把 UX 外殼從「接模擬後端」推進到「接真實通訊 + 會記住東西」。

| # | 任務 | 環境 | 說明 / 驗證 |
| --- | --- | --- | --- |
| A1 | 前端接真實 relay | 🌐 | ✅ **完成**：`RelayChatBackend` + `webSocketConnector` 連真 relay；`relay/src/dev-server.ts` 本機真實 WebSocket relay；以 npub 加好友。Playwright 兩 context 經真實 relay 對話已驗證。 |
| A2 | 本機持久化（前端層） | 🌐 | ✅ **完成**：`AppStorage`(localStorage) 存身分/聯絡人/訊息；重整自動登入、身分不再每次重生、歷史保留。Playwright 重整驗證通過。（Tauri 版再換 SQLite/SQLCipher。） |
| A3 | 聯絡人管理 UI | 🌐 | 🔧 新增（✅ A1）、**刪除／封鎖／解除封鎖**（✅ 本機持久化＋忽略被封鎖者訊息，經真實 relay 驗證，ADR-0014）；**QR 加好友**（`npub` 交換 + 雙向同意）待相機/行動端（M9／Phase D）。 |
| A4 | 檔案傳輸 UI | 🌐 | ✅ **完成**：`WebRtcTransfer` 每聯絡人一條 P2P 連線，複用 core signaling/datachannel；附件鈕 + 拖放、傳送進度、接收下載。經真實 relay + 真實 WebRTC 兩 context E2E 驗證（50KB 檔案位元組一致，ADR-0017）。 |
| A5 | 設定與狀態 UI | 🌐 | ✅ **完成**：設定面板（中繼站、身分備份 nsec + 警語、桌面通知）、未讀徽章、音樂狀態輸入口、**連線/重連中狀態**（`webSocketConnector` 指數退避自動重連 + 狀態回報，重連後自動重訂閱）。皆經真實 relay 驗證（ADR-0015、ADR-0016）。 |
| A6 | 前端技術債收斂 | 🌐 | ✅ 移除孤立的 `presence-store.ts`／`relay-source.ts`（已由 `RelayChatBackend` + core `PresenceTracker` 取代）；對話視窗 `×` 關閉鈕已可用，無殘留裝飾按鈕。 |

**Phase A 完成定義**：桌面前端能連真實 relay、重整不失資料、可自行管理好友並傳檔——不再是純 demo。

> ✅ **Phase A 已完成**（A1 真實 relay、A2 持久化、A3 聯絡人管理、A4 檔案傳輸、A5 設定與狀態、A6 技術債），皆經真實 relay／WebRTC E2E 驗證。剩餘 QR 加好友（相機掃描）併入 M9／Phase D。下一步進 Phase B（Tauri 殼，需環境）或 Phase E 進階功能（M7+ 核心）。

---

## Phase B — Tauri 桌面殼落地（🖥️ 需 Tauri 環境）

把前端裝進原生殼，補上背景與安全能力。對應 `ARCHITECTURE §7` M1–M5 的 ⏳ 部分。

| # | 任務 | 說明 |
| --- | --- | --- |
| B1 | Tauri 二進位 | ✅ **可建可跑（Windows 實機驗證）**：`src-tauri` 殼（`main.rs`、`tauri.conf.json`、capabilities、圖示組含 `icon.ico`）＋ Tauri CLI 與 `tauri:dev`/`tauri:build` 腳本（內建 `-f tauri-app`）。`cargo build --features tauri-app` 乾淨產出 `cinder-desktop.exe`；`tauri:dev` 開原生視窗、載入前端、登入實機通過（ADR-0018）。⏳ `tauri build` 安裝檔打包＝B6。 |
| B2 | IPC 契約 / `TauriChatBackend` | 🔧 **契約已定**：`ipc.rs` 的 serde DTO 與前端 `types.ts` 對齊並測試；近期 webview 直接跑既有前端（UI 不改）。原生服務接管時再補 `TauriChatBackend`。 |
| B3 | Rust 背景長連線 | ✅ **核心+執行期完成**：`session::Session` 政策驅動器（訂閱集、離線佇列、退避、重連即重送訂閱，7 單元測試）＋ `net::run`（tokio + tokio-tungstenite，`net` feature）。以本機 WS 伺服器即時整合測試驗證「連上→送訂閱→收事件→外送」。視窗關閉仍在線（連線由背景 task 持有）。GUI 整合待 Tauri 環境（ADR-0019）。 |
| B4 | 原生持久化 | ✅ **完成**：`storage::Store`（rusqlite）schema 對齊前端 `AppStorage`（身分/聯絡人/訊息/回應/收回/封鎖），`PRAGMA key` 支援 SQLCipher。`persistence`（bundled SQLite）9 測試；`sqlcipher`（bundled-sqlcipher + vendored OpenSSL）實際加密驗證，含「錯誤金鑰無法開啟」。GUI 接線待 Tauri 環境（ADR-0020）。 |
| B5 | OS 金鑰儲存 | ✅ **完成（ADR-0053，Windows 實機驗證）**：`keyvault`（`keyring` crate）+ `key_set/get/delete` IPC；前端 KeyVault（Tauri→OS 金鑰庫、瀏覽器→localStorage 後備）+ 開機 async 載入 + 首次遷移。私鑰入 Credential Manager（`<pubkey>.app.cinder.desktop`）、明文不落 localStorage、重載自金鑰庫自動登入——皆實機確認。瀏覽器路徑零回歸（218 測試綠）。 |
| B6 | 打包/更新 | 🔧 **安裝檔＋系統匣背景完成（Windows 實機）**：`tauri:build` 產出 NSIS `.exe`（1.9MB）＋ MSI（2.8MB）（`bundle.icon` 含 `.ico`）；**系統匣＋關閉最小化到背景**（關窗＝隱藏、webview 存活＝引擎續連在線；匣選單顯示/結束）。⏳ **程式碼簽章＋自動更新**（未簽章＝SmartScreen 警告）——需憑證／updater 金鑰＋更新端點，步驟見 `OPERATOR-TODO §B-Tauri`。 |

**完成定義**：可安裝的桌面 App，背景在線、資料與私鑰安全落地。

---

## Phase C — Relay 生產部署（☁️ 需 Cloudflare 帳號）

對應 M2 relay 的 ⏳ 部分與數個 review 待辦。

| # | 任務 | 說明 |
| --- | --- | --- |
| C1 | 離線留言持久化 | ✅ **核心完成（ADR-0056）**：改用 **DO 內建 SQLite**（同步，免 D1 async 摩擦、免額外 binding）。`OfflineStore` 介面＋`SqlMessageStore`（NIP-40 過期/每收件人 cap/`#p` 索引/matchFilter，以 `node:sqlite` headless 測 6 項）＋`RelayRoom` DO 接線。⏳ 使用者 `wrangler deploy` 後驗離線收送。 |
| C2 | NIP-40 排程 prune | ✅ **完成**：`RelayRoom` DO 每小時 `alarm()` → `store.prune()` 清過期留言並重排（DO 休眠仍被喚醒）；建構時若無 alarm 即排程。`prune` 邏輯已測（C1）；alarm 觸發為執行期，`wrangler deploy` 後生效。 |
| C3 | NIP-42 AUTH | ✅ **完成（ADR-0057）**：`RelayCore.requireAuth`（連線挑戰、驗 kind 22242、發布/讀取閘門、`#p` 收件匣只准本人）＋ `RelayClient` 自動回應挑戰（`authSigner`）＋認證後重掛訂閱（`onAuthenticated`，解「訂閱早於認證」）＋後端接線＋**worker 啟用**。core/relay/desktop 共 14+ 測試（含 requireAuth 下兩端仍能對話）。⏳ 真線上驗（`wrangler deploy` 後）。 |
| C4 | 部署與容量校準 | 🔧 **已部署上線**（`cinder-relay.…workers.dev`，含 C1–C3、ADR-0065 TTL 上限、ADR-0071 快照 kind；最近部署 2026-07-10）＋**WebSocket 休眠化降 duration**＋免費層量級模型（ADR-0059）。⏳ 待真實流量實測請求數校準、回填 `docs/adr/0006`。 |

**完成定義**：公開可用的中繼站，離線留言真正持久化並自動過期。

---

## Phase D — 行動端（📱 需 React Native 工具鏈）

對應 M5 行動端的 ⏳ 部分。**大量重用** `packages/core` 與 `packages/i18n`。

| # | 任務 | 說明 |
| --- | --- | --- |
| D1 | RN App 骨架 | 🔧 **起手完成（此環境）**：`apps/mobile`（react-native-web + 重用 `@cinder/core`/`@cinder/i18n`）；首個 `ContactListScreen`（依上線狀態分區、npub 編碼、多語系），typecheck + 測試綠。⏳ 更多畫面移植（登入/對話）、Expo/Metro 原生打包（需工具鏈或 EAS）。 |
| D2 | 行動持久化 | RN SQLite + Keystore/Secure Enclave。 |
| D3 | 無聲推播喚醒 | Worker 存 APNs/FCM 憑證，Silent Push 喚醒背景拉取（PRD §3）。 |
| D4a | **桌面配對克隆** | ✅ **完成（ADR-0072）**：core 協定（HELLO/CHALLENGE/BUNDLE/DONE/REJECT＋SAS 四位短碼）、`roomKeyFrom` 拋棄式信令會合（kind 21003、AEAD 密封、NIP-42 以房間金鑰通過）、WebRTC 資料通道長度前綴分塊、捆包＝StorageSnapshot 全量、兩端 UI（舊機 QR/碼/倒數/SAS 確認；新機 SignIn 匯入）。載荷帶會合 relay。⏳ 實機驗證 RTC 直連（`tauri:dev` 兩台/兩實例）。 |
| D4 | 多設備同步接線（行動端＋D4b delta 通道） | 接既有 QR 配對（相機掃描）＋持續對帳邏輯；D4b 即時 delta 另立 ADR。 |

---

## Phase E — 進階功能（借鏡 LINE，M6–M9；核心 🌐 可驗、UI 隨平台）

決策與範疇見 `docs/adr/0010`；一律沿用 NIP-44 + NIP-17/59 隱私機制。每項實作時補細節 ADR。

| 里程碑 | 功能 | 機制 | 環境 |
| --- | --- | --- | --- |
| M6 | 訊息回應 Reaction | ✅ **完成**：NIP-25(kind 7) 指向訊息，Gift Wrap 包封；桌面 UI + 持久化，經真實 relay 驗證（ADR-0011） | 🌐 |
| M6 | 收回訊息 Unsend | ✅ **完成**：NIP-09(kind 5) 指向訊息，Gift Wrap 包封；收件端顯示「訊息已收回」＋持久化，經真實 relay 驗證（ADR-0012） | 🌐 |
| M6 | 限時訊息 | ✅ **完成**：rumor 內帶較短 NIP-40 過期（外層 wrap 同步縮短）；桌面可選限時（1 分/1 時/1 天），到期顯示「訊息已到期」，經真實 relay 驗證（ADR-0013） | 🌐 |
| M7 | 語音訊息 | ✅ **完成**：`MediaRecorder` 錄音 → 複用 A4 的 WebRTC P2P 檔案通道傳送（audio/* mime）；兩端渲染 `<audio>` 播放器。經真實 relay + 真實 WebRTC 驗證（ADR-0022） | 🌐 |
| M7 | 相簿 | ✅ **完成**：`image/*` 檔案內嵌縮圖 + 工具列 🖼️ 相簿格狀檢視（帶張數）+ 燈箱放大；由對話訊息即時衍生，複用 A4 P2P 檔案通道。經真實 relay + WebRTC 驗證（ADR-0023） | 🌐 |
| M7 | 貼圖 Sticker | ✅ **完成**：`nb-sticker:v1:pack/id` 走既有加密訊息通道，客戶端渲染內建原創 SVG 貼圖；選擇器 + 渲染，經真實 relay 驗證（ADR-0021）。持久化/回應/收回/限時自然沿用。**強化**：分頁選擇器（🕘最近使用／⭐我的最愛，本地保存）＋多貼圖包（`buddy`/`mood`/`motion`）＋**動態貼圖**（CSS keyframes 內嵌 SVG，尊重 prefers-reduced-motion，ADR-0031）＋**自製貼圖**（`nb-sticker:v2` 內容隨加密訊息、SVG 統一表示＋拒收制驗證、匯入 SVG/圖片、fork、刪除、**點擊收到的貼圖即收藏**，ADR-0032）＋**貼圖編輯器**（筆劃模型→SVG path、可以現有貼圖為底繪製、undo/redo/清空，桌面優先，ADR-0033）＋**文字觸發貼圖**（⌨ 設定觸發字、composer 尾端比對建議列、Tab/滑鼠送出並剝離文字、不劫持 Enter，ADR-0037；**總覽面板**（改名/刪除/懸空標示）＋**字首索引**（上限 64→256，等價性測試釘住） | 🌐 |
| M8 | 語音/視訊通話 | ✅ **完成**：信令核心 `call.ts`（狀態機 + kind 21002 加密傳輸，ADR-0025）+ 執行期 `WebRtcCall`（RTCPeerConnection + getUserMedia）+ 通話 UI（撥號/來電/通話中、靜音/掛斷、視訊畫面）。假音源 + 真實 relay + 真實 WebRTC E2E：發起→響鈴→接聽→雙向音訊→掛斷（ADR-0026）。**來電鈴聲已完成**：Web Audio 循環雙音鈴響（無外部音檔、離線/CSP 相容），來電中播放、接聽/拒接/結束即停。⏳ TURN 保底（需部署） | 🌐 信令 / ✅ 假裝置 E2E |
| M9 | QR 加好友 | ✅ **產生完成**：`qr.ts` 以 qrcode-generator 將 `npub` 編為 QR，聯絡人清單 `▦` 顯示 QR 模態框供好友掃描；加入沿用 `addContact`（A3）。E2E 以獨立解碼器 jsQR 驗證 QR 還原 npub（ADR-0024）。相機掃描屬行動端 Phase D | 🌐 產生 / 掃描待 📱 |
| M9 | 群組聊天 | ✅ **完成（ADR-0027 方案）**：`group.ts` 成對扇出（kind 14 + `g` tag）+ 控制訊息（建立/加入/移除/離開，kind 40）；後端建群/送訊/離開 + 持久化，UI 群組區、建群 modal、群組視窗（發送者標籤、離開）。3-context 真實 relay E2E：建群→扇出→兩成員收訊並正確歸屬發送者 | 🌐 |
| — | 群組本地標籤 | ✅ **完成（ADR-0040）**：純客戶端個人標籤/置頂，`localStorage` 命名空間、不進協定；標籤過濾列 + 置頂排序 | 🌐 |
| — | **@提及 Mention** | ✅ **完成（ADR-0050）**：訊息帶 `["p", pubkey]` tag 於**加密 rumor 內層**（中繼看不到社交圖譜）+ composer `@` 成員自動完成（Tab/Enter/↑↓/Esc）+ 被提及訊息 mention class／@徽章凸顯 + `mentionsMe` 持久化。core `mention`（parseMentions/mentionTags/isMentioned）+ 後端送收接線 + UI 建議列，皆測試涵蓋。與 reactions/deletions 引用**同源**，企業組織群可點名 | 🌐 |
| — | **對話串 Thread** | ✅ **完成（ADR-0051）**：回覆帶 NIP-10 `["e", rootId, "", "reply"]` 於**加密 rumor 內層**（串結構中繼看不到，比 Slack 更私密）；主頻道排除回覆、根訊息顯示「💬 N 則回覆」入口；點擊於**右側面板**（Slack 佈局）開啟串——根＋回覆＋獨立 composer。扁平串（非巢狀）、扇出/加密不變。core `thread` + 後端送收 `replyTo` + UI 面板，皆測試涵蓋 | 🌐 |

---

## Phase F — 安全與規模化（跨切面）

| # | 任務 | 說明 |
| --- | --- | --- |
| F1 | 群組加密 ADR | ✅ **已定案（ADR-0027）**：v1 Gift-Wrap 成對扇出 + 帶內群組狀態；MLS（NIP-EE/OpenMLS）延後為未來升級（觸發：需 PCS/更大群/稽核後），與 F2 棘輪一併評估。 |
| F2 | 前向保密決策 | ✅ **已定案（ADR-0028）**：維持靜態 ECDH；即時走 WebRTC/DTLS（已具 PFS）；不另立 Double Ratchet，未來若需 FS/PCS 統一採 MLS（與 ADR-0027 同一次工程）。 |
| F3 | 剩餘 review 技術債 | ✅ **完成**：C4 二進位框架（去 base64 ~33%，ADR-0029）＋ A6 ICE candidate 批次（合併單一 `candidates` 信令，減少中繼發佈）＋ A5 多設備 sync 上限（`DeviceSyncState` 訊息/狀態鍵數上限逐出，防撐爆記憶體）。皆單元測試，WebRTC 項經真實 E2E。 |
| F4 | 第三方安全稽核 | 🔧 **前置已備**：`docs/SECURITY.md`（漏洞回報政策 + 加密盤點 + 威脅模型逐項盤點 + 已知限制 + 建議稽核範圍）。獨立稽核本身需外部稽核員（此環境無法執行）。 |
| F5 | 容量/成本 | ✅ **大致完成**：心跳合併（音樂併入心跳、移除 kind 20002）+ jitter + **WebRTC 狀態卸載**（開對話主動建 P2P、輸入中優先走 Data Channel、退回中繼；真實 WebRTC E2E 驗證）；容量模型回填 `docs/adr/0006`。付費層評估為部署階段（C4）。 |
| F7 | 網址衛生 | ✅ **完成（ADR-0038）**：貼上自動清除追蹤參數（`utm_*`/fbclid/gclid… 全域精確名單＋站點範圍規則如 YouTube `si`、Amazon `/ref=`；只刪已註冊名字）＋高風險連結本地啟發式警告（文字偽裝/`@`混淆/punycode/IP 直連=danger；http/非常規 port/短網址=caution；⚠ 徽章＋點擊確認，收發兩端渲染層生效）。**明確否決外部信譽 API**（metadata 洩漏）。純函式測試＋Playwright E2E。**後續完成**：redirect 拆殼（google/url、facebook l.php、youtube/reddit/vk/steam…巢狀遞迴上限 3）＋hash 片段追蹤碼（僅 k=v 形式，SPA 路由與 #:~:text= 不動）＋設定面板「隱私」開關（預設開、持久化）。 |
| F8 | 混合式引導路由 | ✅ **完成（ADR-0039）**：錨點常數（硬編碼 2–3 座保底）＋維護者**簽章** relay 清單（kind 10037，Nostr 帶內傳播為主、GitHub HTTP 後備、驗簽＋防清空＋較新才取代；否決 GitHub 供應鏈為信任根）＋有界冗餘廣播（主路由離線才向健康引導座 K=2）＋**home 自動遞補**（Node1 長期離線自動切健康座、`selfShareUri` 更新、事後通知）。GitHub Actions cron 健康檢查（REQ→EOSE 探測、never-empty 守門、簽章發佈）。core 8＋backend 4 測試（含「Node1 下架後 A→B 零動作經錨點送達」「home 遞補」「偽造清單拒絕」）；探測＋簽章＋驗簽經真實 relay E2E。 |
| F6 | 跨中繼互通 | ✅ **完成（ADR-0034）**：客戶端 Relay Pool——好友 relay hint（`npub…@wss://…`，加好友輸入/分享字串/QR 內容皆支援）、addressed 事件路由到收件人的 relay、心跳全 pool 扇出、收件箱全 pool 訂閱、event id 去重；relay 端零改動、不做聯邦。雙 relay 整合測試（8 項）驗證含不對稱認知場景。**後續完成**：hint 自動學習（帶內加密 hint，ADR-0035，第一則來訊自癒＋回程直達測試）＋設定面板 pool 各座連線狀態（🟢🟡🔴 + home 標記）＋**群訊 rumor 帶 hint**（入群即互學路由）＋**陳舊偵測與離線回退**（連續離線 >5 分鐘標 ⚠ stale；目標座離線時回退 home 雙發、收端去重，ADR-0036）＋**stale 動作 UI**（「保留」重置計時／「清除 hint」改回 home 路由並停止該座重連）。 |

---

## Phase G — 企業模式（自架封閉節點 + 多身分）

> 產品需求 `PRD.md §13`；資料流 `ARCHITECTURE.md §8`；決策 ADR-0044/0045/0046。**相容並不取代開放模式，隱私鐵則不變。**

| # | 任務 | 說明 |
| --- | --- | --- |
| G0 | 封閉 allowlist + 多身分 | ✅ **已完成**：relay 發布 allowlist（`RelayCore.allowedAuthors`，ADR-0044）＋客戶端多身分設定檔/命名空間隔離/切換器/工作身分鎖定單座（ADR-0045）＋文件（PRD §13、ARCH §8、ADR-0046）。 |
| G1 | ① 佈建 + 企業通訊錄 | ✅ **完成（ADR-0047）**：core `org-roster`（簽章名冊 kind 10038、驗簽/採用/allowlist/diff，複用 ADR-0039 機制）＋客戶端工作身分**自動採用名冊**（權威對帳：匯入成員、撤銷離職者）＋**管理者佈建 UI**（🗂 簽章發布名冊、匯出 allowlist）。整合測試涵蓋。**後續**：多管理者/金鑰輪替。 |
| G2 | ④ 政策開關 + ③ 強制 TURN | ✅ **完成（ADR-0048）**：relay `allowedKinds`（協定層硬強制停用檔案/通話＝排除信令 kind）＋名冊分發客戶端政策（`disableFiles/Calls/Stickers/forceTurn`）＋App UI 閘門（隱藏對應鈕）＋管理者佈建工具政策勾選。**`forceTurn` 已接入 WebRTC**：`buildRtcConfig` 依政策設 `iceTransportPolicy:"relay"`（不揭露內網 IP），以動態 provider 於每次建連取當前政策；`turnServers` 由企業佈建（RelayPoolOptions）。實機驗證仍需 TURN 部署（換環境）。 |
| G3 | ② 組織群組 / ⑤ 公告 | ✅ **完成（ADR-0049）**：組織群經簽章名冊 `groups` 分發，客戶端對帳自動入/退群（以 `org` 旗標識別名冊群，不誤刪自建群）；⑤ 公告＝`announce` 群，`canPostToGroup` 於收送兩端強制僅管理者可發、成員 UI 唯讀。管理者佈建工具含群組/公告編輯器。整合＋回歸測試涵蓋。 |
| G4 | 換機/遺失還原：工作身分輪替 | ✅ **完成（ADR-0052，否決金鑰托管）**：換機/遺失＝管理者以簽章名冊把舊 npub 標 `supersededBy`、加入員工自產的新 npub（`applyRosterRotations`＋佈建 UI 輪替欄）；成員端自動 remap（歷史/群成員接續、`onIdentityRotated` 提示），`rosterAllowlist` 排除舊金鑰。**公司全程無解密後門**；「不想丟歷史」＝建議雙設備登記（M4 冗餘），非托管。core＋後端＋端到端測試涵蓋（含**群訊發送者標籤 remap**）。**後續**：Rust store 平價、輪替提示 i18n。 |
| G5 | SSO 整合 / 元資料稽核 | 🔧 **後續**：佈建階段綁 AD/LDAP/OIDC → npub、SSO 守金鑰解鎖；自架 relay 記錄連線**元資料**（不碰內容，E2E 不破）供資安維運。 |

> **明確排除**：法遵歸檔/eDiscovery/DLP/通訊監督——需伺服器讀明文，與 E2E 根本衝突，僅能走獨立「受監督版」，不進預設版。

---

## Phase H — 共用設備安全與 relay 搬家（🌐 可在此環境推進）

> 決策：ADR-0066（home relay 搬家，三階段）、ADR-0067（本地密碼，否決 nsec 日常登入）。
> nsec 定位：主金鑰，僅用於首次匯入／換機／搬家／忘記密碼救援，**不作日常登入**。

| # | 任務 | 環境 | 說明 / 驗證 |
| --- | --- | --- | --- |
| H1 | 個人檔廣播帶 relay hint | 🌐 | ✅ **完成**：`wrapProfile` 增 `relayHint?` 寫入 rumor 內層 `["relay", url]`（加密、外層不可見）；`sendProfileTo` 帶自己的 home。收端零改動（`receiveDm` 已通用 `learnRelayHint`）。測試含「只憑個人檔學 hint」＋三 relay 搬家自癒 E2E（ADR-0066 階段 1）。 |
| H2 | 更換 relay 流程 | 🌐 | ✅ **完成**：設定面板 relay「顯示＋更換」；`changeProfileRelay` 保留 namespace／name／enterprise（不走 addIdentity），`relayChangeTarget` 守門（企業禁用、`wss://` 正規化、同值 no-op），更新 `nb.relayUrl` 後 reload；重載後 H1 廣播自動通知改道（ADR-0066 階段 2）。 |
| H3 | 舊站排水 drain | 🌐 | ✅ **完成**：profile 增 `previousRelayUrl?`＋`drainUntil?`（now＋7 天，對齊 ADR-0065 TTL）；`RelayPoolOptions.drainUrl` 讓舊站進 pool 掛自家收件匣、event-id 去重沿用；到期自動停、設定面板可提前完成。對照組測試證明無排水即漏收（ADR-0066 階段 3）。 |
| H4 | 本地密碼 | 🌐＋🖥️ | 🔧 **核心完成**：Rust `passlock`（Argon2id 19MiB/t2/p1 衍生 KEK＋AES-256-GCM 包裹，6 單元測試）＋IPC `pass_*` 六命令（db 金鑰解鎖後快取原生記憶體）；`UnlockScreen` 開機閘門、閒置 5 分自動上鎖、設定安全區塊（啟用強制備份確認／改密碼＝重包裹／停用／隱藏身分＋🔒 喚回）。⏳ Tauri 實機驗證解鎖全流程（`tauri:dev`）（ADR-0067）。 |
| H5 | 群組快照廣播 | 🌐 | ✅ **完成**：`group-snapshot` 控制型別＋管理員開機 `broadcastGroups()`（每群每日節流）；白紙裝置收快照＝實例化（守門同 create）、既有群僅 admin 可對帳、組織群排除。測試：nsec 換機重建 E2E＋前成員偽造快照防護（ADR-0068）。 |
| H6 | 加密備份碼 | 🌐 | ✅ **完成**：core `backup`（內層 NIP-49 ncryptsec＋外層 `{v, ncryptsec, relayUrl}`、peekBackupRelay 預填）；設定面板產生備份碼（二次密碼→字串＋QR＋複製）；新增身分匯入欄自動判別備份碼＋備份密碼欄（ADR-0070，部分取代 ADR-0015）。 |

**完成定義**：既有身分可無損搬家（聯絡人自動改道、排水期零漏信）；共用設備上各身分可獨立上鎖與隱藏。

---

## Phase I — Relay 自動分配與自動搬家（🌐 可在此環境推進；實效需營運前提）

> 決策：ADR-0069（簽章清單驅動、分級觸發；否決「接近額度即搬」與 relay 端指派）。
> **營運前提**：立起 ≥2 座錨點 relay、填入 `bootstrap-config.ts` 的 `ANCHOR_RELAYS` 與 `MAINTAINER_PUBKEY`——機制可先施工並以測試驗證，實效等錨點上線。

| # | 任務 | 環境 | 說明 / 驗證 |
| --- | --- | --- | --- |
| I1 | 簽章清單 schema 擴充 | 🌐＋☁️ | ✅ **完成**：`RelayListDoc.entries`（accepting/weight/status；舊欄位 relays 保留＝舊客戶端相容、缺欄位全預設）；`listEntries`/`pickWeighted`/`migrationTarget`/`weightedOrder` 純函式；health-check 對 retired 免探測原樣保留、entries 隨簽章發佈。 |
| I2 | 遞補持久化＋T2 durable 搬家 | 🌐 | ✅ **完成**：home 離線起點跨 session 持久化（`nb.homeDownAt`）；逾門檻（預設 24h）且有健康目標 → `onHomeMigrate` → App 走 H2＋H3 排水＋通知＋重載（一次性 latch、遲滯防抖；企業不接）。 |
| I3 | T3 清單退役撤離 | 🌐 | ✅ **完成**：清單標我的 home 為 draining/retired → 隨機延遲（預設 0–6h 防羊群、測試可注入）後撤離；目標＝清單序首個 accepting ok 在線座（決定性防 split-brain）＋錨點保底；`accepting:false` 僅擋新分配。 |
| I4 | SignIn 自動選座 | 🌐 | ✅ **完成**：欄位無預設值時自錨點加權隨機＋WebSocket 探測依序備援預填（可改可清）；`?relay=`>上次記憶>自動選座；無錨點＝行為不變（示範模式保留）。 |

**完成定義**：新帳號免填網址上線；relay 死亡/退役對用戶透明，遷移一次到位不重演。✅ **機制已達成**——實效待錨點營運前提（OPERATOR-TODO §A：填 `ANCHOR_RELAYS`/`MAINTAINER_PUBKEY`、立 ≥2 座）。

---

## Phase J — 加密雲端快照（🌐＋☁️；ADR-0071）

> 三檔模式（關/基本/完整，預設關）、NIP-33 可尋址取代（每裝置一顆）、purge-on-disable、
> 30 天過期＋備份刷新、單顆 256KB／每 pubkey 5 裝置上限。新裝置「備份碼＋密碼→拉快照→秒級還原」。

| # | 任務 | 環境 | 說明 / 驗證 |
| --- | --- | --- | --- |
| J1 | relay 端快照 kind | 🌐＋☁️ | ✅ **完成並上線（2026-07-10）**：`putAddressable`（(kind,pubkey,d) 只留最新、空 content＝purge、單顆 256KB／每 pubkey 5 位址／30 天過期刷新）記憶體版＋DO SQLite 版；RelayCore requireAuth 下快照密文只回作者本人（重放＋即時扇出雙閘門）。生產實測：取代語意、purge 零殘留、他人讀不到皆通過。 |
| J2 | 客戶端快照發佈 | 🌐 | ✅ **完成**：三檔內容組裝（完整＝＋近期訊息上限 500）＋NIP-44 加密給自己＋開機/30 分檢查（內容有變＋每日至多一次節流）＋`publishSnapshotNow`；關閉時 purge。 |
| J3 | 新裝置還原合併 | 🌐 | ✅ **完成**：接收合併恆開（換機還原零前置）——交換律合併（封鎖聯集優先、補缺不覆蓋、訊息 id 去重由舊到新）＋UI 歷史重放＋模式隨快照傳播（本機未設定時採用）。E2E：換機秒級還原；側錄者只見密文。**注意**：封鎖聯集具破壞性——他機的封鎖合併進來時，與本機封鎖行為一致地連該聯絡人的本機歷史一起刪（安全優先，審查記錄 #7）。 |
| J4 | 設定 UI＋政策 | 🌐 | ✅ **完成**：設定面板三檔選擇＋切關確認即 purge＋立即備份＋誠實文案；企業政策 `disableCloudBackup`（名冊採用即停發佈、UI 隱藏）。模式跨裝置 LWW 同步待 D4b delta 通道（快照還原時已帶模式）。 |

**完成定義**：開啟模式下，新裝置憑備份碼＋密碼秒級還原聯絡人/群組/設定（完整模式含近期訊息）；關閉＝雲端零殘留。✅ **已達成**（線上驗證待 `wrangler deploy`）。

---

## 相依與建議順序

```text
Phase A（前端產品化，可在此環境大量推進）
   ├─→ Phase B（Tauri 殼，需 Tauri 環境）───┐
   ├─→ Phase C（relay 部署，需 CF）         ├─→ Phase E（M6–M9 進階功能）
   └─→ Phase D（行動端，需 RN）─────────────┘        └─→ Phase F（安全/規模化，跨切面）
```

- **可立即在此環境推進**：Phase A 全部、Phase E 的「核心邏輯」（M6/M7 資料層、M8 信令、M9 QR）、Phase F 的 F3。
- **需換環境**：Phase B（Tauri）、C（Cloudflare）、D（RN），以及 M8 真實通話 media、M7 媒體 UI。

## 未決策 ADR（開工前需定案）

- **M7 語音訊息離線退回策略**：⏸ **暫緩（2026-07-10 裁示：暫不實作）**。屆時方向已議定——短語音（低碼率、NIP-44 單包 64KB 內）走 Gift Wrap 離線退回、長語音誠實提示 P2P-only；分塊多事件方案傾向否決（吃配額）。
- **G5 SSO / 元資料稽核**：綁 AD/LDAP/OIDC → npub、自架 relay 記錄連線元資料，實作前須立 ADR（並備外部 IdP）。

（已定案：群組加密方案 → ADR-0027；前向保密 → ADR-0028；@提及 → ADR-0050；對話串 → ADR-0051；**企業身分輪替（否決金鑰托管）→ ADR-0052**）

## 建議下一步

此環境（🌐）**不需新決策就能做的規劃項目已全數完成**（Phase A/E 全部、G0–G4、M8 來電鈴聲、Cinder 更名）。往下推進需要：

1. ~~已定案、可直接施工：Phase H~~ ✅ **H1–H3 完成、H4 核心完成**（ADR-0066/0067）——僅餘 H4 的 Tauri 實機驗證（`tauri:dev` 跑解鎖全流程）。
2. ~~H5／H6／Phase J／Phase I~~ ✅ **全數完成**（ADR-0068/0069/0070/0071），**relay 端已 `wrangler deploy` 上線並實測**（2026-07-10）。剩一件營運事項：錨點前提（OPERATOR-TODO §A，Phase I 實效）。
3. ~~D4a 桌面配對克隆~~ ✅ **完成（ADR-0072）**——僅餘 RTC 直連實機驗證（可與 H4 解鎖驗證同一趟 `tauri:dev`）。
4. **需你決策**：G5 SSO/元資料稽核（等企業試點）；D4b 即時 delta 通道（D4a 用起來後評估）；M7 語音離線退回已暫緩（2026-07-10）。
3. **需換環境**：Phase B（Tauri 打包＋OS 金鑰庫）、Phase C（Cloudflare relay 部署＋D1＋NIP-42 AUTH）、Phase D（React Native 行動端＋QR 相機掃描）、通話 TURN 部署、F4 第三方稽核。
4. **此環境可選打磨**：~~顯示名稱傳遞~~ ✅ **已完成（改用加密個人檔，非公開 kind 0，ADR-0061）**；G4 輪替後續（輪替提示 i18n、Rust store 平價）、G1 多管理者名冊、多身分切換列同時在線、AI 改寫串流輸出、嚴格 CSP（需 tauri:dev 逐項驗）。

> 只有人能做的部署/金鑰步驟集中在 [`OPERATOR-TODO.md`](./OPERATOR-TODO.md)。
