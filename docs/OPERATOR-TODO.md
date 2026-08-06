# 操作者待辦清單（需要人親自執行的部分）

> 程式碼已完成的功能，有些需要「人類持有的信任根、外部帳號、或密鑰」才能真正上線。
> 這裡集中列出**只有你能做**的步驟。程式端已預留佔位／留空＝維持現行行為，填入前不影響既有功能。

---

## A. 混合式引導路由上線（ADR-0039）— Node1 下架時自動遷移

要讓「單一中繼站下架、AB 零動作自動改走其他節點」真正生效，需完成以下。**全部留空時＝現行單/多 relay 行為，不會壞。**

### A1. 部署錨點 relay（2–3 座，綁定專屬網域）
- 依 Phase C（ADR-0005）把 `relay/` 的 Worker 部署到 Cloudflare，**綁定至少 2 個獨立網域**（避免單一網域被扣押/DNS 污染仍是 SPOF）。
  - 需要：Cloudflare 帳號。指令：`cd relay && npx wrangler deploy`（先設定 `wrangler.toml` 的路由與 D1 綁定）。
  - 例：`wss://relay.你的網域.tw`、`wss://relay2.你的網域.tw`。

### A2. 產生維護者簽章金鑰（清單的信任根）
- 產一組 Nostr 金鑰，**私鑰（nsec）絕不外流**、公鑰（hex）填進客戶端。
  - 可用 App 內任一帳號的金鑰，或另產專用金鑰（建議專用）。
  - 取得公鑰 hex：登入後在「我的 ID」看 npub，或用 core 的 `npubDecode`。

### A3. 填入客戶端設定 `apps/desktop/src/bootstrap-config.ts`
```ts
export const ANCHOR_RELAYS = ["wss://relay.你的網域.tw", "wss://relay2.你的網域.tw"];
export const MAINTAINER_PUBKEY = "你的維護者公鑰 hex（64 字元）";
```

### A4. 設定 GitHub Secret（讓 Actions 能簽章＋發佈清單）
- Repo → Settings → Secrets and variables → Actions → New repository secret：
  - Name: `MAINTAINER_NSEC`
  - Value: 你的維護者私鑰 nsec（**與 A2 對應**）
- 確認 repo 的 Actions 已啟用、且 workflow 有 `contents: write` 權限（`.github/workflows/relay-health.yml` 已宣告）。

### A5. 填入初始節點清單 `relay/bootstrap/relays.json`
```json
{
  "relays": ["wss://relay.你的網域.tw", "wss://node2.某社群.com"],
  "entries": [
    { "url": "wss://relay.你的網域.tw", "weight": 2 },
    { "url": "wss://node2.某社群.com", "accepting": false }
  ],
  "updatedAt": 1
}
```
- `entries`（ADR-0069，可省略＝全預設）：`accepting: false`＝停收新帳號分配（額度吃緊）、
  `weight`＝自動分配權重、`status: "draining"`＝計劃退役（既有用戶分批自動搬走）、
  `"retired"`＝已退役（免探測、保留於清單讓客戶端學到）。
- Cron（每小時）會自動 REQ→EOSE 探測、剔除逾時者、簽章並**發佈到每座健康 relay**（客戶端連上即學到）。
- 想立刻跑一次：GitHub → Actions →「Relay 健康檢查」→ Run workflow（`workflow_dispatch`）。

### A6. 驗證上線
- 本機模擬：`PORT=8899 node relay/dist/dev-server.js` 起一座、把它填進 relays.json、
  `MAINTAINER_NSEC=<nsec> pnpm --filter @cinderous/relay bootstrap:run`，
  應看到 `✅ 探測` → `已簽章 kind 10037` → `📡 發佈至 …`。
- 真機：兩台裝置填好 A3 設定，其一 home 指向會下架的節點，關掉該節點後觀察訊息是否仍送達（經錨點），5 分鐘後 home 是否自動遞補（設定面板連線狀態）。

> **物理極限（任何方案都一樣）**：A、B 兩端都要跑「填好 A3 設定」的新版；下架節點上**尚未取件的離線留言**會隨之消失（NIP-40 本來也只存 7 天）。

---

## B. 此環境（雲端沙箱）無法執行、需你在對應環境完成的事

> 以下皆非程式缺口——**程式已完成並全綠測試**，只是最後一哩需要 Tauri/Cloudflare/RN 工具鏈、外部帳號、實體伺服器或外部人員，此開發環境做不到。

| 項目 | 需要 | 對應 | 現況 |
| --- | --- | --- | --- |
| 中繼站生產部署 | Cloudflare 帳號、`wrangler deploy`、D1 綁定、NIP-42 AUTH | Phase C（C1–C4） | 程式/測試已備，離線留言待接 D1 |
| **Android release 簽章** 🔴 | 產一把 release keystore（`keytool -genkey -v -keystore <名>.jks -keyalg RSA -keysize 4096 -validity 10000 -alias cinderous`）→ 在 `apps/mobile/android/app/build.gradle` 補 `signingConfigs.release`（密碼走 `local.properties`／環境變數，**不進版控**）→ 發版改跑 `assembleRelease` | ADR-0335 | **目前出貨的 APK 是 Android 預設 debug 憑證簽的**（`CN=Android Debug`，每台開發機都同一把）⇒ 安裝時開發者顯示**不明**；🔴 **更嚴重的是 `application-debuggable`**——任何能接上 adb 的人可附著到行程讀記憶體，而 session 期間 nsec 與 EK 私鑰必然在裡面，**直接抵銷一大部分 at-rest 保護**。⚠ **不是本次迴歸**，自 Android 首發（v0.0.14）就是如此，只是先前沒被記錄。🔴 **產金鑰前先想清楚**：一旦用某把 keystore 發布過，**之後每版都必須用同一把**——換金鑰的 APK 無法覆蓋安裝，使用者得先解除安裝、**該裝置資料全失**（預設純本機，沒開備份的人救不回來）。這把金鑰的備份重要性等同 nsec。⚠ **不得為了「先讓它能簽」而用臨時金鑰發布**——那等於提前鎖死一把不打算長期保管的金鑰。（使用者已指示：**現在先不產**，缺口先記錄與揭露） |
| **Android 裝置金鑰外掛真機驗證** | 一台 Android（最好兩台：有 TEE／無 TEE） | ADR-0323 | 外掛（`DeviceKeyStorePlugin.java`）＋JS 橋＋註冊皆已落地，**原始碼紅線測試與橋接測試綠**。要驗三件事：①有 TEE／StrongBox 的機型顯示 `keystore`、軟體實作的顯示 `encrypted`（**不得混講**）②StrongBox 不可用時退回一般 TEE 不當機 ③**由舊版明文升級**時金鑰搬進 Keystore 且**裝置身分不變**（掉了就要重新授權） |
| **離職接管真機驗證** | 一組企業主＋員工帳號（需真的入職＋託管事件） | ADR-0163／0179／0332 | 程式已完成。jsdom 造不出託管事件（要企業主端真的收到 `onOrgEscrow`）⇒ 這條登入路徑（`overrideRelay`＋`forceInvisible`）**沒有自動覆蓋**，而 ADR-0332 的控制流反轉動到它共用的那條路。要驗：接管後**建構即隱身**（首拍心跳不得廣播離職身分上線） |
| **配對搬家匯入真機驗證** | 兩台裝置（真 WebRTC） | ADR-0072／0125／0332 | 同上——`bundle` 這條登入路徑無法在 jsdom 驅動。要驗：SAS 兩端一致、捆包完整搬移（聯絡人／歷史／群組／企業精華）、**新機的裝置公鑰回傳讓舊機自動授權**（ADR-0322 S5） |
| 🔴 **通話視訊功能真機驗證（v0.0.16 候選）** | **兩台**真機（建議一手機一桌機），且**兩台都要各當一次主叫與被叫** | ADR-0337／0338／0339／0340 | **程式已完成、全測綠**，但 🔴 **測試驗的是我方實作符合我對 WebRTC 規格的理解，不是瀏覽器真的那樣行為**——替身是自己寫的 `FakePc`。整套設計壓在兩個規格細節上，其中第二個**錯了也不會報錯**。詳見下方 §B-Call 的逐條步驟。**未完成前不建議發版。** |
| **桌面通知點擊 action** | 打包版（`tauri:build`）＋各 OS | N3 | 程式已完成（`focus_window` IPC＋`onNotificationClick`）。**通知顯示本身不受影響**，待確認的是各 OS 對點擊 action 的支援度 |
| **瀏覽器裝置金鑰保管庫（IndexedDB）** | 任一瀏覽器 | ADR-0323 | 加解密與失敗方向已以記憶體 `WrapStore` 測到；**`idbWrapStore()` 那層薄接線未自動測試**（Node 無 IndexedDB，**刻意不引入 `fake-indexeddb` 相依**）。要驗：重開瀏覽器後裝置身分不變、清網站資料後乾淨重生 |
| **中繼分片上線** | `wrangler deploy` 最新 worker（分片路由：`/s/<prefix>`＋`/presence`） | ADR-0241 | 客戶端**預設開分片**（`shardingEnabled` 預設 true）。worker 路由 **backward-compatible**——舊 worker 對 `/s/` 仍回退 global、不壞（只是不真的分片）；deploy 最新版後 `/s/`／`/presence` 才真正路由到分片/presence DO。pre-release 幾乎無使用者 → 直接切換、不需雙讀遷移。kill-switch＝`localStorage nb.sharding=0` |
| **雲端快照上線** | ~~`wrangler deploy`~~ ✅ **已部署（2026-07-10）** | Phase J（ADR-0071） | 生產已上線並實測：取代語意（同 `d` 只留最新）、purge 零殘留、**隱私閘門**（他人已認證仍讀不到你的快照）皆通過。**企業自架 relay 注意**：若有設 `allowedKinds`（G2 政策），需把快照 kind **30078** 加入名單，否則政策允許備份時 relay 仍會默默拒收 |
| Tauri 桌面**簽章/自動更新** | Windows 程式碼簽章憑證（Authenticode）；（更新用）updater 金鑰＋更新託管端點 | Phase B ③ | B1 殼/B5 金鑰庫/B6 安裝檔/系統匣背景皆已 **Windows 實機完成**；僅剩**未簽章**（SmartScreen 警告）＋無自動更新，步驟見下方 §B-Tauri |
| 行動端 + QR 相機掃描 | React Native 工具鏈、APNs/FCM 憑證、相機權限 | Phase D、M9 | 大量重用 core/i18n；QR 產生已完成、掃描待 RN |
| **企業強制 TURN 真機驗證** | 部署 TURN 伺服器、把 `turnServers` 填入 `RelayPoolOptions` | G2（ADR-0048） | `forceTurn`→`iceTransportPolicy:"relay"` 程式已接（`buildRtcConfig`），缺 TURN 才能實測；同時作為通話 NAT 保底 |
| ~~**公共 TURN 保底上線**~~ ✅ **已上線（2026-08-06）** | ~~Cloudflare 開 TURN app～~ | ADR-0243、ADR-0336、**ADR-0342** | **兩座錨點皆已部署最新 worker 並實測通過**（`cinderous1` 版本 `28b32a8a`、`jt0856` 版本 `5168b775`）。線上驗證結果（各連打 5 次）：無授權 → **401**；對別的 URL 簽的授權 → **401**；合法簽章 → **200** ＋ `ttl:300` ＋ 4 個 ICE URL ＋ 64/64 憑證。<br>**ADR-0336 四項前置全數完成**：<br>① `TURN_TTL_SECONDS = "300"`（兩座 vars 皆帶上）✅<br>② `/turn` 閘門 ✅ ——⚠ **實作機制與 ADR-0336 §3.2 原案不同**（改為 NIP-98 簽章＋Workers `ratelimit` binding 20/60s，理由與取捨見 **ADR-0342 §3**）<br>③ 計費預算警示 ✅ **由操作者於 Dashboard 設定並回報完成**（此環境無法驗證）——⚠ Cloudflare **沒有**以 GB 為單位的 Realtime 通知類型，實際用的是「**計費預算警示**」；因正常使用恆為 $0（免費額度 ~11 萬語音通話小時），**任何計費本身即異常訊號** ⇒ 門檻應設 UI 允許的最小值而非 $10。🔴 **警示只通知、不會停**（Realtime 無硬性支出上限）⇒ 一併確認該帳號付款方式：未綁卡時超額通常直接停服務，對此用途反而較安全<br>④ 裝置層 `allowPublicTurn`（預設開）＋雙端設定頁取捨文案 ✅<br>⓪ **順帶修掉一個由①造成的迴歸**（ADR-0342 §1）：客戶端刷新間隔原本**寫死 6 小時**且回應無 `ttl` 欄位，TTL 一縮短憑證就在客戶端不知情下過期 ⇒ Worker 現在回傳 `ttl`、客戶端依 `ttl/2` 重排。<br>⚠ **兩座共用同一把 TURN key**（`99042103…`）⇒ 用量與帳單全記在 key 擁有者帳號；**警示只需設在那一個帳號**（不確定是哪個就兩個都設）。<br>⚠ 剩餘：**客戶端這條路只有單元測試涵蓋**，見下方 §B-Turn |
| 第三方安全稽核 | 外部稽核員 | F4（`docs/SECURITY.md` 已備前置） | 前置威脅模型/加密盤點已備 |
| **前向保密（FS）外部審計＋上線** | 外部密碼學審計員 | ADR-0245（Phase 3） | **引擎已實作（Phase 0–2、全測綠、opt-in）**。輪替加密子鑰、retarget Gift Wrap、10040 PKI、多裝置 EK 同步、grace 刪除、降級偵測皆完成。🔵 **2026-08-05 校正（本列原本已過期）**：`fsUiEnabled` 隱藏閘門**已於 ADR-0306 移除**（2026-07-31）——該 ADR **明文推翻** ADR-0245「審計通過前不得產線啟用」，改為**實驗性選項、預設關、啟用時明示未經審計**。本列原本寫的「UI 預設對使用者隱藏（設 `localStorage nb.fs=1` 才顯示）」在程式碼裡已經不存在。⚠ **維持不變的硬閘只剩文案**：不進功能表／比較表／行銷文案（ADR-0306 D2.2）。⇒ 外部審計仍是待辦，但它**不再是上線閘門**，而是 `fs-review-deadline.test.ts` 釘住的複查項（2027-01-30 到期弄紅 CI） |
| 企業 SSO / 元資料稽核 | 外部 IdP（AD/LDAP/OIDC）、自架 relay 記錄連線元資料 | G5 | 需先立 ADR 與環境；未動工 |

### §B-Call：通話視訊功能實機驗收（ADR-0337／0338／0339／0340）

> 全部要**兩台**裝置。🔴 **每一項都要兩台各當一次主叫與被叫**——見下方「為什麼」。

#### 🔴 為什麼順序與角色很重要

整套設計壓在兩個 WebRTC 規格細節上：

1. **`replaceTrack` 在軌道與已協商媒體相容時不需要重新協商。**
   我們據此在建立通話時就**預先鋪好視訊軌道**（即使是語音通話，只是不接相機），
   之後開視訊只要「換水源」⇒ 沒有 SDP 交換、沒有 glare。這一條錯了，開視訊會整個失敗（**看得出來**）。

2. **答方（接電話的人）那邊，瀏覽器自動配的視訊軌道預設方向是 `recvonly`（只收不送）。**
   我們在套用 offer 之後、產生 answer 之前把它改成 `sendrecv`。
   🔴 **這一條錯了不會報錯**：`replaceTrack` 成功、自我預覽正常、沒有任何錯誤訊息，
   **只有對方那邊永遠看不到你**。

⇒ 症狀會是**不對稱**的：「只有打電話的那一方能開視訊，接電話的那一方開了對方看不到」。
只測主叫方會全部通過，上線後才發現一半的人開不了視訊。

#### C1. 🔴 通話中升級（最重要，先做這條）

| # | 步驟 | 通過條件 |
| --- | --- | --- |
| 1 | A 打**語音**給 B，接通 | 兩邊聽得到聲音；**兩邊都不該出現相機權限提示、指示燈不該亮** |
| 2 | **A** 按「開啟我的視訊」 | B 看得到 A；A 有自我預覽 |
| 3 | 同一通，**B** 按「開啟我的視訊」 | 🔴 **A 看得到 B** ← 這條才是關鍵，第 2 條過不代表這條會過 |
| 4 | 掛斷，改由 **B 打給 A**，重跑 2、3 | 同上 |

⚠ 第 1 步的「不該出現權限提示」也要看——那驗的是預先鋪軌道**沒有**順手把相機打開。

#### C2. 降級與相機指示燈（ADR-0340）

| # | 步驟 | 通過條件 |
| --- | --- | --- |
| 1 | 視訊通話中按「關閉我的視訊」 | **相機指示燈熄滅**（不只是畫面變黑）；對方看到頭像＋「對方未開啟視訊」 |
| 2 | 再按「開啟我的視訊」 | 恢復；對方重新看到畫面 |
| 3 | 連按數次 | 不當機；⚠ 若相機啟動延遲明顯到困擾，回報——ADR-0340 §6-5 已預留「加去抖動」的後續 |

#### C3. 切換鏡頭與鏡像（ADR-0339）

| # | 步驟 | 通過條件 |
| --- | --- | --- |
| 1 | 手機視訊通話中按 🔄 | 前後鏡頭切換；**切換過程不得兩個指示燈同時亮**（驗「先取新軌再停舊軌」） |
| 2 | 切到**後**鏡頭，拿去照有文字的東西 | 🔴 **自我預覽的字是正的**（不是左右相反）；對方看到的字也是正的 |
| 3 | 切回前鏡頭 | 自我預覽是鏡像的（照鏡子的直覺） |
| 4 | 桌面接兩台以上攝影機 | 出現「鏡頭」清單且名稱正確；選了會真的換 |
| 5 | 只有一個鏡頭的裝置 | **不顯示**切換入口（不是顯示一顆按了沒反應的） |

#### C4. 畫質三檔（ADR-0337）

| # | 步驟 | 通過條件 |
| --- | --- | --- |
| 1 | 視訊通話中切到「省流量」 | 對方看到的畫面**明顯**變糊；切回「高畫質」明顯變清楚 |
| 2 | 切換時 | 通話不中斷、不重新協商（畫面不該黑掉重來） |
| 3 | 設定頁改預設後重打一通 | 新通話沿用該檔位 |
| 4 | 行動數據下用「省流量」講 10 分鐘 | 用量約 30 MB 上下（三檔的估算值見 ADR-0337 §2） |

#### C5. 舊版相容（若手邊還有 v0.0.15 的安裝檔）

| # | 步驟 | 通過條件 |
| --- | --- | --- |
| 1 | 新版打給舊版 | 通話正常；⚠ 新版開視訊時舊版**看不到**是**已知**的（ADR-0340 §4），不算失敗——但要確認**不會當機或卡住** |
| 2 | 舊版打給新版 | 通話正常，不當機 |

### §B-Turn：公共 TURN 客戶端實機驗收（ADR-0342）

> Worker 端已在線上實測（見上方表格）。**客戶端這一條路只有單元測試涵蓋**——
> 真的簽得出授權、真的拿得到憑證、真的依 300 秒刷新，都還沒在任何真機上跑過。

| # | 步驟 | 通過條件 |
| --- | --- | --- |
| 1 | 桌面/行動端登入後開 devtools 或看網路請求 | 開機後對 `/turn` 發過一次請求，且**回 200 不是 401**（401＝客戶端簽章有問題） |
| 2 | 掛著超過 **5 分鐘** | 🔴 有**第二次**請求（約第 2.5 分鐘）——沒有就是 ⓪ 的排程沒生效，憑證會在使用者不知情下過期 |
| 3 | 在限制較嚴的網路（行動數據／公司網路）撥一通 | 通話接得通；ICE 有 relay 候選 |
| 4 | 設定頁關掉「通話中繼保底」 | 不再對 `/turn` 發請求；⚠ 那之後限制網路下通話**應該打不通**（那正是這個開關的意思） |
| 5 | 再打開 | 立刻重新取得憑證 |
| 6 | 把裝置時間調快/調慢 **2 分鐘**再重開 App | `/turn` 回 **401**、退回純 STUN、**其他功能不受影響**（ADR-0342 §4-4 的已知取捨） |

⚠ 第 2 條最容易被忽略，而它正是 ADR-0342 §1 那個迴歸的迴歸測試。

### §B-Tauri：程式碼簽章與自動更新（Phase B ③）

安裝檔已可產出（`pnpm --filter @cinderous/desktop tauri:build` → NSIS `.exe` + MSI），但**未簽章**、**無自動更新**。要補這兩項（皆需「你持有的信任根」，此環境無法代辦）：

> **決定（2026-07-08）**：**目前不簽章**——開發/自用階段，SmartScreen「未知發行者→仍要執行」可接受，安裝檔照常可用。**未來對外發行時走 SignPath Foundation**（開源專案免費、公信；Cinderous 為 AGPL 符合資格）。自動更新一併等有簽章後再接。

**① 程式碼簽章（去掉 SmartScreen「未知發行者」警告）**
- 取得 **Windows 程式碼簽章憑證**（Authenticode；OV 約 US$100–400/年，EV 較貴但 SmartScreen 信譽較佳）。測試可用自簽（`New-SelfSignedCertificate`），但他人安裝仍會警告。
- 於 `apps/desktop/src-tauri/tauri.conf.json` 的 `bundle.windows` 設 `certificateThumbprint`（或 `signCommand`）→ `tauri:build` 會自動簽 exe/msi/nsis。

**② 自動更新（Tauri updater plugin）**
- 產 updater 簽章金鑰：`pnpm dlx @tauri-apps/cli signer generate`（**私鑰保密**、公鑰填設定；與 Authenticode 無關）。
- 決定**更新託管端點**（放 `latest.json` + 已簽安裝檔的靜態位址，如 GitHub Releases 或自架）。
- 加 `@tauri-apps/plugin-updater` ＋ 於 `tauri.conf.json` 設 `plugins.updater`（endpoints + pubkey），前端接更新流程；`tauri:build` 以 updater 私鑰簽產物，客戶端驗簽後才套用。

**③ 發行前小整理**：✅ **已完成（2026-07-10）**——`identifier` 已改為 `app.cinder.desktop`，本機資料夾已複製遷移（`%APPDATA%` 的 `store/` 與 `%LOCALAPPDATA%` 的 `EBWebView`）；舊資料夾 `app.nostrbuddy.desktop` 保留為備份，於新版實機驗證登入正常後可手動刪除。

---

## C. 版本控制

- 功能開發在分支 `claude/audit-unused-directives-72ftvr`；已多次 fast-forward 合併到 `main`（最新含 Cinderous 更名、@提及、對話串、G2 強制 TURN、M8 來電鈴聲）。
- 後續變更沿用同流程：分支開發 → 驗證全綠 → 經你同意再 `git merge --ff-only` 合回 `main`。

---

## D. 待你裁示才動工的功能（決策卡關，非環境）

- ~~**G4 企業金鑰託管**~~ → **已決策並實作**：否決金鑰托管（避免公司持有解密後門），改採「工作身分輪替」（ADR-0052）。換機/遺失＝管理者以名冊撤舊發新、成員端自動接續；「不想丟歷史」＝建議雙設備登記。
- **M7 語音訊息離線退回策略**：語音檔受中繼大小限制時的退回方式，需定案（`ROADMAP.md` 未決策 ADR）。
- **Discord/Slack 風格功能移植**：研究見 `docs/research/discord-slack-features.md`。其中**對話串（Thread）已實作**（ADR-0051，Slack 式右側面板）、**emoji reaction 已實作**（ADR-0011）；剩餘自訂頻道等仍待裁示才立 ADR。
