# 0089. Relay 營運者贊助入口（NIP-11 擴充＋桌面角落卡＋純導流）

- 狀態：已接受
- 日期：2026-07-12
- 相關文件：PRD.md §12（明確排除：廣告／金流的界線澄清）、docs/adr/0034（多中繼路由）、
  0039（引導路由／home relay）、0044（企業封閉節點）、0075（容器化自架）；
  relay/src/worker.ts、relay/src/node-relay.ts、docs/relay-metadata-observability.md

## 背景與問題

社群自架 relay（ADR-0075）與「永久免費」模型仰賴志願營運者。希望讓使用者能**自願贊助
目前所連 relay 的營運者**，以支撐永續性。需求限制：

- **非金融 App**：不得引入站內錢包／托管／抽成（呼應 PRD §12 排除的「金流」）。
- **非第三方廣告**：PRD §12 排除清單含「廣告」；此入口是**營運者自報的贊助連結**，
  與廣告聯播網無關，須明確區隔、避免精神漂移。
- **行動端 App 商店政策**：Apple/Google 對站內加密/捐款付款流程敏感——**行動端刻意不放**。
- **多中繼**：使用者連的是 relay pool（ADR-0034/0039），「目前管理人」需界定。

現況：relay 對 HTTP GET 只回純文字 `"Cinder relay"`（`worker.ts:18`、`node-relay.ts:43`），
無任何營運者身分或付款欄位。

## 考量的選項

- 選項 A：不做。
- 選項 B（採用）：**relay 以 NIP-11 自報捐款管道（GitHub Sponsors／Buy Me a Coffee／
  Liberapay），桌面版讀取後於角落顯示低調可關閉的「贊助此節點」卡、純導流至外部瀏覽器；
  行動端不放；未填則隱藏。**
- 選項 C：站內 Zap/錢包代付——引入金流與托管，撞 PRD §12，否決。

## 決策

### 1. relay 端：NIP-11 擴充捐款欄位

- relay 對帶 `Accept: application/nostr+json` 的 HTTP GET 回一份 **NIP-11 Relay Information
  Document**（JSON）；**不帶此 header 時維持原純文字 200**，PaaS/容器健康檢查（ADR-0075）不受影響。
- NIP-11 文件含標準欄位（`name`/`description`/`pubkey`（營運者）/`contact`/`supported_nips`…）
  並擴充：
  ```json
  "cinder_donations": {
    "github_sponsors": "https://github.com/sponsors/<user>",
    "buy_me_a_coffee": "https://buymeacoffee.com/<user>",
    "liberapay":       "https://liberapay.com/<user>",
    "lightning":       "<user>@<domain> 或 lnurl1..."
  }
  ```
  四者皆為**選填**；自架者自行填寫，**全空／未提供 `cinder_donations` ＝無捐款入口**。
- 值一律視為**外部導流**：URL 類以系統瀏覽器開啟；`lightning`（LN 位址/LNURL）以 `lightning:`
  deep link 交由**外部閃電錢包**處理。客戶端**不解析金額、不代付、不做站內付款**。
- **不採 NIP-57 Zap**（見「Zap 評估」節）：`lightning` 僅為純 LN 位址導流，**不產生 kind 9734/9735、
  不強制公開收據、不接託管 zap 服務**。

### 2. 客戶端：桌面角落贊助卡（純導流）

- 桌面版連上 relay 後，對 **home relay 與使用者主動加入的 relay** 取 NIP-11；若有 `cinder_donations`
  非空，於**角落顯示低調、可關閉（dismiss 後記住）** 的「贊助此節點」小卡，列出營運者填的管道。
- 點擊以**系統瀏覽器開啟外部連結**（`github_sponsors`/`buy_me_a_coffee`/`liberapay`）。**App 不碰錢、
  不托管、不追蹤、無站內付款。**
- **只對 home 與明確加入的 relay 顯示**；**不**對「錨點/簽章清單自動塞入、使用者未選擇」的 relay 跳
  贊助卡（防蹭曝光/釣魚）。
- **框架與措辭**：呈現為「**此節點由其營運者提供，可自由贊助**」，為**營運者自報**、**無官方背書**、
  **非慈善聲明**、**永不自動付款**。

### 3. 行動端：不放

- 依 App 商店政策與隱私考量，行動端**不顯示**任何贊助入口（刻意）。

### 4. 企業模式：隱藏

- 工作身分鎖定公司自架座（ADR-0044）——不顯示贊助卡（無「贊助雇主 relay」語意）。依 profile 型別 gate。

## 理由

- **純導流**把「贊助入口」與「站內金流/錢包」徹底分離，守住 PRD §12 的「非金融 App」與「非廣告」界線。
- **NIP-11 是 Nostr 生態標準**，自架者填不填自主，去中心化、零強制。
- 對既有架構是小改動：健康探測本就會碰 relay，多一次 HTTP GET；relay 只需依 `Accept` 分支回應。

## Zap 評估（NIP-57，已評估）

Zap＝Lightning 付款 ＋ 一則**公開的 Nostr 收據**（kind 9735，載明付款方/收款方/金額）。評估結論：

- **用戶之間打賞：否決。** 公開收據把「誰付錢給誰」上鏈，直接摧毀本專案以 Gift Wrap 藏起的
  社交/身分圖譜；且 zap 需公開 kind 0 掛 LN 位址（撞 ADR-0061 不用公開 kind 0）、用途針對公開貼文
  （本專案無公開貼文）、站內付款撞 §12/商店。→ 不做。
- **捐款：採「純 LN 位址導流」，不採完整 zap。** 支援閃電捐款**不需要** zap 機制——本 ADR 的
  `lightning` 欄位讓使用者以外部錢包付即可，不碰站內金流、不強制公開收據、不接託管商。
- **可驗證捐款收據：列為未來、唯讀、選配。** 公開 zap 收據對「捐款透明」是優點（可查流水），
  未來若要強化可**唯讀消費**公開收據當佐證（見 ADR-0090），但那是**讀取公開資料**、非站內發起 zap。

## 後果

- 正面：支撐社群 relay 永續；使用者對「誰在幫我轉發」有可見度並可回饋；完全自願、可關閉。
- 負面 / 已知殘餘風險：
  - **地址為營運者自報**：UI 須誠實框為「此 relay 聲稱」，避免釣魚/偽裝知名 relay 騙捐；不自動付款。
  - **付款隱私在 App 之外**：導流後由使用者的外部帳號/錢包決定，App 不介入亦不保證；措辭須提醒。
  - **營運者財務誘因**：贊助可能給營運者「留住使用者/資料」的動機，與零狀態/隱私目標存在微弱張力；
    緩解＝隱私由協定層（Gift Wrap/E2E/TTL）強制，不依賴營運者善意（威脅模型本就假設其為對手）。
  - 未在 App 內驗證營運者身分（NIP-11 `pubkey` 可選揭露，但不強制對應捐款帳號）。
- 後續行動 / 待辦：
  1. relay `worker.ts`／`node-relay.ts` 依 `Accept` 回 NIP-11（含 `cinder_donations`），補測試；
     自架文件（ADR-0075 系列）加「如何填捐款欄位」。
  2. `packages/engine` 加 NIP-11 抓取；桌面 UI 角落卡（可關閉、企業隱藏、僅 home/手動加入 relay）。
  3. i18n 措辭（自報/無背書/外部連結提醒）。實作後更新 ARCHITECTURE.md。
