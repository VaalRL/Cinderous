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
{ "relays": ["wss://relay.你的網域.tw", "wss://node2.某社群.com"], "updatedAt": 1 }
```
- Cron（每小時）會自動 REQ→EOSE 探測、剔除逾時者、簽章並**發佈到每座健康 relay**（客戶端連上即學到）。
- 想立刻跑一次：GitHub → Actions →「Relay 健康檢查」→ Run workflow（`workflow_dispatch`）。

### A6. 驗證上線
- 本機模擬：`PORT=8899 node relay/dist/dev-server.js` 起一座、把它填進 relays.json、
  `MAINTAINER_NSEC=<nsec> pnpm --filter @cinder/relay bootstrap:run`，
  應看到 `✅ 探測` → `已簽章 kind 10037` → `📡 發佈至 …`。
- 真機：兩台裝置填好 A3 設定，其一 home 指向會下架的節點，關掉該節點後觀察訊息是否仍送達（經錨點），5 分鐘後 home 是否自動遞補（設定面板連線狀態）。

> **物理極限（任何方案都一樣）**：A、B 兩端都要跑「填好 A3 設定」的新版；下架節點上**尚未取件的離線留言**會隨之消失（NIP-40 本來也只存 7 天）。

---

## B. 此環境（雲端沙箱）無法執行、需你在對應環境完成的事

> 以下皆非程式缺口——**程式已完成並全綠測試**，只是最後一哩需要 Tauri/Cloudflare/RN 工具鏈、外部帳號、實體伺服器或外部人員，此開發環境做不到。

| 項目 | 需要 | 對應 | 現況 |
| --- | --- | --- | --- |
| 中繼站生產部署 | Cloudflare 帳號、`wrangler deploy`、D1 綁定、NIP-42 AUTH | Phase C（C1–C4） | 程式/測試已備，離線留言待接 D1 |
| Tauri 桌面打包 | Tauri 工具鏈、簽章憑證、OS 金鑰庫（keyring） | Phase B（B1–B6） | Rust 背景連線/SQLCipher 已測，GUI 接線待驗 |
| 行動端 + QR 相機掃描 | React Native 工具鏈、APNs/FCM 憑證、相機權限 | Phase D、M9 | 大量重用 core/i18n；QR 產生已完成、掃描待 RN |
| **企業強制 TURN 真機驗證** | 部署 TURN 伺服器、把 `turnServers` 填入 `RelayPoolOptions` | G2（ADR-0048） | `forceTurn`→`iceTransportPolicy:"relay"` 程式已接（`buildRtcConfig`），缺 TURN 才能實測；同時作為通話 NAT 保底 |
| 第三方安全稽核 | 外部稽核員 | F4（`docs/SECURITY.md` 已備前置） | 前置威脅模型/加密盤點已備 |
| 企業 SSO / 元資料稽核 | 外部 IdP（AD/LDAP/OIDC）、自架 relay 記錄連線元資料 | G5 | 需先立 ADR 與環境；未動工 |

---

## C. 版本控制

- 功能開發在分支 `claude/audit-unused-directives-72ftvr`；已多次 fast-forward 合併到 `main`（最新含 Cinder 更名、@提及、對話串、G2 強制 TURN、M8 來電鈴聲）。
- 後續變更沿用同流程：分支開發 → 驗證全綠 → 經你同意再 `git merge --ff-only` 合回 `main`。

---

## D. 待你裁示才動工的功能（決策卡關，非環境）

- ~~**G4 企業金鑰託管**~~ → **已決策並實作**：否決金鑰托管（避免公司持有解密後門），改採「工作身分輪替」（ADR-0052）。換機/遺失＝管理者以名冊撤舊發新、成員端自動接續；「不想丟歷史」＝建議雙設備登記。
- **M7 語音訊息離線退回策略**：語音檔受中繼大小限制時的退回方式，需定案（`ROADMAP.md` 未決策 ADR）。
- **Discord/Slack 風格功能移植**：研究見 `docs/research/discord-slack-features.md`。其中**對話串（Thread）已實作**（ADR-0051，Slack 式右側面板）、**emoji reaction 已實作**（ADR-0011）；剩餘自訂頻道等仍待裁示才立 ADR。
