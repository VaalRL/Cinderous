# 0380. 錨點中繼移植 SDK 的收件確認：收件人處理完的包，2 小時後就過期

- 狀態：已接受 (Accepted)——2026-10-13 使用者同意部署（「同意部署」）
- 日期：2026-10-13
- 相關文件：ADR-0160（站方保存上限為權威）、0260（NIP-62：同為「命令」型事件）、0367（未註冊應用的保存期 2 小時）、
  0369（車道發挑戰但不強制 AUTH）、0371（檔案車道、每收件人 1,440 塊）、0376（拒收詞元）、0379（上一次移植 SDK 中繼功能）；
  SDK（cinderous-sdk-dev）ADR **0067**（收件確認後提早過期；本 ADR 的移植基準）、0068、0080；
  CinderSync ADR 0049（接上收件確認）、0072（實機發現錨點沒有宣告）；
  `packages/core/src/inbox-ack.ts`、`relay/src/relay-core.ts`、`message-store.ts`、`sql-message-store.ts`、`reject-messages.ts`、
  `host-config.ts`、`nip11.ts`、`worker.ts`、`node-relay.ts`

## 背景與問題

SDK v0.51（ADR 0067）加了收件確認：收件裝置處理完、狀態存好之後，告訴中繼「這幾顆我收好了」，中繼把寄給它一人的那幾列降為「現在＋2 小時」到期。
客戶端只對 NIP-11 宣告了 `cinder_inbox_ack` 的中繼送。CinderSync 從 ADR 0049 起就接上了，但**錨點沒有這個功能**——2026-10-13 實機：

- 錨點（v0.0.18）的 NIP-11 沒有 `cinder_inbox_ack`，CinderSync 從來沒送過確認，檔案塊放滿 7 天；
- A 在 `/app/cindersync` 上的收件匣有 **1,440 則**檔案塊（約 126 MB）——正好是每收件人的上限（ADR-0371），之後寄給 A 的會被拒收或改送備援；
- 每次連上，常駐訂閱（往回兩天）與補拉都把同一批再下載一次（實機每次約 60 MB＋126 MB）；重啟同步服務後的那一輪要花約 150 秒。

原本的計畫是 PR #9（錨點改跑 SDK 中繼）一併帶進來，但 PR #9 落後 main 37 個 commit、SDK 停在 v0.18，而且要等 SDK 公開才合併。

## 考量的選項

- 選項 A：等 PR #9。——不知道要等多久，期間 CinderSync 的收件匣一直是滿的。
- 選項 B（採用）：照 ADR-0379 的做法，只把 SDK ADR 0067 的**中繼端**移植進錨點；PR #9 不動。

## 決策

### 1. 移植（與 SDK 逐字相同，只差 import 路徑與 ADR 編號的註解）

| SDK | 錨點 |
|---|---|
| `protocol/inbox-ack.ts`：`INBOX_ACK_KIND`（25190）、`INBOX_ACK_MAX_IDS`（500）、`buildInboxAck`、`inboxAckIdsOf` | `packages/core/src/inbox-ack.ts`（`buildInboxAck` 只收原始私鑰——core 沒有 `NostrSigner`）；App 與 engine 沒有用過 25190 |
| `OfflineStore.ackInbox`（選用）＋兩種儲存的實作 | `message-store.ts`、`sql-message-store.ts`：只提早、不延後；寄給多位收件人的事件不動；SQL 版走主鍵、不讀 json |
| `RelayCore` 的 `inboxAckGraceSec` | 位置與 NIP-62 相同（速率限制之後）：不存、不扇出；沒 AUTH 回 `auth-required` 並重發挑戰；簽章者不是 AUTH 身分回 `restricted: self-only:`；格式不對回 `invalid: malformed:` |
| `inboxAckGraceFor` | `host-config.ts`：`min(這顆 DO 的保存上限, PUBLIC_LANE_RETENTION_SECONDS)`，Worker、Node 宿主與 NIP-11 共用 |
| NIP-11 `cinder_inbox_ack: { kind, grace_sec }` | 兩個宿主預設都宣告；Node 版 `REQUIRE_AUTH=0` 不處理也不宣告 |
| 拒收句子 `ackSelfOnly`、`ackMalformed` | **逐字相同**（`reject-messages.test.ts` 釘住） |

錨點沒有 SDK 的「唯讀寬限期」（SDK ADR 0052），所以沒有那一個例外。

### 2. 不改的

- 沒有 schema 變更、沒有新的環境變數：寬限比照未註冊應用的保存期（使用者 2026-10-11 對 SDK ADR 0067 的裁示），不另開設定項。
- 嚴格平面、車道、檔案車道都處理（每顆 DO 照自己的保存上限算寬限，錨點都是 2 小時）。

## 後果

- ＋ CinderSync 處理完的包 2 小時後就從錨點消失：收件匣不再塞滿 1,440 則上限，重複下載大幅減少（SDK ADR 0067 的模擬：佔用 243.6 → 11.1 MB、重複下載 86% → 40%）。
- ＋ 對 App v0.0.18 沒有影響：它不送 25190；以前 25190 會被當成一般瞬時事件轉發，現在被攔下當命令（沒有任何客戶端用它當瞬時事件）。
- － 已經在中繼上的 7 天份要等收件人下一次補拉、處理完才會確認（之後 2 小時消失）；不是部署當下就清空。
- 對隱私：中繼本來就從 AUTH 知道誰上線；確認只帶外層 id，不新增可推知的資訊（SDK ADR 0067〈效益不包括的〉）。
- 部署：
  - 先記兩座的回滾點（`wrangler deployments list`）；錨點 2 在另一個 Cloudflare 帳號，每個指令都帶 `CLOUDFLARE_ACCOUNT_ID`，用 `wrangler.toml`＋`--env=""`（`npx wrangler@4`）。
  - 沒有遷移；部署後查兩座的 NIP-11（嚴格平面與 `/app/cindersync`）有 `cinder_inbox_ack`，並用 CinderSync 實機確認確認事件回 `OK true`。
- 驗證：`packages/core/src/inbox-ack.test.ts`、`relay/src/inbox-ack.test.ts`（兩種儲存＋`RelayCore`）、`nip11.test.ts`、`worker.test.ts`〈RelayRoom — 收件確認〉、`reject-messages.test.ts`。
