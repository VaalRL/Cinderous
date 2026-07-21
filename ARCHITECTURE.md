# ARCHITECTURE.md — Cinderous 系統架構（草稿）

> 本文件是模組邊界、資料流與初始化規劃的**單一真實來源（SSOT）**。產品行為以 [`PRD.md`](./PRD.md) 為準；本文件定義「落在哪一層、如何連接」。
>
> 狀態：**M1–M9 核心已完成，中繼已部署生產；企業模式（§8）已於桌面與行動端落地**；本檔已對齊至 ADR-0184（2026-07）。行動端（`apps/mobile`，react-native-web）與桌面**共用 `packages/engine`**，功能高度對齊——含企業成員入職/名冊管理/離職接管（唯「企業主收儲存槽落盤」限桌面＝需原生檔案系統）。隨實作推進，模組邊界、事件契約或資料流如有變更，必須同步更新本檔與相關入口文件。細部決策與反轉（D1→DO、捨棄→支援網頁、SQLite→加密 blob、無推播等）見 `docs/adr/`。

## 1. 設計原則

- **本地優先（Local-First）**：本機**加密儲存**是唯一真相來源；網路層只負責同步與轉發。
  （儲存為「狀態常駐記憶體＋逐部位加密持久化」，ADR-0110；桌面走 AES blob 檔，web/mobile 走
  加密的 localStorage＋OPFS 封存——**非 SQLite**，早期的 SQLite 規劃於 ADR-0054 起改為加密 blob。）
- **零伺服器狀態**：中繼站不持久化線上狀態與信令（Ephemeral），僅暫存有過期時間的離線留言。
  持久層為 **Durable Object 內建 SQLite**（ADR-0056，非 D1）。Ephemeral 不寫持久層，但仍消耗
  DO 請求數（非零成本）。
- **端到端加密**：明文不離開裝置；內容以 NIP-44 加密。
- **元資料隱藏**：私訊以 NIP-17/59 Gift Wrap 包封收發雙方，中繼站無法重建社交圖譜（詳見 PRD §6–§7 與 `docs/adr/0002`）。**typing／nudge 亦已封裝**（ADR-0120，原本以真名廣播指名事件，會反推 Gift Wrap 寄件人）。
- **靜態落地加密**：私鑰與本機資料不以明文落地。**桌面**以 OS 金鑰庫（ADR-0053）＋AES-256-GCM
  加密 blob（ADR-0054／0110）；**web/mobile**（無 OS 金鑰庫）以 Argon2id 本地密碼包裹 nsec、
  資料以 nsec 導出金鑰加密（ADR-0112／0117／0122）。共用設備可再啟用**本地密碼**（ADR-0067）：
  Argon2id 衍生金鑰包裹 nsec 與資料金鑰，並支援隱藏身分與閒置自動上鎖；nsec 僅用於匯入／換機／
  救援，不作日常登入。
- **雙軌動態切換**：能 P2P 直連就走 WebRTC；不能直連或對方離線時退回 Nostr 中繼；P2P 失敗以 TURN／經中繼降級保底。
- **換機三條路**：加密備份碼（身分＋relay，NIP-49 使用者自持，ADR-0070）／加密雲端快照（opt-in 三檔，relay 只見密文，ADR-0071）／**桌面配對克隆**（一次性 P2P 全量搬家，SAS 短碼互認、內容不經中繼，ADR-0072）。nsec 僅為主金鑰，不作日常登入（ADR-0067）。
- **跨中繼互通（ADR-0034）**：relay 之間不聯邦；客戶端維護 relay pool——addressed 事件（帶 `p` tag）發往**收件人的 relay**（好友 relay hint，`npub…@wss://…`）、心跳發往 pool 全部、收件箱訂閱掛在 pool 每座 relay，事件以 id 去重；hint 由加密 rumor 內層自動學習（ADR-0035，不用公開的 NIP-65），且**個人檔開機廣播帶 hint**（ADR-0066）＝每次開機刷新全聯絡人路由、陳舊自癒。更換 home relay 走「保留命名空間搬家＋舊站 7 天排水」（ADR-0066，對齊 ADR-0065 的 relay TTL）。任何標準 Nostr relay 皆可互通。

## 2. 雙軌混合網路

```text
        ┌─────────────────────────────┐         ┌─────────────────────────────┐
        │     裝置 A（桌面/網頁）      │         │     裝置 B（桌面/網頁）      │
        │  React UI ── Tauri/瀏覽器    │         │  React UI ── Tauri/瀏覽器    │
        │   │            │             │         │             │          │   │
        │ 加密儲存(SSOT) 金鑰/加密      │         │      金鑰/加密 加密儲存(SSOT) │
        └───────┬────────────┬─────────┘         └────┬────────────┬──────────┘
                │            │                         │            │
   引擎 A：Nostr │            │ 引擎 B：WebRTC P2P       │            │ 引擎 A：Nostr
   (WebSocket)  │            └─────────────────────────┘            │ (WebSocket)
                │              即時：Nudge / 檔案 / 動畫              │
                ▼                                                    ▼
        ┌──────────────────────────────────────────────────────────────┐
        │        Cloudflare Worker + Durable Object（Nostr Relay）       │
        │  Ephemeral(20000-29999)：純記憶體轉發，不寫持久層              │
        │  離線留言(NIP-17 GiftWrap)：寫入 DO 內建 SQLite，NIP-40 7 天過期 │
        └──────────────────────────────────────────────────────────────┘
```

- **引擎 A — Nostr（Cloudflare Workers + Durable Object SQLite，ADR-0056）**：離線留言暫存、線上狀態廣播、WebRTC 初始 SDP 信令交換。
- **引擎 B — WebRTC（P2P）**：雙方上線並完成 SDP 交換後打通資料通道，後續即時互動繞過中繼站。

## 3. 模組與目錄落點

| 模組 | 目錄 | 職責 |
| --- | --- | --- |
| 共用核心 | `packages/core/` | Nostr 事件建構/驗證、簽章（secp256k1 Schnorr, BIP-340）、加密（NIP-44）、Gift Wrap 與群組扇出、儲存型別、事件 Kind 常數（含 `NUDGE`，ADR-0120）。跨平台共用，**SSOT 邏輯所在**。零 UI 依賴。 |
| 通訊引擎 | `packages/engine/` | **可用的通訊後端（ADR-0074）**：`ChatBackend`/`ChatBackendEvents` 契約＋UI DTO、`RelayChatBackend`（真實 relay pool）/`BrowserChatBackend`（記憶體 demo）、WebRTC、`AppStorage`/`LocalStorage`、多身分/搬家/快照。與 UI 框架無關，供任意前端重用（desktop 與 mobile 皆消費）。 |
| 桌面前端 | `apps/desktop/src/` | React/TS UI：好友列表、對話視窗、狀態列、Nudge 動畫。消費 `@cinderous/engine`；平台基質（Tauri 金鑰庫/加密儲存）經 `AppStorage`/keyvault 介面注入。**同一份 `vite build` 亦為瀏覽器版**：`isTauri()=false` 走 web 路徑（金鑰以 Argon2id 本地密碼包裹存 localStorage，ADR-0112/0122），可自架於獨立子網域（ADR-0147，見 `docs/self-hosting-web-app.md`）。 |
| 桌面原生橋 | `apps/desktop/src-tauri/` | Rust：**為引擎提供原生能力**（非重造通訊，ADR-0105）——`encstore`（AES-256-GCM 加密 blob）、`passlock`（Argon2id 本地密碼＋救援）、`keyvault`（OS 金鑰庫）、`partfile`（部位檔的原子寫入／檔名白名單／毀損隔離，ADR-0119）、IPC。中繼連線/Gift Wrap/WebRTC/狀態機**留在 `packages/engine`（TS）**；原本的 Rust 背景連線與 SQLite（ADR-0019/0020）已於 ADR-0105 退役。 |
| 行動端 | `apps/mobile/` | react-native-web：接**真實中繼**（ADR-0086），重用 `@cinderous/core`/`@cinderous/i18n`/`@cinderous/engine`/`@cinderous/theme`。儲存走加密 localStorage＋OPFS 封存；「記住我」以 Argon2id 包裹 nsec（ADR-0117）。**不做推播（APNs/FCM）**（ADR-0116）。 |
| 官方網站 | `apps/website/` | 純靜態站（Vite+React；ADR-0090）：開源/永久免費/隱私主張、下載、捐款導流、**簽章式資金透明度**（`funds.json` 前端 `verifyFunds` 對釘死透明度公鑰驗簽＋算 runway，fail-closed）。**與通訊平面硬隔離、零追蹤、無常駐後台**；重用 `@cinderous/core`（驗簽）/`@cinderous/theme`/`@cinderous/i18n`。 |
| 中繼站 | `relay/` | Cloudflare Worker + **Durable Object 內建 SQLite**（ADR-0056）：Nostr relay，處理 Ephemeral 轉發與 NIP-40 過期留言；NIP-42 AUTH ＋具名訂閱 ACL（ADR-0057／0123）。`RelayCore` 傳輸無關，可自架於 Node/Deno/Bun/Docker。 |
| 測試 | `tests/` | 跨層整合測試與共用 fixture。 |
| 文件 | `docs/` | 設計決策與流程補充。 |

> 分層原則：TS 共用邏輯一律收斂到 `packages/core/`，不要在 UI 與 Worker 各自重造一份 Nostr/加密邏輯（避免多重 SSOT）。

## 4. 身分與資料模型

- **身分**：首次啟動生成 secp256k1 金鑰對（Nostr/NIP-01，簽章採 BIP-340 Schnorr）；公鑰 `npub` 為全網唯一 ID。私鑰**桌面**寫入 OS 安全儲存（Keychain/Credential Manager/Secret Service，ADR-0053）、**web/mobile** 以 Argon2id 本地密碼包裹（ADR-0112／0117／0122）。**協定層不提供金鑰輪替/撤銷**（取捨見 PRD §4、§7；企業範圍的名冊輪替見 §8）。多身分以 pubkey 命名空間隔離（ADR-0045）。
- **加密儲存（SSOT）**：好友（npub、顯示名稱、上線狀態）、對話訊息（明文僅存本機）、設定、聯絡人同意/**訊息請求**（ADR-0121）/封鎖清單、群組。狀態常駐記憶體＋逐部位加密持久化（ADR-0110，桌面 AES blob 檔／web/mobile 加密 localStorage）；超出熱區上限的舊訊息移入**封存**而非刪除（ADR-0111，OPFS/塊檔）。對外傳輸前一律以 NIP-44 加密。
- **換機搬家（配對克隆）**：實作採 **WebRTC 配對傳輸**（ADR-0072／0118）——舊機產生一次性載荷（會合 relay ＋ 一次性 AES-256-GCM 金鑰），新機貼上後經 WebRTC 打通、把全量捆包（身分＋聯絡人＋熱區歷史）端到端加密傳輸，雙方比對 **SAS** 相符才送出。（早期規劃的「QR＋LAN 內網 IP＋Happy Eyeballs 競速」未實作。）行動端送出端亦已補上（ADR-0118）。
- **多設備同步（持續）**：各設備就「新訊息、已讀位置、聯絡人/封鎖變更」持續對帳（自封 NIP-17 同步事件、ADR-0107；加密雲端快照、ADR-0071）。訊息以 rumor.id 去重；已讀水位本機持久化（ADR-0108）。**自訂資產庫（emoji/貼圖）與刪除墓碑亦隨雲端快照跨自己裝置同步（LWW＋墓碑交換律、重匯自動復活，ADR-0224）；大 emoji blob 不進快照，改「向自己 backfill」（`ASSET_REQUEST` 定址給自己 pubkey、任一持有裝置回應）。**

## 5. 事件契約（Nostr Kind 對照）

> 內容一律 NIP-44 加密；私訊以 NIP-17（kind 14 → kind 13 seal → kind 1059 Gift Wrap）隱藏收發雙方。中繼站要求 **NIP-42 AUTH ＋ 具名訂閱**（帶 `#p`／`authors`，ADR-0057／0123）。持久化事件可要求 NIP-13 PoW（`minPow`，**生產目前未強制**）並設每 pubkey 速率/大小上限與訂閱數上限（ADR-0119）。

| 功能 | Kind | 持久化 | 機制 |
| --- | --- | --- | --- |
| 離線文字留言 | 1059（Gift Wrap，內含 13/14） | DO SQLite（NIP-40，7 天過期） | NIP-44 加密 + Gift Wrap 隱藏雙方後存中繼，對方上線拉取解密 |
| 好友上線/離線 | 20000（**無內容存活信標**，ADR-0129） | 否（Ephemeral） | **自適應心跳**：活躍 60s／閒置 300s（ADR-0109；±抖動模糊時序，ADR-0088 (d)）；在線判定讀對方**自報節奏**（ADR-0119）。**ADR-0129：心跳降為無內容信標，只證明「在線」＋節奏**——`s/m/np` 移出明文，改走封裝（見下列）。P2P 卸載（ADR-0088 (e)）：資料通道已開時走 P2P 直送；全聯絡人皆有 P2P 時抑制 relay 信標。**隱身**：完全不廣播 |
| 在線狀態內容（狀態/自訂文字/音樂，✅ ADR-0129） | 21004（**NIP-59 包封**）／P2P 資料通道 | 否（Ephemeral） | `{s,m,np}`（狀態／「我在發呆」／正在聽的音樂）改走**封裝**：P2P 的聯絡人走資料通道；**在線✕無P2P** 的聯絡人收 kind 21004 封裝事件，**只在改變時與對方剛上線時發**。relay 只看到臨時作者＋收件人，**內容全密文**——不再明文洩漏你的狀態文字與音樂 |
| 正在輸入中（✅ F5 卸載） | 20001 或 P2P DataChannel | 否（Ephemeral） | 對話視窗觸發；**P2P 通道已開時走 Data Channel 卸載中繼**，否則走 kind 20001 中繼轉發（ADR-0006 F5） |
| WebRTC SDP 交換 | 21000-21999（NIP-59 包封） | 否（Ephemeral） | 信令交換，純記憶體轉發，避免洩漏「誰呼叫誰」 |
| 震動（Nudge） | — | — | WebRTC Data Channel；P2P 不可用時降級走中繼 |
| 檔案傳輸（✅ A4；F3/C4 二進位） | — | — | WebRTC Data Channel，不受 JSON 大小限制；對稱 NAT 經 TURN 保底。桌面前端已接（`WebRtcTransfer`：附件/拖放、進度、下載），信令走 kind 21000（ADR-0017）。分塊改**二進位框架**（去 base64 ~33%，ADR-0029） |
| 訊息回應（Reaction，✅ M6） | 1059（內含 kind 7） | 依訊息 | NIP-25 emoji 回應，`e` tag 指向目標訊息，Gift Wrap 隱藏雙方（已實作，見 ADR-0011） |
| 收回訊息（Unsend，✅ M6） | 1059（內含 kind 5） | 短期 | NIP-09 刪除，`e` tag 指向目標；收件端顯示「訊息已收回」（已實作，見 ADR-0012） |
| 正在輸入中／敲一下（✅ 封裝） | 20001／20100（**NIP-59 包封**） | 否（Ephemeral） | ADR-0120：改為 `sealAndWrap`——外層一次性臨時金鑰簽名，中繼看不到寄件人（原本以真名廣播指名事件，可靠時間相關反推 Gift Wrap 寄件人）。訂閱只靠 `#p`；只收聯絡人（防騷擾） |
| 限時訊息（Disappearing，✅ M6） | 1059（rumor 內帶較短 NIP-40） | DO SQLite 至過期 | 送訊即帶較短過期：rumor 內層 `expiration` 供收件端到期隱藏，外層 wrap 同步縮短以利中繼清除；客戶端到期顯示「訊息已到期」（已實作，見 ADR-0013） |
| 語音訊息／貼圖（規劃 M7） | WebRTC / 1059 | P2P 優先 | 錄音與媒體複用檔案分塊傳輸；貼圖以 `pack/id` 參照客戶端渲染 |
| 群組聊天（✅ M9） | 1059（內含 kind 14 + `g` tag；控制為 kind 40） | 短期 | Gift-Wrap 成對扇出：群訊對每位成員各發一個 Gift Wrap（`g` tag = groupId）；控制訊息 create/add/remove/leave。對中繼完全不暴露群組/成員；移除即扇出略過、免 rekey（`group.ts`，ADR-0027） |
| 語音/視訊通話（✅ M8） | 21002（NIP-59 包封） | 否（Ephemeral） | 通話控制 invite/accept/reject/hangup/candidate（`call.ts` 狀態機 + `WebRtcCall` 執行期）；媒體全程 P2P WebRTC track（DTLS）。假音源 + 真實 relay/WebRTC E2E 驗證（ADR-0025/0026） |
| 訊息請求（✅ ADR-0121） | 1059（一般私訊即是） | DO SQLite（NIP-40） | 陌生人的訊息進**訊息請求區**而非聯絡人清單；接受前不通知、不能 nudge、看不到你上線。訊息本身仍會抵達中繼（Nostr 擋不掉），此為客戶端顯示層防禦 |
| 群組檔案（✅ ADR-0124） | 1059（內含 kind 14 + `g` + `file` tag） | 短期 | metadata 扇給每位成員（共用 rumor 與 tid），位元組各自走 P2P（明文不上中繼） |

## 6. 第一個功能（M1）：Nostr 中繼連線與心跳

**目標資料流**：

```text
本機金鑰 ──簽署──> Kind 20000 心跳事件 ──WebSocket──> Cloudflare Relay
                                                          │（Ephemeral：純轉發，不寫持久層）
好友端 UI <── 渲染上線狀態 <── 訂閱接收 <───────────────────┘
（自適應心跳：活躍 60s／閒置 300s，ADR-0109；在線判定讀對方自報節奏，ADR-0119）
```

**範圍**：relay WebSocket 連線管理、最小 secp256k1 Schnorr 簽章、Kind 20000 心跳發送與訂閱、上線/離線狀態判定與 UI 渲染。
**依賴**：最小金鑰生成（簽章用）。完整身分流程與多設備同步屬後續里程碑。

## 7. 里程碑

> 狀態圖例：✅ 完成且有測試覆蓋；⏳ 尚待特定執行環境（如 TURN 中繼保底、行動端 EAS 原生建置的
> OS 級能力）。**真實 WebRTC（`RTCPeerConnection`/ICE）通話與配對已運作**；**中繼已部署生產**
> （DO SQLite）；「關窗仍在線」以系統匣隱藏達成，Rust 背景連線模組已於 ADR-0105 退役。

- **M0**：文件與專案骨架、pnpm monorepo、ADR 機制。✅
- **M1**：Nostr 中繼連線與心跳。✅ 核心（金鑰/事件/簽章/自適應心跳/上線判定、relay 協定與 Ephemeral 扇出、TS RelayClient、端到端測試）＋ OS 金鑰儲存 ＋ **Worker 已部署生產**。「關窗仍在線」以系統匣隱藏達成（ADR-0105）。
- **M2**：離線文字留言（NIP-17/59 Gift Wrap、NIP-44 加密、NIP-40 過期）。✅ 核心＋收發 UI＋**DO 內建 SQLite 持久化**（ADR-0056，已部署生產）。
- **M3**：WebRTC P2P 直連（SDP 信令、Nudge 震動、檔案傳輸）。✅ 核心＋**真實 `RTCPeerConnection`/ICE 已運作**（通話、配對搬家皆走真實 WebRTC）；⏳ TURN 中繼保底（NAT 穿透失敗時）。
- **M4**：換機搬家（配對克隆）。✅ **WebRTC 配對傳輸 ＋ SAS 互認**（ADR-0072），桌面與行動端送出/匯入皆已接（ADR-0118）。（早期規劃的 QR＋LAN＋Happy Eyeballs 未採用。）
- **M5**：經典體驗還原（音樂狀態、正在輸入中）與行動端。✅ 核心＋**行動端已實作**（react-native-web，與桌面共用引擎）；⏳ 由系統媒體 API 自動取「正在聽」（目前手動輸入）。

> 以下為借鏡 LINE 熱門功能的路線圖——**M6–M9 皆已實作（✅）**，見 `docs/adr/0010`：

- **M6**：訊息互動——訊息回應（NIP-25）、收回訊息（NIP-09）、限時訊息（NIP-40 較短過期）。✅
- **M7**：富媒體——圖片/媒體相簿（複用檔案傳輸 + 本機媒體庫）、貼圖包（內建＋自製）。✅；⏳ 語音訊息錄製（行動端待原生錄音）。
- **M8**：語音/視訊通話——WebRTC media track（P2P）、通話控制信令（kind 21002）、通話 UI。✅（真實 relay/WebRTC E2E）；⏳ TURN 保底。
- **M9**：聯絡人與群組——QR 加好友（`npub` 交換）、群組聊天（✅ Gift-Wrap 成對扇出，ADR-0027；3-context 真實 relay E2E、成員管理）。✅

> **M9 之外（✅ 已實作）：** 多身分、頭像廣播、暱稱/標籤、上線狀態本機還原/自訂狀態文字、對話背景、加密便條、輔助面板（媒體/對話串/便條），以及**企業模式**（§8：組織名冊、邀請碼入職、金鑰託管＋離職接管、公司設定/下班靜音、保留天數、公司儲存槽；桌面＋行動端）。

## 8. 企業模式資料流（自架封閉節點 + 多身分）

> 產品需求見 `PRD.md §13`；決策見 `docs/adr/0044`（封閉 allowlist）、`0045`（多身分）、`0046`（成員判定與邊界）。此節記錄模組落點與資料流，隱私鐵則不變。

**中繼端 — 發布 allowlist（封閉節點）**
- `relay/src/relay-core.ts`：`RelayCoreOptions.allowedAuthors`（hex pubkey 集合）。`handleEvent` 於**驗簽後、寫庫/扇出前**檢查 `event.pubkey ∈ allowlist`；非成員的任何事件（含心跳 20000）回 `OK false "blocked:"`（永久拒絕）。未設＝開放中繼。
- 「外部客戶不進系統」在**內容層**由此成立；讀取層由企業自架於私網/VPN 把關（無 NIP-42 亦足夠，且取到皆 E2E 密文）。

**自架外殼 — 與 Cloudflare 解耦**
- `RelayCore` 為傳輸無關；`relay/src/worker.ts` 僅注入 Cloudflare `WebSocketPair`。自架＝以 Node/Deno/Bun/Docker 的 WS server 包 `RelayCore`（`relay/src/dev-server.ts`、`in-memory-network.ts` 已示範 Worker 外執行）。

**客戶端 — 多身分與資料隔離**
- `packages/engine/src/storage/profiles.ts`：全域設定檔登錄（`nb.profiles`＋作用中 pubkey）；首次載入把既有單一身分遷移為 namespace 為空的 legacy 設定檔（向後相容）。（ADR-0074 起隨引擎抽出至 `packages/engine`。）
- `packages/engine/src/storage/local.ts`：`LocalStorage(namespace)` 以 `nb.<pubkey>.<key>` 隔離各身分資料（聯絡人/訊息/群組/自訂資產庫 emoji＋貼圖…），空 namespace＝舊鍵；web 以 nsec 導出金鑰加密、Tauri 走 Rust AES-256-GCM（ADR-0112/0054）。自訂資產庫（emoji＋貼圖，ADR-0220）存於 `customAssets`＝每身分加密落地；自訂 emoji 走既有加密訊息通道，內容尾端附 `nb-assets:v1:{shortcode:{label,svg}}` 行內清單。大動畫 GIF 走內容定址 blob（`assetBlobs`＋清單只帶 `ref`，backfill/推播，ADR-0223）。跨裝置：庫（含 `assetTombstones` 刪除墓碑）隨加密雲端快照同步、大 blob 向自己 backfill（ADR-0224）。
- `apps/desktop/src/App.tsx`：`buildBackend(profile)` 依身分建立後端——**工作身分（enterprise）鎖定單座**（不給 `connectorFor`/`anchors`/`onHomeSwitched` → 不漫遊、不遞補，ADR-0044/0045）；個人身分走開放模式（relay pool/錨點/漫遊）。切換身分以 reload 乾淨重建 per-身分 狀態。

**資料流（工作身分送一則群訊）**
`App → buildBackend(工作profile, 鎖定) → RelayChatBackend(LocalStorage(pubkey)) → Outbox 節流扇出 Gift Wrap → 公司自架 RelayCore（allowlist 驗 pubkey）→ 只轉發給名單內成員`。中繼全程只見密文與成員 pubkey，看不到群組/內容/串結構。

**身分輪替（ADR-0052）— 換機/遺失還原，無金鑰託管**
- 名冊契約：`OrgMember.supersededBy`（舊 npub 指向新 npub）。`rosterAllowlist` 排除已作廢舊金鑰；`rosterRemap` / `diffRoster().toRemap` 解出「舊→新」對映（支援連鎖 A→B→C、防環）。
- 客戶端：`RelayChatBackend.applyRotations` 於採用名冊時把本機聯絡人/群成員與 1:1 歷史從舊 npub 接續到新 npub（`AppStorage.remapContact`），回報 `onIdentityRotated`（UI 提示「◯◯ 已更新金鑰」）。管理者以 `applyRosterRotations` ＋佈建 UI 輪替欄構建名冊並 `publishRoster`。
- 隱私：員工新金鑰**自產**、公司無解密後門；「不想丟歷史」＝建議雙設備登記（M4 冗餘），非托管。詳見 PRD §13.6。

## 9. 待決議（Open Questions）

- ~~中繼站採自建 Worker relay 還是相容既有 Nostr relay？~~（已定案 ADR-0005：**自建 Worker relay**，且客戶端與任何標準 Nostr relay 互通，ADR-0034。）
- ~~`packages/core` 的加密原語選型與跨平台一致性？~~（已定案：core 用 `@noble/*`（TS）、Rust 用 `aes-gcm`/`argon2`/`sha2`（純 Rust、免 OpenSSL）；SSOT 在 `packages/core`。）
- ~~monorepo 工具與行動端共用程度？~~（已定案：**pnpm workspace**；行動端共用 core/engine/i18n/theme，ADR-0086。）
- ~~各平台版號分歧、runtime 無版號、無 release note？~~（已定案 ADR-0227：**版號 SSOT＝root `package.json`**，`pnpm run version:sync` 同步四端 app＋desktop 三處，CI `version:check` 防漂移；runtime 經 vite `define __APP_VERSION__`；release note 單一雙語來源 `docs/releases.json`——app 依 locale 顯示、`release-notes.mjs` 生成 GitHub release 雙語 body。）
- ~~Ephemeral 心跳的容量估算與批次/合併？~~（已由 ADR-0109 定案並實作：**自適應心跳 60/300s ＋ 合併 REQ ＋ 增量收件箱**，取代 ADR-0006 的 30s。）
- **（仍開放）** 是否導入棘輪（Double Ratchet）以取得前向保密／後妥協安全，或維持 Nostr 靜態金鑰模型？
- 多設備同步的衝突解法：訊息以 rumor.id 去重、已讀水位 LWW（ADR-0108）已定；其餘可變狀態的 CRDT 化仍可評估。
- ~~群組加密方案？~~（已定案 ADR-0027：Gift-Wrap 成對扇出；MLS 延後。顯示名稱走加密個人檔 kind 已實作，ADR-0061。）
- **（仍開放）** 語音訊息（M7）離線傳遞受中繼大小限制時的退回策略；**心跳真名廣播＋訂閱洩漏聯絡人**的結構性隱私修法（ADR-0120／0123 已記為已知限制，待專門 ADR 權衡成本）。

> 已定案決策見 `docs/adr/`（例如 `0002` 隱私元資料與協定基線、`0010` LINE 借鏡功能路線圖）。
