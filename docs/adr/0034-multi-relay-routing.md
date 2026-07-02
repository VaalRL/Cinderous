# 0034. 跨中繼通訊：客戶端 Relay Pool 與收件人路由（不做 relay 聯邦）

- 狀態：已接受
- 日期：2026-07-02
- 相關文件：docs/adr/0005（自建 Worker relay）、0006（心跳容量）、ARCHITECTURE.md §2；
  apps/desktop/src/backend/relay-backend.ts

## 背景與問題

每個自架 relay（Cloudflare Worker + 單一 Durable Object 房間）是一座孤島：
兩個部署互不相識，A 的使用者無法與 B 的使用者通訊。需要「跨不同 worker」
的通訊路徑。

## 考量的選項

1. **客戶端多中繼（relay pool）＋好友 relay hint**：Nostr 原生模式
   （NIP-65 outbox 精神）。事件自含簽章、relay 只是不被信任的轉發者，
   client 對「對方的 relay」發布、在「自己的 relay」收件。
2. Relay 對 relay 橋接（伺服器端聯邦）：Workers 可開 outbound WebSocket，
   但對端清單需伺服器持久化（違反零伺服器狀態）、循環轉發、O(n²) 網格、
   DO 常駐外連成本。Nostr 生態刻意不做 relay 聯邦。
3. 多部署共用 D1：等價於單一部署，解決不了跨擁有者互通，否決。

## 決策

採 **選項 1**，relay 端零改動，全部落在客戶端與資料模型：

- **好友 relay hint**：`StoredContact` 加 `relayUrl?`。加好友時可附上對方
  的 relay（輸入 `npub…@wss://…`，或掃描對方分享的同格式字串；QR 內容
  在設定了 relay 時同樣帶上 `@relay`）。自動加入（收到陌生私訊）暫無 hint。
- **Relay Pool**（`RelayChatBackend` 內）：home relay（登入設定者）＋
  聯絡人 hint 中出現的外部 relay，惰性連線、各自指數退避重連；
  URL 正規化（trim、去尾斜線）後去重。未注入連線工廠時退回單 relay
  模式（行為與既有完全相同）。
- **路由規則**：
  - *Addressed 事件*（Gift Wrap 私訊/回應/收回/群組扇出、輸入中、Nudge、
    SDP/通話信令——皆帶收件人 `p` tag）→ 發到**收件人的 relay**（無 hint
    時退回 home）。群組扇出天然逐收件人路由（每個 wrap 讀自己的 `p`）。
  - *心跳（presence）* → 發到 **pool 中所有 relay**。多付 O(pool) 的
    Ephemeral 扇出，換得「不對稱認知」也能運作：對方沒記錄我的 relay
    時，仍能在他自己的 relay 上看到我在線。
  - *訂閱*：每個 pool relay 都掛完整收件箱（`#p` = 我：DM/信令/通話/
    輸入中/Nudge——對方無 hint 時會把訊息發到「他的 home」，而那正是
    我 pool 中的外部 relay）；presence 訂閱按聯絡人的 relay 分組
    （各 relay 只訂在該處發心跳的 authors）。
  - *去重*：同一事件可能經多個 relay 抵達，後端以 event id 全域去重
    （容量上限、超量折半清理）。
  - *連線指示*：UI 的連線狀態以 home relay 為準；外部 relay 重連後
    自行重掛訂閱，不干擾主指示。
- **相容性**：事件全為標準 NIP-01/17/59/40，任何相容 relay（含公開
  Nostr relay）皆可作為對方的 home；自家 PoW/AUTH/時鐘窗是各 relay
  自己的入場條件，不影響互通。

## 理由

- 信任模型不變：內容 E2E 加密、社交圖譜被 Gift Wrap 遮蔽，多中繼甚至
  進一步分散 metadata。
- 成本可控：心跳扇出 = O(pool 大小)（實務上好友分佈的 relay 數很小），
  ADR-0006 的容量估算按 pool 大小線性重估即可。
- 零伺服器改動、零新協定：孤島問題在客戶端一層解決。

## 後果

- 正面：任意兩個自架 worker 的使用者可互通；與公開 relay 理論相容。
- 負面／已知限制：離線送達依賴**對方** relay 的持久層在線；對方未記錄
  我的 relay 時，他看得到我在線（心跳全 pool 發）、我也收得到他的訊息
  （收件箱全 pool 訂），但**我看不到他的在線**（他的心跳只發他的 pool）——
  補上 hint 即恢復對稱。行動端多 WebSocket 的耗電影響留待 Tauri/行動版
  實測。
- 後續：relay hint 的自動學習（從來訊 metadata 或 NIP-65 事件）、
  設定 UI 顯示 pool 連線狀態。
