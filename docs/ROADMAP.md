# Cinderous 長期施工計畫（ROADMAP）

> 本文件是「還有哪些要蓋、依什麼順序蓋」的單一入口。里程碑定義見 `ARCHITECTURE.md §7`，決策理由見 `docs/adr/`，產品規格見 `PRD.md`。功能實作前先立/查對應 ADR。

## 圖例

- 狀態：✅ 完成且測試 ｜ 🔧 進行中 ｜ 📋 規劃 ｜ ⏳ 待執行期環境
- 環境：🌐 可在瀏覽器/CI 驗證 ｜ 🖥️ 需 Tauri 工具鏈（`webkit2gtk`/`tauri-cli`）｜ ☁️ 需 Cloudflare 帳號 ｜ 📱 需 React Native 工具鏈

---

## 0. 現況快照

> **產品名：Cinderous**（slogan「Life is short, connect buddies.」；npm scope `@cinderous/*`）。測試現況：**core 193 / relay 52 / desktop 250 / i18n 6，全綠**。

- **共用協定/邏輯層（`packages/core`、`relay`）**：secp256k1 身分 → NIP-01 事件/簽章 → NIP-44 加密 → NIP-17/59 Gift Wrap → 心跳/輸入中/音樂 → 群組成對扇出 → WebRTC 信令/資料通道/降級 → QR 配對/競速/多設備收斂 → RelayClient → **節流外送匣 Outbox / 有界去重 BoundedSet** → 防濫用(PoW/訂閱上限/**企業 allowlist**)/時鐘·重放防護 → **@提及（p-tag）/對話串（reply e-tag）**。✅
- **桌面前端（`apps/desktop`）**：登入、聯絡人清單、對話視窗、表情、Markdown、Nudge、輸入中、深色/明亮、多語系；**Phase A 產品化完成**——接真實 relay（含自動重連/連線狀態）、本機持久化、聯絡人管理（刪除/封鎖）、設定面板（身分備份/通知）、未讀徽章、音樂狀態、**WebRTC P2P 檔案傳輸**。示範模式（記憶體 relay + 機器人）仍保留供體驗。✅
- **Demo**：`demo.html`、`webrtc.html`（真實 WebRTC）、主應用 `/`，皆 Playwright 驗證。✅
- **進階功能（Phase E，M6–M9）**：✅ 訊息回應/收回/限時、語音訊息/相簿/貼圖（含動態/自製/編輯器/觸發字）、語音視訊通話（含**來電鈴聲**）、QR 加好友、群組聊天、群組本地標籤、**@提及 Mention**、**對話串 Thread（Slack 式右側面板）**。
- **安全與規模化（Phase F）+ 審查修正**：✅ 前向保密決策、二進位框架、混合式引導路由、跨中繼互通、網址衛生；**審查規模化修正**（啟動回放批次化、訊息列視窗化、去重集合有界、孤兒清理、每對話上限）。
- **企業模式（Phase G，G0–G4 完成）**：✅ 封閉 allowlist 中繼、單一 App 多身分並存與切換（工作/個人、鎖定/開放、資料命名空間隔離）；✅ 簽章名冊佈建＋企業通訊錄（G1）、政策開關＋**強制 TURN 接入 WebRTC**（G2）、組織群組／公告（G3）、**工作身分輪替（G4，否決金鑰托管、無後門，ADR-0052）**。餘 G5 SSO/元資料稽核。
- **治理**：pnpm monorepo、TS strict、TDD、CI、**72 份 ADR**、AGPL-3.0。✅
- **本階段新增（額外需求，皆測試綠）**：✅ 跨身分互加防呆（ADR-0055）；**relay 生產部署上線**（免費層 SQLite DO）＋**WebSocket 休眠化＋心跳 30s**（降免費層 duration，ADR-0059）；**樹莓派自架 node-relay**（＋說明文件）；**送達/已讀回條**（Gift Wrap，已讀 opt-in＋互惠，ADR-0058）；**MSN 風 UI**（依上線狀態排序/彩色狀態選單/頂部漸層/大頭貼光暈）＋**分享 ID 縮短+複製**＋**長訊息右側詳情面板**；**本機 Ollama AI 改寫＋未讀摘要**（Rust IPC、localhost 硬守則、prompt injection 緩解，ADR-0060）；**顯示名稱加密個人檔**（只送聯絡人、非公開 kind 0，ADR-0061）。

**缺口總覽**：~~交付層可靠性與範圍隔離（Phase P）~~ ✅ **已完成（2026-08-05，ADR-0332；P1–P5 全數收斂）**、Tauri **程式碼簽章/自動更新**（B6；需憑證——安裝檔＋系統匣背景＋加密儲存＋金鑰庫皆已 Windows 實機完成）、行動端（Phase D）、企業 G5（SSO/元資料稽核）、通話 TURN 保底真機驗證、F4 第三方稽核。**relay 離線留言/AUTH 已完成並上線**（C1–C3 ✅，C4 容量校準待真實流量）。

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
| D1 | RN App 骨架 | 🔧 **起手完成（此環境）**：`apps/mobile`（react-native-web + 重用 `@cinderous/core`/`@cinderous/i18n`/`@cinderous/theme`/`@cinderous/engine`）；**app 殼與導覽（ADR-0085）**：登入→**聊天清單**（聯絡人＋群組合成、預設最近互動排序、LINE/Signal 風格列）→點擊開**對話**（氣泡＋輸入列），接 `ChatBackend`（示範後端）。另有 `ContactListScreen`（依上線狀態分區）＋**登入畫面**。**可在瀏覽器實跑的 web preview**：`pnpm --filter @cinderous/mobile dev`（Vite＋react-native-web，手機外框＋主題/語系/主色切換＋示範 nsec）。**接真實 relay（ADR-0086）**：`backend.ts` 以 `RelayChatBackend`＋`webSocketConnector`＋`LocalStorage`（nsecOverride 注入身分）連生產中繼站；清單「＋」加好友（npub）＋分享自己 npub；preview 可切「示範 ↔ 真實 relay」。**底部分頁（ADR-0087）**：聊天／聯絡人／設定（`BottomTabs`＋`SettingsScreen`）；對話為 push；主題/主色/語言在設定分頁即時切換＋登出；聯絡人分頁點擊開對話。**設計對齊（ADR-0080）**：色彩改吃 `@cinderous/theme` 的 `resolveTheme`，與桌面同一套主色/副色/深淺主題 SSOT。**登入（ADR-0081）**：`NsecSignInScreen`（nsec 匯入，A）＋`PairImportScreen`（配對匯入，B，沿用 D4a）——同帳號跨裝置；`auth.ts` 純邏輯＋真實配對協定整合測試綠。⏳ app 殼/導覽、RN 安全儲存（D2）、配對真實 WebRTC 傳輸（原生/EAS）、對話畫面。 |
| D2 | 行動持久化 | RN SQLite + Keystore/Secure Enclave。 |
| D3 | 無聲推播喚醒 | Worker 存 APNs/FCM 憑證，Silent Push 喚醒背景拉取（PRD §3）。 |
| D4a | **桌面配對克隆** | ✅ **完成（ADR-0072）**：core 協定（HELLO/CHALLENGE/BUNDLE/DONE/REJECT＋SAS 四位短碼）、`roomKeyFrom` 拋棄式信令會合（kind 21003、AEAD 密封、NIP-42 以房間金鑰通過）、WebRTC 資料通道長度前綴分塊、捆包＝StorageSnapshot 全量、兩端 UI（舊機 QR/碼/倒數/SAS 確認；新機 SignIn 匯入）。載荷帶會合 relay。✅ **實機 E2E 驗證通過（2026-07-10）**：真實 Chromium×3 context＋真實 WebRTC＋生產 relay，連續三次全綠（SAS 一致、捆包直傳、新舊機狀態收斂一致）。過程抓到並修掉三個真實缺陷（NIP-42 認證競態致信令遺失、ephemeral offer 無重放致間歇失敗、設定面板蓋住 SAS 確認鈕）。 |
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
| F1 | 群組加密 ADR | ✅ **已定案（ADR-0027）**：v1 Gift-Wrap 成對扇出 + 帶內群組狀態；MLS 延後為未來升級（觸發：需 PCS/更大群/稽核後），與 F2 棘輪一併評估。**⚠ 指標更新（ADR-0260/0259）：原文寫的 NIP-EE 已被生態標為 `unrecommended`，由 [Marmot Protocol](https://github.com/marmot-protocol/marmot)（狀態 adopted）取代——日後真要做 MLS 時應照 Marmot，不是 NIP-EE。行程不變（ADR-0091 的暫緩理由仍成立）。** |
| F2 | 前向保密決策 | ✅ **已定案（ADR-0028）**：維持靜態 ECDH；即時走 WebRTC/DTLS（已具 PFS）；不另立 Double Ratchet，未來若需 FS/PCS 統一採 MLS（與 ADR-0027 同一次工程；**規格指標同 F1：改為 Marmot**）。近期 FS 路徑見 ADR-0245（手動 opt-in）。**2026-07-31 起實驗性上線（ADR-0306）**：預設關、設定頁常駐揭露「尚未經外部審計」、啟用需確認；**文案仍不得宣稱 FS**（不進功能表／行銷文案，僅藍圖頁事實陳述；比較表 `cp_r9a` 由 `Compare.test` 鎖為「已實作（實驗性）」＋永不得為 ✓＋表下須有「未經外部審計」註腳）。**2026-08-03 盤點更正**：~~行動端尚無 UI~~ 已不成立——**桌面／瀏覽器／行動端三端皆已具備**。⚠ 真正的限制是**範圍**：只有 1:1 文字訊息有 FS，群組／typing／nudge／回條／檔案／通話維持靜態（ADR-0245 §200）；外部密碼學審計仍未進行（複查期限 2027-01-30，由 `fs-review-deadline.test.ts` 到期弄紅 CI）。 |
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
| H4 | 本地密碼 | 🌐＋🖥️ | 🔧 **核心完成**：Rust `passlock`（Argon2id 19MiB/t2/p1 衍生 KEK＋AES-256-GCM 包裹）＋IPC `pass_*` 七命令（db 金鑰解鎖後快取原生記憶體）；`UnlockScreen` 開機閘門、閒置 5 分自動上鎖、設定安全區塊（啟用強制備份確認／改密碼＝重包裹／停用／隱藏身分＋🔒 喚回）。**＋忘記密碼救援（ADR-0073）**：db 金鑰另以 nsec 衍生金鑰雙重包裹，忘記密碼時輸入 nsec／備份碼即可救回本機完整資料並重設密碼（惰性補建向後相容；30+3 Rust 測試）。⏳ Tauri 實機驗證（`tauri:dev`）。 |
| H5 | 群組快照廣播 | 🌐 | ✅ **完成**：`group-snapshot` 控制型別＋管理員開機 `broadcastGroups()`（每群每日節流）；白紙裝置收快照＝實例化（守門同 create）、既有群僅 admin 可對帳、組織群排除。測試：nsec 換機重建 E2E＋前成員偽造快照防護（ADR-0068）。 |
| H6 | 加密備份碼 | 🌐 | ✅ **完成**：core `backup`（內層 NIP-49 ncryptsec＋外層 `{v, ncryptsec, relayUrl}`、peekBackupRelay 預填）；設定面板產生備份碼（二次密碼→字串＋QR＋複製）；新增身分匯入欄自動判別備份碼＋備份密碼欄（ADR-0070，部分取代 ADR-0015）。 |

**完成定義**：既有身分可無損搬家（聯絡人自動改道、排水期零漏信）；共用設備上各身分可獨立上鎖與隱藏。

---

## Phase I — Relay 自動分配與自動搬家（🌐 可在此環境推進；實效需營運前提）

> 決策：ADR-0069（簽章清單驅動、分級觸發；否決「接近額度即搬」與 relay 端指派）。
> **營運前提**：立起 ≥2 座錨點 relay、填入 `bootstrap-config.ts` 的 `ANCHOR_RELAYS` 與 `MAINTAINER_PUBKEY`。**現況（2026-07-10）**：`ANCHOR_RELAYS` **已填入生產站一座**（`cinder-relay.…workers.dev`）→ I4 自動選座已生效（登入自動預填）；`MAINTAINER_PUBKEY` 仍空（T3 退役休眠）。建議日後再立第二座錨點（不同平台/網域，如 Zeabur 自架）補齊單點風險。

| # | 任務 | 環境 | 說明 / 驗證 |
| --- | --- | --- | --- |
| I1 | 簽章清單 schema 擴充 | 🌐＋☁️ | ✅ **完成**：`RelayListDoc.entries`（accepting/weight/status；舊欄位 relays 保留＝舊客戶端相容、缺欄位全預設）；`listEntries`/`pickWeighted`/`migrationTarget`/`weightedOrder` 純函式；health-check 對 retired 免探測原樣保留、entries 隨簽章發佈。 |
| I2 | 遞補持久化＋T2 durable 搬家 | 🌐 | ✅ **完成**：home 離線起點跨 session 持久化（`nb.homeDownAt`）；逾門檻（預設 24h）且有健康目標 → `onHomeMigrate` → App 走 H2＋H3 排水＋通知＋重載（一次性 latch、遲滯防抖；企業不接）。 |
| I3 | T3 清單退役撤離 | 🌐 | ✅ **完成**：清單標我的 home 為 draining/retired → 隨機延遲（預設 0–6h 防羊群、測試可注入）後撤離；目標＝清單序首個 accepting ok 在線座（決定性防 split-brain）＋錨點保底；`accepting:false` 僅擋新分配。 |
| I4 | SignIn 自動選座 | 🌐 | ✅ **完成**：欄位無預設值時自錨點加權隨機＋WebSocket 探測依序備援預填（可改可清）；`?relay=`>上次記憶>自動選座；無錨點＝行為不變（示範模式保留）。 |

**完成定義**：新帳號免填網址上線；relay 死亡/退役對用戶透明，遷移一次到位不重演。✅ **已達成**（生產站設為錨點、I4 自動選座生效）——完整容錯待第二座錨點與 `MAINTAINER_PUBKEY`（OPERATOR-TODO §A）。

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

## Phase K — 社群自訂前端（🌐 可在此環境推進；ADR-0074）

> 三層封裝：**core（加密/協定原語）→ engine（可用 ChatBackend 實作）→ frontend**。
> 讓社群接自己的前端（Web/RN/其他），而非 fork 整包 desktop。各階獨立可交付。

| # | 任務 | 環境 | 說明 / 驗證 |
| --- | --- | --- | --- |
| K1 | 前端開發指南（零程式） | 🌐 | ✅ **完成**：`docs/前端開發指南_Frontend-Guide.md`——三層心智模型、重用 core/i18n、實作/消費 `ChatBackend` 三步、介面速查、`apps/mobile` 活範本、主題/i18n、AGPL 含意。 |
| K2 | 抽 `@cinderous/engine` | 🌐 | ✅ **完成**：新 workspace 套件 `@cinderous/engine`——整組上移 `backend/`（ChatBackend/DTO/RelayChatBackend/BrowserChatBackend/connector/WebRTC/配對）＋`storage/`（AppStorage/LocalStorage/MemoryStorage/profiles/快照）。依賴方向 `engine→relay→core` 無環；平台基質（TauriStorage/keyvault）留 desktop 經介面注入。desktop 12 檔改接、**mobile 新增 `chat.ts` 用 `BrowserChatBackend` 驅動——跨前端重用已實證**。零測試遺失（engine 104＋desktop 234＝原 338）；全 workspace typecheck 綠。 |
| K3 | 執行期語系/主題包（選配） | 🌐 | 🔧 **縫已預留**：`@cinderous/i18n` 加 `registerLocale`/`availableLocales`（執行期語系包、免重編，8 測試綠）；主題已 token 化（`--accent`＋`data-theme`）為配色縫。完整「drop-in 包載入器/市集」待需求。 |
| K4 | 前端外掛/插槽（選配，另立 ADR） | 🌐 | 🔧 **縫已預留**：`@cinderous/engine` 加 `registerExtension`/`getExtension`/`listExtensions`（行程內第一方註冊表，實驗性）。**第三方/遠端程式碼載入的沙箱與信任邊界待 K4 專屬 ADR**，尚未實作。 |

**完成定義**：社群裝 core/i18n/engine 三套件、實作 `ChatBackend` 前端即可運作；`apps/mobile` 接上後端為活範本。

---

## Phase N — 桌面原生通知（🌐 程式可推進；🖥️ 實機驗證需打包版；ADR-0076）

把「收到訊息跳通知」從打包後不穩的 webview Web Notification，升級為可靠的原生 toast、顯示傳訊者、點擊回到對話（LINE 級體驗）。

| # | 項目 | 狀態 |
| --- | --- | --- |
| N1 | 外掛依賴＋權限 | ✅ **完成**：`tauri-plugin-notification`（Rust，收進 `tauri-app` feature）＋`@tauri-apps/plugin-notification`（JS）；`main.rs` 註冊 plugin；`capabilities/default.json` 授 `notification:default`。`cargo check --features tauri-app` 乾淨（帶進 Windows `tauri-winrt-notification` toast 後端）。 |
| N2 | 通知服務抽象 | ✅ **完成**：`src/native/notify.ts` 單一 `notify()`／`ensurePermission()`，`isTauri()` 走原生外掛否則 fallback Web Notification；App 送出點與權限請求改走它。既有「僅他人訊息＋視窗未聚焦才跳」判斷不變。7 單元測試（Tauri／瀏覽器／無權限／點擊）。 |
| N3 | 點擊回跳＋開對話 | ✅ **完成（程式）**：新 IPC `focus_window`（薄包 `show_main`＝show+unminimize+set_focus）；`onNotificationClick` 接外掛 `onAction`＋`extra.convo` → 叫回視窗＋開該對話置前；瀏覽器 fallback 走 `Notification.onclick`。⏳ **桌面各 OS 點擊 action 支援度需打包版實機確認**（通知顯示本身不受影響）。 |
| N4 | 傳訊者名稱＋提示音 | ✅ **完成**：通知標題＝群組/聯絡人顯示名（非固定 "Cinderous"），群訊內文前綴傳訊者；提示音 `playChime`（Web Audio 上行雙音、無外部音檔、CSP 相容），**預設開可關**。 |
| N5 | 設定開關＋文件 | ✅ **完成**：設定面板通知區加「提示音」「隱藏內文預覽」兩子開關（本機持久化，比照 `nb.notify`；預設音開、預覽顯示＝LINE 風）；本表同步。 |

**完成定義**：打包桌面版收到背景訊息時跳原生系統通知、顯示是誰傳的、點擊回到該對話；提示音與預覽可於設定調整。⏳ 真實 OS toast 與點擊 action 待打包版（`tauri:build`）實機驗收。

---

## Phase O — 本地個人化（🌐 程式可推進；純本地，不廣播/不動協定；ADR-0077）

頭像／每對話背景／對話框尺寸皆**只存 localStorage**、圖片本機縮圖壓縮成 data URI，不進 Nostr、不進雲端快照/備份。

| # | 項目 | 狀態 |
| --- | --- | --- |
| O1 | 對話框滑鼠縮放 | ✅ **完成**：`.convo` 右下角自訂把手拖曳（避開 CSS resize 需 overflow:hidden 而裁掉往上彈的 ➕/AI 面板）；夾在 min/max，放開持久化為**全域一個偏好**（`nb.convoSize`），開啟對話框套用。 |
| O2 | 本地自訂頭像 | ✅ **完成**：`nb.avatar.<pubkey>` → 縮圖 data URI（≤128px）；共用 `<Avatar>`（有圖用圖否則生成漸層底＋首字），套**對話框標題（.pics）與「我」區**；點頭像彈「更換／移除」；**聯絡人精簡清單維持純圓點**（決策 O2）。 |
| O3 | 每對話本地背景 | ✅ **完成**：`nb.chatbg.<pubkey>` → `{preset\|image}`；套用該對話 `.convo__body`；標題列 🖼️ 開背景挑選器（6 組內建色/漸層預設＋上傳圖片≤900px＋清除）。 |
| O4 | 測試＋文件 | ✅ **完成**：personalize 儲存 6 測試＋Avatar 分支 2 測試；本表同步。 |

**完成定義**：可換頭像（本機）、每對話配不同背景、滑鼠縮放對話框，全部本地即時、離線可用、不外洩。⏳ 圖片挑選/縮圖與縮放拖曳的實際手感待打包版實機微調。已知限定：本地頭像/背景**不隨換機同步**（設計如此）。

---

## Phase P — 交付層可靠性與範圍隔離（🌐 可在此環境推進；ADR-0294）

由 ADR-0293（White Noise 拆解）導出的自我審查結果。

**P1／P2 已修（2026-07-30）**。`packages/engine/src/backend/file-chunk-redelivery.test.ts` 原是
特徵化測試（斷言當時的錯誤行為），現已按 ADR-0294 §1.4 的交代**把斷言翻正為規格**，而不是刪掉。

修的過程中發現兩件 ADR-0294 沒寫到、但會讓「照字面修」修錯的事：

1. **水位不能共用**。`inboxWatermark` 只由 `OFFLINE_DM_GIFT_WRAP` 推進，直接把 `inboxSince`
   套到 FILE_WRAP 會**跳掉比 DM 水位舊的檔案塊** ⇒ 在修 bug 的過程中製造掉檔。已另開
   `fileWatermark`。
2. **補水位根本修不掉「重開 App 重收」**。水位只在記憶體（`inboxSince` 的註解自己寫著
   「App 重啟仍全量抓一次」）。真正的修法是持久化記號 `StoredFileMeta.received`，
   水位只省重連時的下載量。

| # | 項目 | 狀態 |
| --- | --- | --- |
| P1 | 檔案塊訂閱補增量水位＋跨重啟去重 | ✅ **已修**：`{kinds:[FILE_WRAP], "#p": me}` 是 13 組訂閱 filter 中**唯一「會累積的儲存型 kind」卻沒有 `since`** 的一條（離線私訊那條有 `inboxSince`）。後果：重開 App 會把 TTL 內收過的每個檔案重收、重組，並因桌面 `onFileBytes` 內無條件 `saveIncomingFile` 而**再跳一次「另存新檔」**。（ADR-0288 §2.3／0294 §1.2） |
| P2 | 重組失敗要有訊號 | ✅ **已修**：缺塊時 `onFileBytes` 不觸發、**`onFileError` 也不觸發**，殘骸由 `sweepChunkAsm()` 在 120 秒後靜默刪除 ⇒ 寄件者看到「已送出」（ADR-0041 只保證中繼收下）、收件者什麼都沒有、**雙方都不知道**。與 ADR-0264 §8 為行事曆解掉的靜默分歧同一類。（ADR-0288 §2.2／0294 §1.3） |
| P3 | 重取策略成為訂閱工作負載的屬性 | ✅ **已做**：目前一次 `subscribe("all", …)` 混了 13 組用途（presence／收件匣／快照／信令／檔案塊／名冊），而重取策略靠每個 filter 各自記得加——P1 正是這樣漏掉的。White Noise 因同一問題把單一 client 拆成四個 relay plane。**只做 P1 是治標**，下一個累積型 kind 仍會重蹈覆轍。（ADR-0293 §2.1／0294 §4） |
| P4 | 行動端 per-identity 範圍隔離 | ✅ **已完成（ADR-0332，2026-08-05）**；以下為歷程：🟡 原「部分完成」：桌面換身分走 `location.reload()`＝結構性保證；行動端是就地切換＋**手寫 reset 清單**，目前漏了 `archived`（歷史入口閘門，兩身分共用同一 pubkey 時會出現幽靈入口）、`purged`、`calDraft`。建議把 per-identity 狀態關進以身分為 `key` 的子元件（清單可整個刪掉），而非補三行。（ADR-0293 §2.2／0294 §2） |
| P5 | 匿名發布 plane（評估） | ✅ **已評估（ADR-0299：不建議現在動）**：中繼在 `requireAuth` 時**連 EVENT 都要 AUTH**，而發布與訂閱共用同一條連線 ⇒ 中繼知道「這顆匿名 wrap 是誰送的」（ADR-0237 的洩漏在**發布側**）。拆開可修掉一半，但 gift wrap 的 author 是一次性金鑰、對企業 allowlist 無用，**AUTH 身分很可能正是 allowlist 唯一的執行點** ⇒ 只能分部署，且需先算公共節點的濫用面。（ADR-0293 §3） |

**完成定義達成情況**（2026-07-30）：

- ✅ P1+P2：修好，特徵化測試斷言已翻正為規格。
- ✅ P3：新增 `backend/sub-plan.ts`——`sub(filter, resume)` 讓續取策略成為**宣告的必填項**；
  累積性由 NIP-01 的 kind 區間判定（`isAccumulatingKind`），不是手維護名單（手維護會漏，
  而漏掉的後果正是 P1）；累積型 kind 未宣告策略即 `throw`，`sub-plan.test.ts` 在 CI 先抓。
- 🟡 P4：**補齊了漏網並加上守衛，但沒做 ADR-0294 建議的治本重構**。
  已補 `archived`／`purged`／`calDraft`／`activeId`／`typingFrom` ＋ 5 個通話 state
  （後端 `stop()` 了但 React 仍留著「通話中」畫面）。
  `MobileApp.perIdentityState.test.ts` 掃原始碼強制：任何新 `useState` 都要先**分類**，
  分到 per-identity 的必須在 `signInWith` 內被指派。
  **未做**：以身分為 `key` 的子元件（清單可整個刪掉）——那是 1823 行、55 個 `useState`
  的重構，而行動端測試只有靜態渲染、抓不到互動回歸，風險過高。守衛擋得住「忘了想」，
  擋不住「分錯類」。
  🔵 **2026-08-04（ADR-0328）**：那句話還有下半段——**同一個弱點兩頭都佔**（沒有互動測試，
  重構不敢動；也讓這類 bug 平常不會被發現）。已補**行動端 jsdom 互動測試**（走真正的登入／
  加聯絡人／送訊息／新增身分／切回解鎖），斷言兩個方向：per-identity 不得殘留、裝置層必須保留。
  ⚠ 它覆蓋守衛四個盲點中的**第 1 類（分錯類）一部分**。
  🔵 **2026-08-04（ADR-0329）**：**第 3 類（非同步落地）已補**——`signInWith` 進入新世代，
  非同步工作發出前 `mark()`、落地時比對，變了就丟；已守住四處（含 §2 那個「幽靈歷史入口」）。
  真正的產出是掃描器 `MobileApp.asyncEpoch.test.ts`：**下一個非同步落地忘了綁世代就紅**
  （形狀同 `sub-plan.ts` 的「續取策略＝宣告必填項」）。
  ⚠ **競態本身沒有端到端證明**（jsdom 難觸發且結果不可觀察）——機制有單元測試、套用由掃描器強制。
  🔵 **2026-08-04（ADR-0330）**：**第 2 類（`useRef`）已補**——掃描器要求每個 `useRef` 落進
  「render 期鏡像／`signInWith` 內被清／明列為裝置層且寫下理由」三類之一。
  ⚠ 起因是盤點時用 `const .*Ref = useRef` 只數到 12 個並下結論「都安全」，
  **實際 16 個**（漏掉不以 `Ref` 結尾的 `pairDecision`／`statusBcTimer`／`typingTimer`）
  ——**靠命名慣例做安全稽核就是這樣漏的**。
  ⇒ **階段 0（前提）完成**：四個盲點中第 2、3 類已關，第 1、4 類由 ADR-0328 的 UI 行為部分覆蓋。
  **階段 1（按功能簇抽 hook，7 簇、由外圍到核心）進行中**——**ADR-0331 階段 1 已完成**（通話 5、企業 8、身分層開關 5、行程 2、
  「我自己」9、名冊 4、對話 8——`useState` 55→14，且**剩下的 14 個恰好就是裝置／外殼層那 14 個**，
  `PER_IDENTITY` 集合為空 ⇒ 守衛等價於「MobileApp 不得再直接持有 per-identity state」）。
  ⚠ 三支守衛都已擴及簇檔案——**抽出去不能變成繞過守衛的方法**，這個問題在第 2、6 簇各浮現一次。
  **階段 2 進行中（ADR-0332）**：🔵 **「階段 2 不可再拆」是錯的**——已拆為
  2a（7 簇聚合成一個 `session`，✅）／
  2b（切成外殼 `MobileApp` ＋ `AppSession`，登入控制流反轉為由 `active` 驅動，✅）／
  2c（掛 `key={pubkey}:{gen}`＋刪掉已無人呼叫的 `reset()`，✅）。
  🔵 **Phase P4 的結構性保證已成立**：切身分＝`AppSession` 重掛 ⇒ 7 個功能簇回初值，
  ADR-0294 §2 的三個漏網（`archived`／`purged`／`calDraft`）**不可能**再發生。
  ⚠ **`asyncEpoch` 世代守衛保留**（原規劃說可退場，校正見 ADR-0329 §5）——重掛涵蓋 state，
  **不涵蓋閉包抓住的舊後端那類副作用**。
  ⚠ 離職接管與配對搬家匯入兩條登入路徑無法在 jsdom 驅動，**待實機驗收**。
  分開的價值：**2b 若壞是搬家搬錯、2c 若壞是重設語意錯，混在一起就分不出來**；同時新增登記表 `test/identity-clusters.ts` 讓三支守衛接手已抽出的簇
  （**抽出去不能變成繞過守衛的方法**）。階段 2（子元件＋`key`）不可再拆，但屆時是「移動」而非「重寫」。
- ✅ P5：評估完成（ADR-0299）。結論：拆匿名發布連線只修一半（同時性關聯仍在），
  且會撞掉企業 allowlist 唯一的執行點，需分部署＋公開節點濫用面評估。**不建議現在動**；
  先補揭露。

**順帶發現**：`retentionCap`／`readReceipts`／`cloudSync` 讀的是**全域** localStorage
鍵、不帶 pubkey ⇒ 現行語意是裝置層，切身分不重載。

- 🔵 **`cloudSync` 已修（ADR-0327，2026-08-04）**。它不是設計題而是**兩端分歧**——桌面一向
  是身分層，只有行動端是裝置層 ⇒ 手機上工作身分開了備份、個人身分也跟著開著。已改為
  每身分一份（含一次性遷移，不讓任何人的備份靜默停掉），並順帶修掉「明確關閉會被另一台
  的快照重新打開」（裝置層分不出「從未設定」與「明確關閉」）。
- `retentionCap`／`readReceipts` **維持裝置層**：它們的語意撐得住（「這台留多少」「這台要不要
  送回條」），且兩端沒有分歧。

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

## 回滾錨點

| Tag | 意義 |
| --- | --- |
| `baseline/pre-ratchet-fs` | **投入棘輪 FS 之前的最後一個已驗證狀態**（2026-07-30，含 ADR 0001–0302） |

**為什麼有這個 tag**（原始理由）：棘輪 FS 的方向決定是「**取代**」ADR-0245 的輪替加密子鑰，
而 ADR-0245 的 Phase 0–2 已實作完成且全測綠、只卡在外部審計（ADR-0290 §2）。
「取代」意味著那份已完工的實作會被改寫或移除——若棘輪走不通（最可能卡在審計費用、
TypeScript 自寫 double ratchet 的風險、或**裝置撤銷沒有執行點**），必須回得來。

> 🔵 **2026-07-31 更新：「取代」這個定性已經不準了。** 三件事改變了它——
>
> 1. **ADR-0302 的版本協商 ⇒ 兩者可以並存。** 能力宣告已改為四態解讀
>    （`fs`／`retired`／`unknown`／`absent`），日後 `ratchet-v1` 與 `ek-v1`
>    彼此**可辨識、可協商**，不必二選一。
> 2. **ADR-0306 已把 `ek-v1` 實際出貨**（實驗性、預設關）。它現在**有真實使用者**，
>    而 0306〈後果〉明載「不能隨意拔掉」⇒ **移除不再是免費的**。
> 3. **ADR-0303 §2／ADR-0304 §6 顯示棘輪不需要 `ek-v1` 讓路**：棘輪的入場費是
>    per-device **session**（非 per-device 身分），與 `ek-v1` 不衝突。
>
> ⇒ 這個 tag 的**現行**用途改為：**在棘輪實作過程中若動壞既有 FS 路徑時的回退點**，
> 而不是「棘輪失敗就整條退回」。後者已不成立——**兩條路現在是可以並行的**。

### 前提閘門排序（ADR-0303 後續行動 d／ADR-0304 §6）

裝置撤銷那條線有一條**共同前提鏈**，而 **FS 不在這條鏈上**：

```
ADR-0298（密碼導出 K_root）
    ↓  沒有它，裝置上就不能沒有 nsec
       （ADR-0304 §3：雲端快照、本機靜態加密、自封副本三處都直接從 nsec 導金鑰）
nsec 冷保存
    ↓  ADR-0303 §6 全部方案的共同閘門
裝置授權（加＝live 配對／刪＝救援碼）
    ↓
裝置撤銷
```

⇒ **棘輪 FS 可以先走**（ADR-0303 §2：只需 per-device 預金鑰＋session，不必放棄共用 nsec）。

### FS 範圍擴大的執行順序（ADR-0315；2026-08-03 定）

現況：FS 已實驗性出貨（ADR-0306），**自動輪替**（ADR-0313）與**停用**（ADR-0314）已補齊，
但涵蓋範圍**只有 1:1 文字訊息**。擴大的順序如下，**第 1 步是阻擋性前提，不可跳過**：

| # | 工作 | 狀態 | 為什麼是這個順序 |
| --- | --- | --- | --- |
| 1 | **可觀測性**：讓 EK 解封失敗可計數／回報 | ✅ **完成**（ADR-0316） | 原本是 `catch { return; }` ＝**靜默消失**。已改為兩桶計數（`notFs`／`maybeEkLoss`）＋`onFsUndecryptable`＋設定頁顯示。⚠ **「區分缺 EK 與壞事件」密碼學上做不到**（兩者都是 MAC 失敗）——採不對稱分類：從未持有 EK 時的失敗確定與 FS 無關，反之無法區分，型別名與文案都帶著「可能」 |
| 2 | **Tier A 高價值三項**：檔案 metadata／群組訊息／共享行程 | 🟡 **批一完成**（ADR-0318：檔案 metadata ＋ 共享行程）／**批二完成（ADR-0320：群訊＋群組檔名；群組控制訊息刻意不動＝fail-open）** | 收件端 `openFs()` 已就緒，只差送件側傳 `encryptToFor`；檔名＋大小是真正敏感的東西。⚠ 群組的降級警告語意要先定義，否則會洗版 |
| 3 | **訊息回應（reaction）** | ✅ **完成** | 價值低但零額外風險；動工前已驗證**沒有「取消回應」的路徑** ⇒ 解不開只是少看到一個 emoji（fail-safe），與收回訊息的 fail-open 不同 |
| 4 | **收回訊息（kind 5）＝不做** | ✋ **刻意不做** | 其他型別解不開是 fail-safe（沒看到）；**收回相反**——刪除事件解不開 ⇒ 該收回的訊息繼續留在對方畫面。`deletion.ts` 檔頭自己說那「是隱私破損，不是不便」。要做必須帶身分金鑰備援 |
| 5 | **Tier B（typing／nudge／presence／SDP／通話）＝不做** | ✋ **刻意不做** | Ephemeral kind **純記憶體轉發、不寫持久層**，沒有儲存的密文可供未來解密；且「三個月前某人正在打字」解開也沒價值。價值近零、成本是每條路徑各改一次 |

⚠ 全部在「FS 仍未經外部密碼學審計」的前提下（ADR-0306）。設定頁揭露文案**已隨範圍同步**
（2026-08-03）：明列涵蓋（文字／貼圖／自訂 emoji／檔名／行程／回應，含群組）與**不涵蓋**
（收回、群組成員變更、已讀回條、typing／nudge、通話）。⚠ 日後若再擴大，這段文案要跟著改
——曾經兩次寫得比實際寬鬆（只說「發給聯絡人的訊息」）、一次寫得比實際嚴格（誤稱貼圖不涵蓋，
實際上貼圖走 `sendMessage`＝一直都有）。
⇒ 在 ADR-0298 完成前，裝置那條線**只有 E-lite 可先行**（ADR-0303 §6.6）。
✅ **E-lite 已完成（ADR-0321，2026-08-03）**：設定頁「我的裝置」＋新裝置警示，
零協定變更（本機 id／快照 `d` tag／配對）。⚠ 誠實邊界已寫進 UI——**偵測得到會寫入的裝置，
偵測不到只讀取的裝置**（我們沒有 Signal 那個負責路由到裝置的伺服器角色，
故 §4.3「隱藏與收訊互斥」的論證在我們的模型裡不成立）。

發版 tag `v0.0.14` 已落後 **77 個提交、29 份 ADR**，不能當回滾點。

```
git switch -c rollback/xxx baseline/pre-ratchet-fs
```

打 tag 當下：工作區乾淨、`pnpm -r typecheck` 0 錯、`pnpm -r test` 全綠
（core 55／engine 31／desktop 75／mobile 44／website 9／relay 11／cli 2／i18n 2／theme 4／brand 1 檔）。

⚠ Android debug APK 的簽章與正式版不同，回滾後重裝需先移除舊 App。

## 未決策 ADR（開工前需定案）

- **M7 語音訊息離線退回策略**：⏸ **暫緩（2026-07-10 裁示：暫不實作）**。屆時方向已議定——短語音（低碼率、NIP-44 單包 64KB 內）走 Gift Wrap 離線退回、長語音誠實提示 P2P-only；分塊多事件方案傾向否決（吃配額）。
- **G5 SSO / 元資料稽核**：綁 AD/LDAP/OIDC → npub、自架 relay 記錄連線元資料，實作前須立 ADR（並備外部 IdP）。
- **Phase K4 前端外掛/插槽**：第三方注入自訂 UI（不 fork），涉安全邊界，開工前另立 ADR（ADR-0074 已定 K1–K3）。

（已定案：群組加密方案 → ADR-0027；前向保密 → ADR-0028；@提及 → ADR-0050；對話串 → ADR-0051；**企業身分輪替（否決金鑰托管）→ ADR-0052**）

## 建議下一步

此環境（🌐）**不需新決策就能做的規劃項目已全數完成**（Phase A/E 全部、G0–G4、M8 來電鈴聲、Cinderous 更名）。往下推進需要：

1. ~~已定案、可直接施工：Phase H~~ ✅ **H1–H3 完成、H4 核心完成**（ADR-0066/0067）——僅餘 H4 的 Tauri 實機驗證（`tauri:dev` 跑解鎖全流程）。
2. ~~H5／H6／Phase J／Phase I~~ ✅ **全數完成**（ADR-0068/0069/0070/0071），**relay 端已 `wrangler deploy` 上線並實測**（2026-07-10）。剩一件營運事項：錨點前提（OPERATOR-TODO §A，Phase I 實效）。
3. ~~D4a 桌面配對克隆~~ ✅ **完成（ADR-0072）**——僅餘 RTC 直連實機驗證（可與 H4 解鎖驗證同一趟 `tauri:dev`）。
4. **需你決策**：G5 SSO/元資料稽核（等企業試點）；D4b 即時 delta 通道（D4a 用起來後評估）；M7 語音離線退回已暫緩（2026-07-10）。
4b. **FS 範圍擴大**（ADR-0315，順序見〈FS 範圍擴大的執行順序〉）：第 1 步可觀測性 ✅ **已完成（ADR-0316）**；第 2 步**批一已完成（ADR-0318：檔案 metadata ＋ 共享行程，只 retarget 不帶 EK hint）** **Tier A 全部完成**（批一 0318 檔案 metadata＋行程／批二 0320 群訊＋群組檔名／回應）；**收回訊息與 Tier B 已裁定不做**（fail-open／ephemeral 無價值）。ADR-0315 的清單至此結案。收回與 Tier B 已裁定不做。
3. **需換環境**：Phase B（Tauri 打包＋OS 金鑰庫）、Phase C（Cloudflare relay 部署＋D1＋NIP-42 AUTH）、Phase D（React Native 行動端＋QR 相機掃描）、通話 TURN 部署、F4 第三方稽核。
4. **此環境可選打磨**：~~顯示名稱傳遞~~ ✅ **已完成（改用加密個人檔，非公開 kind 0，ADR-0061）**；G4 輪替後續（輪替提示 i18n、Rust store 平價）、G1 多管理者名冊、多身分切換列同時在線、AI 改寫串流輸出、嚴格 CSP（需 tauri:dev 逐項驗）。

> 只有人能做的部署/金鑰步驟集中在 [`OPERATOR-TODO.md`](./OPERATOR-TODO.md)。
