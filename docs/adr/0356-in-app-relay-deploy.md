# 0356. App 內建一鍵部署自有 relay（Cloudflare Worker），token 不留在 webview、HTTP 不經 webview

- 狀態：已接受
- 日期：2026-09-17
- 相關文件：`docs/research/one-click-relay-deploy-plan.md`（規劃稿）、
  ADR-0005（自建最小 Worker relay）、ADR-0039（錨點常數＋home 自動遞補）、
  ADR-0045（工作身分鎖單座）、ADR-0059／0006（免費層容量模型）、
  ADR-0065（離線留言壽命上限）、ADR-0066（home relay 搬家＋舊站排水）、
  ADR-0069（自動選座與 durable 搬家）、ADR-0075（容器化自架）、
  ADR-0092＋`docs/NODE-SUBMISSION.md`（節點自報與收錄）、ADR-0112（信任根靜態加密）、
  ADR-0119／0128（可測邏輯住 lib；信任邊界不交給 webview）、ADR-0241（分片路由與跟版義務）、
  ADR-0243／0342（公共 TURN 保底與 `/turn` 防護）、ADR-0260（NIP-11）、
  ADR-0348（CI 編譯 `main.rs` 但測不到它）、ADR-0354（統一節點 Worker）

## 背景與問題

自架 relay 現有三條路（Cloudflare `wrangler deploy`、Zeabur、樹莓派）**全部要求離開產品**：
讀文件、開終端機或 PaaS 後台。對一般使用者而言「擁有自己的節點」實質上不存在——
去中心化是文件裡的承諾，不是產品裡的按鈕。

使用者裁示（2026-08-27）：產品介面新增「一鍵部署」按鈕，點擊後引導完成部署並**把 relay
資訊自動帶回產品**；部署完成後預設以自有站為 home。追加裁示（2026-09-17）：**讓他可選**。

四條硬限制決定了所有設計（查證日期見 §理由）：

1. **第三方 OAuth 在 2026-06-03 才剛開放，且公開客戶端要過審。** 2026-08-27 查證時
   Cloudflare 還沒有第三方 OAuth 管道（wrangler 的 client id 是它自家註冊的）；
   2026-09-17 重新查證發現**已經有了**——自管 OAuth 客戶端上線，官方明說
   「OAuth lets third-party applications act on behalf of a user to access their Cloudflare account」，
   且點名 Workers 部署是適用情境。**但**：客戶端要從 private 轉 public 才能讓任意使用者授權，
   而那需要先滿足前置條件並通過**網域驗證**。⇒ OAuth 是目標，**不是現在就能用的東西**；
   在客戶端過審之前，使用者仍必須手動貼一次 API token。
2. **官方「Deploy to Cloudflare」按鈕強制 clone repo 到點擊者的 GitHub/GitLab 帳號，
   且沒有任何 callback**。⇒ 那條路拿不回部署結果，「自動帶回網址」整段做不到。
3. **`api.cloudflare.com` 不送 CORS 標頭**。⇒ 純瀏覽器環境打不了這組 API。
4. **Workers Script Upload API 走得通**——它就是 `wrangler deploy` 用的同一條公開 API，
   支援 Durable Object 綁定與 migrations。我們的 relay 是單一 SQLite-backed DO、零外部綁定。

## 考量的選項

- **A：包裝官方 Deploy 按鈕**（App 只負責開瀏覽器）——否決：見限制 2，網址回不來。
- **B：App 內嵌 wrangler／Node sidecar**（借 wrangler 自身的 OAuth）——否決：使用者機器
  不保證有 Node；把 Node＋wrangler 打包進 Tauri 的體積與維護成本過高。
- **C：我方架「代部署服務」**（使用者把 token 交給我們的伺服器代打 API）——否決：違反零伺服器
  狀態；等於要求使用者把能操縱其 Cloudflare 帳號的信任根交給第三方。
- **D（採用）：App 內建部署器，直打 Cloudflare REST API**，token 由使用者經官方 template URL
  建立後貼回，全程在裝置上完成。

D 之下還有第二個岔路，才是本 ADR 真正的決定：

- **D1：部署器住 `packages/engine`，由前端直打 API**（2026-08-27 草案）。
- **D2（採用）：部署器住 Rust lib，token 進 OS 金鑰庫，webview 永遠碰不到 token 也碰不到 API。**

## 決策

### 1. 🔴 token 與 HTTP 都留在 Rust（D2）

那顆 API token 是使用者**整個 Cloudflare 帳號的信任根**。讓它**留在** webview，等於任何一個
XSS 都能把它偷走——而 ADR-0128 才剛花力氣不把路徑白名單的鑰匙交給 webview，這裡不該反過來做。

⚠ **誠實範圍**：使用者是在 App 的輸入框裡貼上 token 的，所以它**必然經過 webview 一次**。
做得到的保證是「不留在那裡、之後也讀不回來」，不是「從未碰過」。落實方式：貼上之後立刻
`cf_set_token` 送進 OS 金鑰庫，前端狀態清掉；此後所有呼叫都由 Rust 從金鑰庫取用，
**沒有任何 command 會把 token 回傳給前端**。這與 AI 金鑰的處境完全相同（也是在輸入框裡打的）。

這個專案已經有一模一樣的正解：AI 金鑰走的就是這條路（`ai_set_key` 存進 OS 金鑰庫、
`ai_has_key` 只回布林、金鑰**永不回到前端**、實際 HTTP 由 Rust 的 `ai_generate` 發）。
照抄它，不發明第二套（Fix First）。

| 層 | 放什麼 | 測得到嗎 |
| --- | --- | --- |
| `src-tauri/src/cfdeploy.rs`（lib） | 請求組裝、回應解析、錯誤分型、metadata 產生 | ✅ `cargo test --lib` |
| `src-tauri/src/main.rs`（薄殼） | `cf_set_token` / `cf_has_token` / `cf_forget_token` / `cf_deploy` | ❌（ADR-0348：CI 編譯它但測不到它，故不放邏輯） |
| `packages/engine` | **不放東西**——部署是桌面專屬能力，不污染共用層 | — |

HTTP 以 trait（`CfApi`）抽一層：產線用 `reqwest`，測試用假件 ⇒ 整組邏輯測得到。

**附帶好處**：`tauri.conf.json` 的 `connect-src` **一個字都不用動**。D1 那條路要放行
`https://api.cloudflare.com`，而 CSP 每放寬一次就永久留在那裡。

### 1b. 授權：token 先行，OAuth 留好插座

兩條路的形狀不同，但**後面那一段完全一樣**（拿到一個 bearer 憑證 → 打同一組 API），
所以從第一天就把它抽成 `CfAuth`：

| 變體 | 現在可用？ | 使用者要做什麼 |
| --- | --- | --- |
| `CfAuth::Token` | ✅ **立刻** | 點連結 → 按建立 → 複製 → 貼回 |
| `CfAuth::OAuth` | ⏳ 待我方客戶端過審 | 點「用 Cloudflare 登入」→ 授權 → 回來 |

**先做 token 的理由不是它比較好，是它現在就能動。** OAuth 要我方先註冊客戶端、通過
網域驗證與審核——那是跨組織的等待，不該讓整個功能卡在它後面。把 `CfAuth` 的介面先立好，
OAuth 到位時只是多一個變體，不是重寫。

token 的建立經官方 template URL 預填最小權限（**Workers Scripts:Edit** ＋ 帳號讀取），
把「建立正確權限的 token」從一頁表單壓成一次點擊。UI 明示權限範圍與「可隨時在 Cloudflare
後台撤銷」。留存**可選**：留存 ⇒ 解鎖一鍵更新節點；不留存 ⇒ 用完即丟。

### 2. worker bundle 隨 App 出貨，設定的 SSOT 仍是 `wrangler.toml`

- 來源＝`relay/src/worker.ts`；`esbuild --bundle --format=esm` 實測**單檔 176 KB**。
- 部署用的 metadata **由 `relay/wrangler.toml` 生成**，不得手寫第二份——手寫會漂移，
  而漂移的症狀是「部署成功但行為不對」，比失敗更難查。
- bundle 版本寫進 relay 的 NIP-11 `version`（ADR-0260 已有欄位），供日後一鍵更新比對。
- 統一模式（§5）另外要帶網頁版資產（`resources/web`，以 unified 模式建置）。
  加上 worker bundle，出貨資源共約 **1.4 MB**——等於桌面安裝檔**把自己的網頁版再裝一份進去**。
  換來的是離線可部署、不必在部署當下去網路上抓一份來源不明的程式碼。

### 3. worker 名稱固定 `cinder-relay`

重跑流程＝對同名 worker 就地更新（冪等）。使用者按兩次不會產生兩座孤兒節點。

### 4. 驗證通過才算部署成功

部署 API 回 200 **不等於** relay 活著。App 必須組出 `wss://cinder-relay.<子網域>.workers.dev`
實際連線，收到 `["AUTH", challenge]`（NIP-42）才判成功。失敗時**不得**切 home，
並保留可重試的錯誤畫面。統一模式（ADR-0354）另驗 `GET /healthz` 回純文字 `ok`。

⚠ 那個探測**走 Rust（`cf_verify_healthz`）而不是前端 fetch**：前端打 `https://<站>/healthz`
需要放寬 `connect-src`，而本 ADR §1 的「CSP 一個字都不用動」就會不成立。reqwest 不受 CSP 管。

中途失敗或使用者中止時**拆除已建資源**（`cf_teardown` → `DELETE .../workers/scripts/cinder-relay`）
——半成品的壞處不是佔空間，是使用者下次重試時搞不清楚眼前這座是好的還是壞的。

拆除**只拆我們自己會建的那一個腳本名**，不接受任意名稱：否則這會變成「用使用者的 token
刪掉他任何 Worker」的指令。已經不存在（404）視為完成，所以它可以重複呼叫。

⚠ 拆除是盡力而為，不是保證：拆不掉時仍讓使用者關掉視窗。真正在兜底的是**固定腳本名帶來的
冪等性**——下次部署直接覆寫同一座，不會累積孤兒。

### 5. 切 home 是**可選的，但預設會切**

落實成一個**預設已勾選**的核取方塊，不是問句，也不是無聲發生：

- 預設勾選 ⇒ 按「完成」就切，與 2026-08-27 裁示一致，不必多一次決定。
- 可取消 ⇒ 節點已部署好，只是暫時不當主站。切 home 有後果（分享 ID 會變、聯絡人要改道、
  舊站要排水七天），使用者至少該看得到一眼。

🔴 **取消勾選之後不能變成死路**：精靈要把部署出來的網址**記在設定裡**（不是只顯示一次），
設定頁的中繼站區塊因此能提供「改用我自己的節點」。沒有這一條，取消勾選就等於白部署。

**切的是 home，不是全部連線**：錨點仍留在 pool（ADR-0039 恆連保底）；自有站死亡逾門檻時，
既有的 T2/T3 會把 home 自動搬回健康座。單人節點的可用性風險由既有容錯兜住，本 ADR 不發明新機制。

**實作上不寫新東西**：`changeRelay`（`apps/desktop/src/App.tsx`，ADR-0066 H2）已經做完整件事，
排水（H3，七天、對齊 ADR-0065 的 relay 端 TTL 上限）由 `changeProfileRelay` 一併處理，
所以**切換不會吃掉還沒取件的離線留言**；重載後的開機廣播（H1）帶新 hint，聯絡人自動改道。

**範圍**：僅當下作用中的開放模式身分。企業／工作身分整個功能不顯示（ADR-0045）。

### 6. 🔴 同時修 TURN：端點改為「home → 錨點」序列後備

`turnEndpointFromRelay` 目前**只從 home 推導** `/turn` 端點。home 一切到自有站（本 ADR 不帶
TURN 設定）⇒ `/turn` 恆 204 ⇒ 客戶端退純 STUN ⇒ **部署自有節點會順手把通話保底關掉**。

這是 ADR-0342 §3.4「加一個功能、順手弄壞另一個」的同款形狀，必須在本 ADR 內一起解：
TURN 抓取改**序列後備**，home 的 `/turn` 回 204／失敗時依序改打 `ANCHOR_RELAYS`。
既有優先序不變（企業 `turnServers` 存在則完全不抓公共 TURN；`disablePublicTurn` 語意不變）。

### 7. 平台範圍

桌面（Tauri）先行。行動端後續（原生 HTTP 可行，UI 另做）。**網頁版排除**（限制 3），
改顯示替代指令並導向官網教學（ADR-0357）。

## 理由

- **D 是唯一能「自動把 relay 資訊帶回產品」的路**：部署者就是 App 自己，網址由子網域計算而得，
  不需要任何回呼機制。官方按鈕（A）在這一點上是死路，不是次佳解。
- **D2 勝過 D1 的理由只有一條，但夠**：token 的爆炸半徑是使用者的整個 Cloudflare 帳號。
  把它留在 Rust 那側，XSS 最多只能觸發一次部署，偷不走 token；順帶還省下一次 CSP 放寬。
  代價是行動端與網頁版不能共用這段程式——但它們本來就做不到（限制 3），所以不是真代價。
- **token 貼回是無第三方 OAuth 下的最小手動步驟**：官方 template URL 把「建立正確權限的 token」
  從一頁表單壓成一次點擊。
- **零伺服器狀態不破**：App 直連 `api.cloudflare.com`，我方無任何中間服務；relay 跑在
  **使用者自己的帳號與額度**上。不碰金流（PRD §12）。
- **home 切換與容錯全部重用 0039／0066／0069**（Fix First）：本 ADR 新增的只有「部署器」與
  「TURN 錨點後備」兩塊，不動搬家語意。

**查證日期**：2026-08-27 初查，**2026-09-17 動工前重查**——而重查是對的：限制 1 已經翻盤
（第三方 OAuth 上線了）。這正是規劃稿把「動工前重新查證」列成硬性步驟的理由；若照 8 月的結論
直接寫下去，會把一條**已經不成立**的限制焊進架構。確認過的 API 形狀見附錄。

## 後果

- **正面**：
  - 非技術使用者第一次能**不離開產品**擁有自己的節點；去中心化從文件承諾變成產品功能。
  - 資料主權實質化：自己的離線留言收件匣落在自己的 Cloudflare 帳號上。
  - token 留存時，ADR-0241 的「relay 需 deploy 最新 worker」維運義務可變成產品內的
    「一鍵更新節點」（比對 NIP-11 版本），部分解掉社群節點跟版問題。
  - 通話保底在切 home 之後仍然有效（§6），且**所有使用者**都受益，不只自架者。
- **負面 / 已知殘餘風險**：
  - **token UX 消不掉**：使用者仍可能無視預填、建出過寬權限的 token。App 只會用到最小呼叫，
    但**無從阻止**，只能在 UI 明示建議權限與「可隨時在 Cloudflare 後台撤銷」。
  - **workers.dev 子網域含 Cloudflare 帳號名** ⇒ relay hint 隨分享 ID 外流＝聯絡人可得知
    你的 Cloudflare 帳號名。自訂網域為後續選項，不在本 ADR。
  - **單座 home 的物理極限**：自有站下線期間，落在它上面**尚未取件**的離線留言在它復活前
    拿不到；遞補只救新訊息路由（與 ADR-0039 同款）。
  - **額度與帳單由使用者承擔**（單人／小圈量級遠低於額度，見 ADR-0059／0006）。
    Durable Objects 的計費條件會變，UI 與文件一律**導向官方計費頁**，不自己下結論。
  - **自部署站不會自動進官方清單**——那是 ADR-0092 的拉取式流程；本功能只服務「自己與經
    hint 學到的聯絡人」。
  - **統一模式（ADR-0354）的信任降級**：那台 Worker 同時送出客戶端 JS，被入侵＝能換掉程式碼
    竊取金鑰。UI 上**預設不勾**，勾選時原樣講出這句話。
  - 行動端與網頁版無此功能。
  - **讀／寫白名單分家（2026-09-17 審查）**：ADR-0128 的路徑白名單原本只服務**讀取**
    （`read_saved_file`）。合集解包讓它同時變成寫入授權，於是使用者為了「傳一個資料夾給
    朋友」而拖進來的目錄、以及歷史上每一個另存過的路徑，全部**永久**成為解包的合法寫入
    目的地——他選那個資料夾的語意是「讀這個給對方」，不是「歡迎往裡面寫檔」。
    ⇒ 拆成兩份：拖放與另存只進讀取集合，`pick_folder`（使用者主動挑資料夾）才進寫入集合。
    ⚠ **一次性影響**：既有的企業儲存槽（ADR-0161）基底在舊的讀取集合裡，升級後要
    **重挑一次資料夾**。這是關掉「拖放順手變成寫入授權」的代價，不是缺陷。
- **後續行動 / 待辦**：
  1. `relay` 的 `build:worker` 打包 script ＋ bundle 進桌面出貨鏈 ＋ 版本寫入 NIP-11。
  2. `cfdeploy.rs`（API client＋錯誤分型＋metadata 產生）＋TDD（假件 `CfApi`）。
  3. `cf_*` commands（薄殼）＋ OS 金鑰庫存放 token。
  4. 精靈 UI（說明 → 取得 token → 選帳號/子網域 → 部署中 → 完成）＋i18n（UI 測試釘 locale）。
  5. §6 TURN 錨點後備＋測試（企業 turnServers 優先、204/失敗序列）。
  6. §5 切 home（重用 `changeRelay`）＋設定頁「改用我自己的節點」。
  7. 統一模式（三步資產上傳）——另計，見 ADR-0354。
  8. 一鍵更新節點（token 留存時；NIP-11 版本比對）。
  9. 官網教學頁與 Deploy 按鈕入口＝ADR-0357。
  10. **註冊 Cloudflare OAuth 客戶端並送審**（需網域驗證）；過審後補 `CfAuth::OAuth` 變體，
      token 路徑保留為不想授權 OAuth 的人的選項。

## 附錄：查證過的 API 形狀（2026-09-17）

記在這裡是因為**這些是實作直接照抄的東西**，而它們會漂移。日後對不上時，先看這份是什麼時候查的。

- **腳本上傳**：`PUT /accounts/{account_id}/workers/scripts/{script_name}`，`multipart/form-data`，
  一個 `metadata` JSON 欄位 ＋ 一個模組檔欄位。
- **metadata 頂層欄位**：`main_module`（**必填**，值是模組那個 part 的名字）、`compatibility_date`、
  `bindings`、`migrations`、`assets`。
- **Durable Object 綁定**：`{"type": "durable_object_namespace", "name": "RELAY_ROOM", "class_name": "RelayRoom"}`。
- **SQLite DO migration**：`"migrations": [{"tag": "v1", "new_sqlite_classes": ["RelayRoom"]}]`。
  🔴 `new_classes` 是 **legacy-kv** 後端，`new_sqlite_classes` 才是 SQLite——寫錯這個字
  部署會成功但儲存後端是錯的，屬於「成功但行為不對」那一類。
- **workers.dev 子網域**：帳號層 `GET`／`PUT /accounts/{account_id}/workers/subdomain`；
  單一腳本啟用 `POST /accounts/{account_id}/workers/scripts/{script_name}/subdomain`，
  body `{"enabled": true}`。
- **靜態資產三步**（統一模式才需要）：
  1. `POST /accounts/{id}/workers/scripts/{name}/assets-upload-session`，body 是
     `{"<檔案路徑>": {"hash": "<32 位十六進位>", "size": <位元組>}}` 的 manifest；
     回應給 `jwt` 與 `buckets`。**`buckets` 為空代表全部命中快取，該 `jwt` 直接就是完成憑證。**
  2. 對每個 bucket `POST /accounts/{id}/workers/assets/upload?base64=true`，帶上一步的 `jwt`。
  3. 腳本上傳的 metadata 帶 `"assets": {"jwt": "<完成憑證>"}`。
- **token template URL**：`https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=<URL 編碼的 JSON 陣列>&name=<名稱>`，
  陣列元素形如 `{"key": "<權限名>", "type": "edit"}`。
- **計費**：Workers 免費層每日 10 萬次請求；**SQLite-backed Durable Objects 免費層可用**
  （每日 10 萬請求、13,000 GB-秒、5 GB 儲存）。⚠ 這一條變過不只一次，UI 與文件一律導向
  官方計價頁，不自己宣稱。

### OAuth 路徑（2026-09-17 以真實 API 實測）

建了一個 **private** 測試客戶端（`eb196406141752cea753b696d16cfa30`，保留供開發）。結論：

- 🔴 **scope 的格式是 `workers-scripts.write`，不是 `workers_scripts:write`。** 後者是
  wrangler 憑證檔裡的寫法，直接照抄會被判 `invalid scopes`（錯誤碼 70722）。
  權威清單在 `GET https://api.cloudflare.com/client/v4/oauth/scopes`（391 個）。
  我們要的兩個：**`workers-scripts.write`** ＋ **`account-settings.read`**。
- **loopback 轉址網址可用**：`http://127.0.0.1:8976/callback` 被接受（文件沒寫這件事）。
- **公開客戶端可用**：`token_endpoint_auth_method: "none"` 被接受，PKCE 的 `S256` 在
  discovery 文件的 `code_challenge_methods_supported` 裡。
- **⭐ 更適合桌面版的是 device code**：`grant_types_supported` 含
  `urn:ietf:params:oauth:grant-type:device_code`，且有專屬的 `device_authorization_endpoint`。
  它不必在使用者機器上開本地埠口，因此不會撞到防火牆或埠口被占用——**實作 OAuth 時走這條**。
- 帶 `refresh_token` grant 時，`offline_access` 會被 Cloudflare **自動加進 scopes**。
- discovery 文件在 `https://dash.cloudflare.com/.well-known/openid-configuration`。

**仍未確認**：資產上傳中途失敗的重試語意。（OAuth 的 scope 已於本次實測解決。）
