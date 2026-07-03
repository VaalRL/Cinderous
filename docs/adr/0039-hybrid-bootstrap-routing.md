# 0039. 混合式引導路由：錨點常數 + 簽章清單 + home 自動遞補

- 狀態：已接受
- 日期：2026-07-03
- 相關文件：docs/adr/0034（Relay Pool）、0035（hint 學習）、0036（stale/雙發）、
  0006（心跳容量）；packages/core/src/bootstrap.ts、
  apps/desktop/src/backend/relay-backend.ts、.github/workflows/relay-health.yml

## 背景與問題

單一 home relay（自架 Worker）下架時，雖然 Relay Pool（0034）＋hint 學習
（0035）＋stale/雙發（0036）已提供大量自癒能力，但仍有兩個缺口讓「零動作
遷移」不成立：

1. **pool 沒有引導來源**：pool 目前只由「home＋聯絡人 hint」構成。若雙方
   原本都只認 Node1，Node1 死後兩人的 pool 裡沒有任何共同的活節點，
   無從相遇（啟動悖論／SPOF）。
2. **home 不會自動遞補**：`nb.relayUrl` 固定，home 死掉後心跳/收件箱的
   落點沒有替補，`selfShareUri` 也停在死 relay。

需求：Node1 下架後，A、B **不做任何動作**即改由 node2 通訊。

## 考量的選項

- **引導清單來源**：(a) GitHub `relays.json` 每次啟動 HTTP fetch（PRD 原案）；
  (b) **維護者簽章清單，以 Nostr replaceable event 帶內傳播為主、GitHub
  HTTP 為後備**；(c) 純硬編碼、不動態擴充。
- **信任根**：(x) 信任 GitHub repo/Actions 供應鏈；(y) **維護者簽章金鑰**，
  GitHub/Nostr 皆僅為發佈通道。
- **冗餘廣播**：(p) 無條件向 2–3 座併發；(q) **主路由優先、失效才有界冗餘**。

## 決策

- **錨點常數採硬編碼 2–3 座**（非 PRD 的單座；域名級 SPOF 需多錨點，
  對齊 BitTorrent bootstrap／Bitcoin DNS seeds 慣例）。宣告為 `ANCHOR_RELAYS`
  常數，常規 UI 不可刪除；僅作保底與清單引導。
- **清單採 (b)+(y)**：`RelayListDoc = { relays, updatedAt }` 由維護者金鑰
  簽章（沿用 NIP-01 事件：kind `RELAY_LIST=10037`、pubkey=維護者、內容為
  JSON）。傳播以 **Nostr 帶內為主**——清單事件發佈在錨點與各 pool 座上，
  客戶端連上任一座即透過既有訂閱機制取得；**GitHub raw HTTP 為後備**
  （僅當帶內取得失敗時，帶抖動、快取，非每次啟動 fetch）。
  - **驗簽**：`verifyRelayList(event, maintainerPubkey)` 通過才採用。
  - **防清空**：採用前檢查 `relays.length >= MIN_LIST` 且較本地
    **last-known-good** 的 `updatedAt` 新；否則保留 last-known-good。
  - 信任根＝維護者公鑰（硬編碼常數）；GitHub/Actions 被入侵也無法偽造
    清單（簽章驗不過）。
- **pool 組成**：`ANCHOR_RELAYS ∪ 簽章清單 ∪ home ∪ 聯絡人 hint`，正規化
  去重；bootstrap 座（錨點＋清單）取健康前 `BOOTSTRAP_FANOUT=3` 座納入
  心跳扇出，避免隨清單膨脹把 ADR-0006 容量模型乘上清單長度。
- **冗餘廣播採 (q)**：主路由（收件人 hint→home）優先；主路由 offline/stale
  時，把 ADR-0036 的「雙發」一般化為向健康 bootstrap 座 `REDUNDANT_K=2`
  的有界併發。收端 event id 全域去重（0034）吸收重複。
- **home 自動遞補**：home 連續離線超過 stale 門檻且 pool 中有健康 bootstrap
  座時，自動將 home 切為該座（更新 `nb.relayUrl`、`selfShareUri`、心跳/
  收件箱落點），並**事後通知使用者**（分享字串語意已變，不靜默）。
- **健康探測**：Nostr 無應用層 PING（NIP-01）；探測一律 `REQ`→等 `EOSE`
  往返（順帶驗證對端確為 relay）。GitHub Actions cron 每小時據此剔除逾時
  節點、never-empty 守門、以維護者金鑰簽章後發佈。

## 理由

- 帶內傳播讓清單搭著它所描述的網路擴散，避免每次啟動對 GitHub 洩漏
  存在性 metadata（與否決信譽 API／NIP-65 同一潔癖）。
- 簽章把信任根從「GitHub 供應鏈」收斂到「維護者金鑰」，供應鏈被入侵
  的爆炸半徑歸零。
- 有界冗餘＋bootstrap 上限讓可用性提升不以社群節點的免費額度為代價。

## 後果

- 正面：Node1 下架後，雙方啟動即由錨點/清單相遇，第一則訊息經 hint 學習
  自癒到 node2，全程零動作。
- 負面／限制：兩端都需新版客戶端；錨點域名與維護者簽章金鑰為人類持有的
  信任根（無法程式化保管）；Node1 D1 未取件的離線留言仍隨下架消失；
  home 自動遞補會改變 `selfShareUri` 語意（故採「自動＋通知」）。
- 後續：多維護者門檻簽章（去單一金鑰信任）、清單事件的 relay 端優先保留、
  錨點健康的客戶端被動學習。
