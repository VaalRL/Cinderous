# 0057. 開放中繼 NIP-42 AUTH（讀取＋發布；企業維持 allowlist）

- 狀態：已接受
- 日期：2026-07-08
- 相關文件：PRD §6/§8（威脅模型、防濫用）；ADR-0002（隱私基線）、0044（企業封閉 allowlist——刻意不用 AUTH）、0056（離線留言 DO SQLite）；ROADMAP C3
- 精化：ADR-0044「若未來需協定層讀取管制，再評估 NIP-42（另立 ADR）」

## 背景與問題

C1/C2 讓開放中繼**持久化**離線 Gift Wrap（kind 1059）。但現況**任何人**都能 `REQ [{ "#p": [某 npub] }]` 撈某人的離線留言：內容雖 E2E 密文，仍洩漏**元資料**（某 npub 有幾則待收、何時、大小）。PRD §8 明列要以 NIP-42 擋「匿名者大量拉取他人留言」。ADR-0044 為企業選了 allowlist、把 NIP-42 延後給開放中繼另議——即本 ADR。

## 決策

**開放中繼加 `RelayCore` 可選 `requireAuth`；讀取與發布皆需先 AUTH。企業維持 allowlist、不受影響。**

1. **AUTH 交握（NIP-42）：** 連線建立即發 `["AUTH", <challenge>]`（每連線隨機、不可預測）。客戶端以私鑰簽 kind 22242 事件（tags 含 `["challenge", challenge]`）回 `["AUTH", <event>]`。relay 驗簽 + kind + challenge 相符 → 記住該連線的**已認證 pubkey**。
2. **發布閘門：** `requireAuth` 下，連線**未認證**則 EVENT 回 `auth-required` 並（重）發挑戰。**關鍵：發布 AUTH ＝「連線已認證過」，不逐事件比對 `event.pubkey == 認證 pubkey`**——否則 Gift Wrap（臨時金鑰簽、藏寄件人）會被全數拒。事件本身簽章 relay 另驗（現有）。
3. **讀取閘門（隱私核心）：** 未認證的 REQ 回 `auth-required`。已認證下，**帶 `#p` 的 filter 要求其所有 `#p` 值 == 認證 pubkey**（只能拉自己的收件匣）。Cinder 客戶端所有 `#p` 訂閱皆 `#p:[自己]`，正常使用不受影響；攻擊者 `#p:[他人]` 被擋。
4. **企業不變：** allowlist（發布層）＋自架私網（讀取層）維持；`requireAuth` 於企業預設關（ADR-0044）。
5. **relay tag 不嚴格驗：** challenge 每連線唯一，已綁定「此 relay 此連線」，足以防跨連線/跨 relay 重放；故 `["relay", url]` tag 不強制比對（`RelayCore` 傳輸無關、不知自身 URL）。

## 理由

- **對上 PRD §8**：讀取 AUTH 關掉「第三方探測他人加密收件匣元資料」——真正的隱私加值。
- **誠實看待發布 AUTH**：Nostr 金鑰免許可，攻擊者隨手產一把即過 → **擋不住決心灌爆**（那靠 PoW/速率）；發布 AUTH 的實質是擋匿名連線 + 讓速率限制可綁 pubkey。使用者已知此取捨仍選讀+發布。
- **與企業一致**：`requireAuth` 為選項，企業續用 allowlist，不疊床架屋。

## 後果

- 正面：開放中繼下，只有本人能拉自己的收件匣；匿名連線無法讀寫。
- 負面 / 已知限制：
  - 發布 AUTH 因免許可金鑰價值有限（真正抗濫用靠 PoW/速率）。
  - **需客戶端支援**：`RelayClient` 要能接挑戰→簽 22242→回送（下一增量）；未支援前**不可在線上 relay 開啟**，否則現行客戶端全被擋。
  - relay tag 不嚴格驗（challenge 綁定已足；註明）。
  - `requireAuth` 對**所有**訂閱/發布生效（含 presence/心跳）——客戶端連線起始 AUTH 一次即可，之後皆通。
- 後續行動：
  1. **本增量（core + relay）：** core `nip42`（AUTH_KIND/buildAuthEvent/authChallenge）；protocol AUTH 訊息；`RelayCore.requireAuth` + 連線挑戰 + handleAuth + 發布/讀取/`#p` 閘門；測試。
  2. **下一增量（client + 啟用）：** `RelayClient` AUTH 接線（後端提供簽章）；worker.ts 開 `requireAuth`；真線上驗證。
