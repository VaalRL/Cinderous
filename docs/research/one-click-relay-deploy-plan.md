# 規劃：把「一鍵部署自有 relay」做進產品與官網

> **文件狀態**：規劃稿（尚未動工）——採納後拆成 ADR-0356／0357 再實作。
> **建立日期**：2026-09-17
> **目標**：讓「擁有自己的節點」成為**產品內的一個按鈕**，而不是一份要讀的文件；
> 並在官網提供一份任何人照著做得完的詳盡教學。
> **相關決策**：ADR-0005（自建最小 Worker relay）、ADR-0039（錨點與 home 遞補）、
> ADR-0066／0069（保命名空間搬家與排水）、ADR-0075（容器化自架）、ADR-0090（官網與通訊平面硬隔離）、
> ADR-0092（節點自報與收錄）、ADR-0112（信任根靜態加密）、ADR-0128（路徑授權白名單的信任邊界）、
> ADR-0147（自架網頁版的信任模型）、ADR-0241（分片路由與跟版義務）、ADR-0243／0342（公共 TURN）、
> ADR-0260（NIP-11）、ADR-0354（統一節點 Worker）。

---

## 1. 要做的三件事

| # | 交付物 | 在哪 | 誰用 |
| --- | --- | --- | --- |
| A | **部署精靈**：點一顆按鈕，把 relay 部署到使用者自己的 Cloudflare 帳號 | 桌面 App 設定頁 | 一般使用者 |
| B | **統一節點選項**：同一個精靈多一個勾選框，連網頁版一起部署（ADR-0354） | 同上 | 想給朋友一個網址的人 |
| C | **詳盡教學**：官網一頁圖文教學＋三條自架路線對照 | 官網 `/selfhost` | 搜尋進來的人、不用桌面版的人 |

A 與 B 是**同一個精靈**的兩個模式，不是兩個功能。C 是入口與退路：桌面版做不到的（行動端、
瀏覽器版）都導到這裡。

---

## 2. 硬限制（2026-09-17 重新查證過）

1. ~~**Cloudflare 沒有第三方 OAuth。**~~ 🔄 **2026-09-17 重查後翻盤**：自管 OAuth 客戶端已於
   **2026-06-03** 上線，官方明說第三方應用可代表使用者存取其 Cloudflare 帳號，且點名 Workers
   部署。**但**客戶端要從 private 轉 public 才能讓任意使用者授權，那需要前置條件與**網域驗證**。
   ⇒ 先做 token 路徑（今天就能動），把 `CfAuth` 介面留好，OAuth 過審後只是多一個變體。
   詳見 ADR-0356 §1b。
2. **官方「Deploy to Cloudflare」按鈕強制 clone repo 到點擊者的 GitHub/GitLab 帳號，
   且沒有任何 callback。** ⇒ 那條路**拿不回部署結果**，無法自動回填網址。它只適合官網（C），
   不適合 App（A）。
3. **`api.cloudflare.com` 不送 CORS 標頭。** ⇒ 純瀏覽器環境（網頁版、官網）**打不了**這組 API。
   A 與 B 因此**只有桌面版做得到**（Tauri 的 Rust 那一側發請求）。
4. **Workers Script Upload API 走得通。** 它就是 `wrangler deploy` 用的同一條公開 API，
   支援 `durable_object_namespace` 綁定與 `migrations`（含 `new_sqlite_classes`）。
   我們的 relay 是單一 SQLite-backed DO、零外部綁定，完整走得通。

> ✅ **2026-09-17 已重新查證完畢**（結果見 §9）：第 1 點翻盤，第 2、3、4 點維持。
> 確認過的端點與欄位形狀記在 **ADR-0356 附錄**。這次重查證明了它值得做——照 8 月的結論
> 直接寫下去，會把一條已經不成立的限制焊進架構。

---

## 3. 與既有決策的界線

- **ADR-0090（硬隔離鐵則）**：官網與 E2E 通訊平面完全分離，**永不接觸**使用者資料、金鑰、
  relay 流量或 npub，且零追蹤零 cookie。⇒ 🔴 **官網那一頁只能教學與外連，不能做任何部署動作、
  不能收 token、不能有任何表單回傳。** 這條不是偏好，是鐵則。
- **ADR-0354（統一節點）**：`deploy:unified` 已經存在，精靈的 B 模式是把那條指令包成 UI，
  不是另一套機制。`run_worker_first` 的陷阱與 `/healthz` 的理由原樣適用。
- **ADR-0147／0354 的信任取捨**：統一模式下那台 Worker **同時送出客戶端 JS**，它被入侵就等於
  能換掉程式碼竊取金鑰；純 relay 沒有這條路徑。⇒ B 模式在 UI 上**預設不勾**，且勾選時必須
  把這句話原樣講出來。
- **ADR-0092（自報收錄）**：自部署站**不會自動進官方清單**。精靈的成功畫面導流
  `docs/NODE-SUBMISSION.md`，但那是拉取式流程，與本規劃無耦合。
- **ADR-0045（工作身分鎖單座）**：企業／工作身分**不顯示**此功能。

---

## 4. 架構決定

### 4.1 🔴 token 與 HTTP 都留在 Rust，不進 webview

先前的草案（2026-08-27）打算在 engine 新增 `cloudflare-deploy` 模組、由前端直打
`api.cloudflare.com`。**這一點要改掉**，兩個理由：

1. **那顆 token 是使用者整個 Cloudflare 帳號的信任根。** 讓它進 webview，等於任何一個 XSS
   都能把它偷走。ADR-0128 花了那麼大力氣不把路徑白名單的鑰匙交給 webview，這裡不該反過來做。
2. **這個專案已經有一模一樣的正解。** AI 金鑰走的就是這條路：`ai_set_key` 把金鑰存進 OS 金鑰庫，
   `ai_has_key` 只回布林值，**金鑰永遠不回到前端**，實際的 HTTP 由 Rust 的 `ai_generate` 發。
   照抄它就好（Fix-First），不必發明第二套。

因此：

| 層 | 放什麼 | 測得到嗎 |
| --- | --- | --- |
| `src-tauri/src/cfdeploy.rs`（lib） | API 請求的組裝與回應解析、錯誤分型、metadata 產生 | ✅ `cargo test --lib` |
| `src-tauri/src/main.rs`（薄殼） | `cf_set_token` / `cf_has_token` / `cf_forget_token` / `cf_deploy` / `cf_deploy_progress` | ❌（比照 `inbox`／`filestream`，所以這裡不放邏輯） |
| `packages/engine` | **不放東西**。部署是桌面專屬能力，不該污染共用層 | — |

**附帶好處**：`tauri.conf.json` 的 `connect-src` **完全不用動**。草案那條路要放行
`https://api.cloudflare.com`，而 CSP 每放寬一次就永久留在那裡。

### 4.2 worker bundle 隨 App 出貨

- 來源 SSOT 仍是 `relay/src/worker.ts` ＋ `relay/wrangler.toml`；部署用的 metadata
  **由 `wrangler.toml` 生成**，不得手寫第二份（否則兩邊會漂移，而漂移的症狀是「部署成功但行為不對」）。
- 實測：`esbuild src/worker.ts --bundle --format=esm` ⇒ **單檔 176 KB**。進 App 資產無壓力。
- bundle 版本寫進 relay 的 NIP-11 `version` 欄位（ADR-0260 已有欄位），供日後「一鍵更新節點」比對。
- 統一模式還要帶 `apps/desktop/dist`：目前 **1.2 MB／14 個檔**。也在可接受範圍，但它會讓
  桌面安裝檔**把自己再裝一份進去**，體積要在 ADR 的後果節寫明。

### 4.3 worker 名稱固定 `cinder-relay`

重跑流程＝對同名 worker 就地更新（冪等）。使用者按兩次不會產生兩座孤兒節點。

### 4.4 驗證後才算數

部署 API 回 200 **不等於** relay 活著。精靈必須組出
`wss://cinder-relay.<子網域>.workers.dev` 實際連線，收到 `["AUTH", challenge]`（NIP-42）才判成功。
失敗時不得切換 home，並保留可重試的錯誤畫面。

統一模式另外驗 `GET /healthz` 回純文字 `ok`——那正是 ADR-0354 加它的理由：
合體之後「`/` 回不回 HTML」已經不能拿來判斷中繼站死活。

### 4.5 失敗要拆乾淨

中途失敗或使用者中止時，**一鍵拆除已建資源、不留半成品**。半成品的壞處不是佔空間，
是使用者下次重試時搞不清楚眼前這座到底是好的還是壞的。

### 4.6 切 home 是**可選的，但預設會切**

使用者裁示（2026-08-27）是「部署完成後預設以自有站為 home」；2026-09-17 追加：**讓他可選**。
落實成一個**預設已勾選的核取方塊**，不是一個問句，也不是無聲發生：

- **預設勾選** ⇒ 按「完成」就切，與裁示一致，不必多一次決定。
- **可取消勾選** ⇒ 節點已經部署好了，只是暫時不當主站。切 home 是有後果的操作
  （分享 ID 會變、聯絡人要改道、舊站要排水七天），使用者至少該看得到一眼。

**取消勾選之後不能變成死路。** 精靈要把部署出來的網址記在設定裡（不是只顯示一次），
設定頁的中繼站區塊因此能提供「改用我自己的節點」，使用者不必自己把網址抄下來再貼回去。
沒有這一條，取消勾選就等於白部署。

**切的是 home，不是全部連線。** 錨點仍留在 pool（ADR-0039 恆連保底）；home 決定的是
收件匣位置與心跳／個人檔廣播的主站。自有站死亡逾門檻時，既有的 T2/T3 會把 home 自動搬回
清單上的健康座——單人節點的可用性風險由既有容錯兜住，本規劃不發明新機制。

**實作上不寫新東西。** `changeRelay`（`apps/desktop/src/App.tsx:1926`，ADR-0066 H2）已經做完
整件事：保留 namespace ⇒ 資料零損失、寫入 `RELAY_URL_KEY`、`location.reload()` 乾淨重建。
排水（H3）由 `changeProfileRelay` 一併處理——記下 `previousRelayUrl` 與 `drainUntil`（七天，
對齊 ADR-0065 的 relay 端 TTL 上限），期間 relay pool 額外訂閱舊站的自家收件匣，
**所以切換不會吃掉還沒取件的離線留言**。重載後的開機廣播（H1）帶新 hint，聯絡人自動改道。

精靈要做的只有兩件事：驗證通過（§4.4）之後呼叫它，以及在勾選框旁邊講清楚上面這些後果。

**範圍**：僅當下作用中的開放模式身分。其他身分不動；企業／工作身分整個功能都不顯示（ADR-0045）。

---

## 5. 分階段計畫

每一階段都**獨立可出貨**，做完就有東西可用，不是做完全部才看得到成果。

### 進度（2026-09-17）

| 階段 | 狀態 | 產出 |
| --- | --- | --- |
| 0 決策 | ✅ | ADR-0356／0357＋索引 |
| 1 worker bundle 進出貨鏈 | ✅ | `build:worker`（176 KB）、版號進 NIP-11、3 測試 |
| 2 Rust 部署器 | ✅ | `cfdeploy.rs`，26 測試（含防漂移比對真的 `wrangler.toml`） |
| 3 精靈 UI | ✅ | `DeployWizard`，17 測試；40×2 個 i18n 鍵 |
| 4 切 home ＋ TURN 錨點後備 | ✅ | 序列後備＋12 測試；設定頁「改用我自己的節點」＋5 測試 |
| 5 統一模式 | ✅ | 三步資產上傳（雜湊公式已查證）、預設不勾的核取方塊 |
| 6 官網教學頁 | ✅ | `/selfhost` 中英雙語、13 測試（含鐵則的機械化守衛） |
| 7 一鍵更新節點 | ⏳ | 未做——比對 NIP-11 版號，token 留存時才解鎖 |

### 階段 0：寫決策（先做，不寫程式）

- `docs/adr/0356-in-app-relay-deploy.md`：App 內建部署器。含 §4 的全部決定，
  尤其 **§4.1 的修正**（token 與 HTTP 留在 Rust）與 §2 的四條硬限制。
- `docs/adr/0357-website-self-host-guide.md`：官網教學頁與 Deploy 按鈕入口，
  以及 ADR-0090 在這一頁上的**具體界線**（只教學、不動作）。
- 更新 `docs/adr/README.md` 索引。
- 🔴 開號前先查遠端最大號：`git ls-tree -r --name-only origin/main -- docs/adr/ | sort | tail -5`。

### 階段 1：worker bundle 進出貨鏈

- `relay` 新增 `build:worker` script（esbuild 單檔 ESM）。
- 桌面建置前置步驟把它複製進 `src-tauri` 資產；版本字串同時寫進 NIP-11 `version`。
- 測試：bundle 存在、非空、版本字串與 `package.json` 一致。
- **驗收**：`pnpm --filter @cinderous/desktop build` 之後，安裝檔裡找得到那顆 bundle。

### 階段 2：Rust 部署器（TDD）

- `cfdeploy.rs`：
  - `metadata_from_wrangler(toml) -> DeployMetadata`（DO 綁定、migrations、compatibility_date）
  - `subdomain_url(sub) -> String`
  - `classify_error(status, body) -> DeployError`（token 無效／權限不足／帳號無 Workers／子網域未命名／額度）
  - HTTP 以 trait 抽一層（`trait CfApi`），產線用 `reqwest`，測試用假件 ⇒ 整組可 `cargo test --lib`。
- `main.rs` 薄殼 command：`cf_set_token`／`cf_has_token`／`cf_forget_token`／`cf_deploy`。
- token 經 `keyvault::set_key` 進 OS 金鑰庫，account 名例如 `cf:deploy`。
- **驗收**：`cargo test --lib` 綠；`cargo clippy --all-targets --features tauri-app -- -D warnings` 乾淨。

### 階段 3：精靈 UI（桌面）

五個畫面，每一個都只做一件事：

1. **說明**：這會做什麼、跑在誰的帳號上、會不會收費（導向官方計費頁，不自己宣稱）。
2. **取得 token**：一顆按鈕開瀏覽器到**預填權限**的 token 建立頁
   （`dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=…&name=Cinderous%20Relay%20Deploy`），
   回來貼上。UI 明示權限範圍與「可隨時在 Cloudflare 後台撤銷」。
3. **選帳號／子網域**：多帳號時讓使用者挑；首次用 Workers 的帳號在此命名子網域。
4. **部署中**：逐步進度（上傳 → 啟用路由 → 連線驗證）。
5. **完成**：顯示 `wss://…`、複製鈕、導流 `NODE-SUBMISSION.md`，
   以及一個**預設已勾選**的「設為我的主要中繼站」（見 §4.6）。

- i18n 全部新鍵（中英），UI 測試**釘 locale**。
- 入口：設定頁「建立我的節點」。工作身分不顯示。

### 階段 4：切 home ＋ 🔴 TURN 錨點後備（同一階段，不可拆）

- 切 home **重用既有搬家路徑**（ADR-0066 H2／H3、ADR-0069 T2/T3），只是觸發者換成
  「使用者主動部署成功」。不另闢第二條換 home 路徑。錨點仍留在 pool（ADR-0039 不變）。
  語意與界線見 §4.6：**預設勾選、可取消**，取消時把網址留在設定裡供日後採用。
- 設定頁中繼站區塊新增「改用我自己的節點」——只有在精靈記下過自部署網址時才出現。
  這是 §4.6 那條「取消勾選不能變成死路」的落點。
- 🔴 **必須同時修 TURN**：`turnEndpointFromRelay` 目前**只從 home 推導** `/turn` 端點。
  home 一切到自有站（不配 TURN）⇒ `/turn` 恆 204 ⇒ 客戶端退純 STUN ⇒
  **部署自有節點會順手把通話保底關掉**。這是「加一個功能、順手弄壞另一個」的同款形狀，
  不能留到下一階段。修法：TURN 抓取改**序列後備**——home 的 `/turn` 回 204／失敗時依序改打
  `ANCHOR_RELAYS`。企業 `turnServers` 優先、`disablePublicTurn` 語意皆不變。
- **驗收**：
  1. 勾選 ⇒ 分享 ID 變成自有站、聯絡人下次開機自動改道、舊站排水期間仍收得到舊信。
  2. 取消勾選 ⇒ home 不動，但設定頁出現「改用我自己的節點」且點了就切。
  3. 兩種情況下撥一通測試通話，路徑仍能走 TURN（錨點後備生效）。

### 階段 5：統一模式（B）

- 三步資產上傳：`assets-upload-session`（送 manifest）→ 分桶上傳 → Script Upload 帶完成 JWT。
- `apps/desktop/dist`（unified build）進 App 資產。
- UI：一個**預設不勾**的核取方塊，旁邊是 §3 那段信任取捨的原話。
- **驗收**：部署後瀏覽器打開該網址能聊天，且 `wss://` 同址仍握得到手（`run_worker_first` 生效）。

### 階段 6：官網教學頁（C）——見 §6

### 階段 7：一鍵更新節點

- token 留存時解鎖。比對自有站 NIP-11 的 `version` 與 App 內建 bundle 版本，不同就提示更新。
- 這把 ADR-0241 的「relay 需 deploy 最新 worker」維運義務變成產品內的一顆按鈕。

---

## 6. 官網教學頁

### 6.1 放哪、動到什麼

現有的 `node` 頁只有 51 行、三個步驟卡片，內容停在「wrangler deploy」一句話——
它是**導覽**，不是教學。做法：

- **新增一個 view `selfhost`**（`routes.ts` 的 `View` 聯集、`VIEWS`、`App.tsx` 的路由分派、
  `seo.ts` 的標題描述、`copy.ts` 的中英文案、`pages/SelfHost.tsx`）。
- 既有 `node` 頁保留為「為什麼要自架」的短頁，底部加一顆「完整教學」導到 `selfhost`。
- 路由測試與 prerender 測試會自動涵蓋新頁（`routes.test.ts`／`prerender.test.ts` 已按 `VIEWS` 展開）。

### 6.2 🔴 這一頁不能做的事（ADR-0090）

- 不收 token、不放任何會回傳的表單、不碰 npub、不做部署動作。
- 不加分析、不加 cookie、不嵌第三方 widget。
- Deploy 按鈕是**純外連**到 Cloudflare，點下去之後的事**全部發生在使用者與 Cloudflare 之間**，
  官網不知道、也不該知道結果。

### 6.3 內容結構（實際要寫的教學）

1. **你會得到什麼**：一個 `wss://…` 網址，跑在你自己的 Cloudflare 帳號上；
   我們看不到它，也管不到它。
2. **三條路，選一條**（對照表，各列適合誰、要多久、要不要花錢）：

   | 路線 | 難度 | 大約時間 | 適合 |
   | --- | --- | --- | --- |
   | 桌面 App 一鍵部署 | ★☆☆ | 3 分鐘 | 大多數人 |
   | 官網 Deploy 按鈕 | ★★☆ | 10 分鐘 | 有 GitHub 帳號、不用桌面版 |
   | 自己跑 wrangler | ★★★ | 15 分鐘 | 想改設定、想綁自訂網域 |

3. **路線一：桌面 App**（圖文逐步，五張圖對應 §5 階段 3 的五個畫面）。
   含 token 建立頁的截圖與**該勾哪些權限**。
4. **路線二：Deploy 按鈕**。明講它的兩個限制：會把 repo clone 到你的 GitHub、
   **部署完網址不會自己回到 App，要自己複製貼回去**。
5. **路線三：wrangler**。完整指令，含 `npx --yes wrangler@4`（🔴 不要用 `pnpm dlx`，
   pnpm 10 會以 `ERR_PNPM_IGNORED_BUILDS` 中止）與**統一模式**的 `deploy:unified`
   ＋ `run_worker_first` 的理由。
6. **要不要花錢**：Durable Objects 的計費條件會變，**導向官方計費頁**，不自己下結論。
   同時給實際量級參考（單人／小圈遠低於免費額度，見 ADR-0059／0006 的容量模型）。
7. **部署完成之後**：桌面版會問你要不要把它設成主要中繼站（預設會，可以不要，見 §4.6）；
   其他路線要自己在設定裡填。怎麼確認它活著（`GET /healthz`）、
   換過去之後分享 ID 會變成什麼樣子、舊站排水那七天在做什麼、
   要不要申請進官方清單（導 `NODE-SUBMISSION.md`）。
8. **常見錯誤**：token 權限不足、帳號還沒命名 workers.dev 子網域、
   統一模式忘了 `run_worker_first` 導致「`/` 回 HTML、WebSocket 握不到手」、
   DO migration 名稱衝突。每一條都寫**症狀 → 原因 → 怎麼修**。
9. **誠實邊界**：workers.dev 子網域含你的 Cloudflare 帳號名，會隨分享 ID 外流；
   自有站下線期間，落在它上面尚未取件的離線留言要等它復活；統一模式的信任降級。

### 6.4 文件同步

同一份教學要在三處保持一致，但**只寫一次**：
- 官網 `selfhost` 頁＝主體（中英雙語）。
- `docs/SELF-HOSTING.md`／`.en.md`＝指向官網那頁，只留指令速查。
- README 的中繼站章節維持現狀（已含 `deploy` / `deploy:unified` 與 `run_worker_first` 警告）。

---

## 7. 平台涵蓋

| 平台 | A 一鍵部署 | B 統一模式 | C 教學 |
| --- | --- | --- | --- |
| 桌面（Tauri） | ✅ | ✅ | ✅ |
| 行動端（Capacitor） | ⏳ 後續（原生 HTTP 可行，UI 另做） | ❌ 不做（手機上沒有意義） | ✅ |
| 網頁版 | ❌ CORS 擋死 | ❌ | ✅（顯示替代指令） |

---

## 8. 風險與誠實邊界

- **token UX 消不掉**：使用者仍可能無視預填、建出過寬權限的 token。App 只會用到最小呼叫，
  但**無從阻止**，只能在 UI 明示建議權限。
- **workers.dev 子網域含帳號名** ⇒ relay hint 隨分享 ID 外流＝聯絡人得知你的 Cloudflare 帳號名。
  自訂網域為後續選項。
- **單座 home 的物理極限**：自有站下線期間，落在它上面**尚未取件**的離線留言在它復活前拿不到。
  遞補只救新訊息路由（與 ADR-0039 同款）。
- **統一模式的信任降級**：那台伺服器同時送客戶端 JS，被入侵＝能換掉程式碼竊取金鑰。
- **`api.cloudflare.com` v4 介面漂移**：與 wrangler 同一條 API，變更會有過渡期，但不是零風險。
- **額度與帳單由使用者承擔**。
- **自部署站不會自動進官方清單**（ADR-0092 是拉取式）。

---

## 9. 查證結果（2026-09-17 完成）

| # | 項目 | 結果 |
| --- | --- | --- |
| 1 | 第三方 OAuth | 🔄 **翻盤**：2026-06-03 已上線；公開客戶端需網域驗證與過審 ⇒ token 先行 |
| 2 | Script Upload multipart 與 migrations | ✅ 確認，形狀見 ADR-0356 附錄 |
| 3 | 靜態資產三步上傳 | ✅ 確認（含「buckets 為空＝jwt 直接是完成憑證」） |
| 4 | token template URL 預填 | ✅ 仍支援；最小權限＝Workers Scripts:Edit ＋ 帳號讀取 |
| 5 | 免費層與 SQLite DO | ✅ 免費層可用；⚠ 變過不只一次，一律導官方計價頁 |
| 6 | ADR 遠端最大號 | ✅ 0353 ⇒ 本次用 0356／0357 |

**仍未確認**：OAuth 的 scope 字串（要等我方客戶端註冊後才問得到）、
資產上傳中途失敗的重試語意。兩者都不擋現在這條 token 路徑。
