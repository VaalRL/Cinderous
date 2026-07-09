# 0066. Home relay 搬家（個人檔廣播帶 hint ＋ 舊站排水）

- 狀態：已接受
- 日期：2026-07-09
- 相關文件：docs/adr/0034（多中繼路由）、0035（hint 自動學習）、0036（hint 陳舊與離線回退）、
  0045（多身分設定檔）、0061（加密個人檔廣播）、0065（離線留言壽命上限）、0067（本地密碼）、
  apps/desktop/src/backend/relay-backend.ts、apps/desktop/src/storage/profiles.ts、packages/core/src/profile.ts

## 背景與問題

既有身分想更換 home relay 時，目前**唯一**路徑是「新增身分＋匯入同一把 nsec」，有三個缺陷：

1. **命名空間陷阱**：`addIdentity` 重建的 profile `namespace = pubkey`，若原身分是第一個
   （legacy `namespace = ""`），登錄被同 pubkey 覆蓋後命名空間切換——聯絡人與歷史
   「看似全部消失」，舊資料檔（`legacy.enc`／`nb.*` 鍵）淪為孤兒。
2. **漏信窗口**：聯絡人的客戶端靠學來的 hint 路由（ADR-0035），搬家後仍持續把訊息送到
   舊站，直到收到帶新 hint 的訊息才改道；舊站活著時 ADR-0036 的離線回退不會觸發，
   這段期間的來訊全數漏收（7 天後在舊站過期，ADR-0065）。
3. **hint 陳舊無法自癒**：`wrapProfile` 的 rumor `tags: []` 不帶 relay hint，
   而後端每次開機都 `broadcastProfile()` 給全聯絡人——這班現成的「全聯絡人廣播」是空車，
   浪費了讓 hint 定期自我修復的機會（ADR-0036 遺留的「stale 無自動清除」）。

## 考量的選項

- 選項 A：維持現況（nsec 重匯入）＋文件警告——不解決任何缺陷。
- 選項 B：**三階段搬家**（採用）——個人檔廣播帶 hint、專用更換 relay 流程、舊站排水。
- 選項 C：relay 端轉發/帳號遷移——違反零伺服器狀態鐵則，否決。

## 決策

分三個可獨立交付、各自向後相容的階段：

1. **個人檔廣播帶 hint**：`wrapProfile` 增加 `relayHint?`，寫入 rumor 內層 `["relay", url]`
   （加密、外層不可見，作法同 ADR-0036 的群訊）；`sendProfileTo` 帶上自己的 home。
   收端零改動——`receiveDm` 在分流 profile 前已呼叫通用的 `learnRelayHint`。
   效果：每次開機＝一次全聯絡人 hint 刷新，hint 陳舊自此可自癒。
2. **更換 relay 流程**：設定面板 relay 區塊由唯讀改為「顯示＋更換」；App 層 `changeRelay(url)`
   更新作用中 profile 的 `relayUrl` 並**完整保留 namespace／name／enterprise**（不走
   addIdentity 路徑），更新 `nb.relayUrl` 後 `location.reload()` 乾淨重建。重載後開機廣播
   （階段 1）自動通知全聯絡人改道。護欄：企業身分禁用（鎖定漫遊，ADR-0044/0048）、
   `wss://` 驗證與正規化、同值 no-op。
3. **舊站排水（drain）**：profile 增加 `previousRelayUrl?` ＋ `drainUntil?`（now＋7 天，
   對齊 ADR-0065 的 relay 端 TTL 上限——到期後舊站保證沒有自己的信）；未到期時 relay pool
   額外訂閱舊站的自家收件匣，收訊照走既有 event-id 去重；到期自動停，設定面板可提前完成。

**nsec 的角色定位**：僅用於「首次匯入／換機／救援（搬家）」，不作日常登入憑證
（否決理由與本地密碼設計見 ADR-0067）。

## 理由

- 搭現有便車：hint 學習入口通用、開機廣播已存在，階段 1 只補一個 rumor tag。
- 命名空間不動＝資料零損失；排水窗對齊 relay TTL＝漏信在數學上閉合。
- 三階段各自獨立上線，舊版客戶端收到多的 rumor tag 會忽略，無相容性斷點。

## 後果

- 正面：搬家全程身分連續、聯絡人自動改道、零漏信；hint 陳舊獲得自癒機制。
- 負面／已知殘餘風險：排水期間多維持一條連線；多裝置（ADR-0009）需各裝置自行操作，
  未來可由同步訊息帶搬家通知（記 backlog）。
- 後續行動：依 ROADMAP Phase H 的 H1→H2→H3 施工；完成後更新 ARCHITECTURE.md 資料流。
