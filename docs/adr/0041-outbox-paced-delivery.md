# 0041. 可靠訊息節流外送匣（Outbox）

- 狀態：已接受
- 日期：2026-07-04
- 相關文件：docs/adr/0027（群組成對扇出）、docs/adr/0034（Relay Pool 與收件人路由）、docs/adr/0036（hint 陳舊與離線回退）；packages/core、apps/desktop backend

## 背景與問題

群組聊天以「對每位成員各發一個 kind 1059 Gift Wrap」扇出（ADR-0027）。原本 `publishAddressed` 在同步 for 迴圈中一次把 N 份即發即忘：

- **無節流**：對外部 relay（ADR-0034 pool）可能一次突發 N 筆，踩到其發布速率限制。
- **無重試**：relay 以 `OK` 逐事件回 accept/reject，但客戶端**完全不處理**（`relay-client.ts` 的 `onOk` 無人接）；暫時性拒收或送出時斷線即永久遺失。
- **重連盲送**：連接器層的 `pending` 緩衝在重連時**一次全部盲送**、無節流、無「只補未確認」概念。

需要一個機制在不破壞既有隱私與中繼假設下，提升**可靠訊息**（DM、群訊、群組控制）的投遞成功率。

> 注意：本 ADR **不**解決「單事件過大」或「每收件人儲存上限逐出」——前者需分塊/去重（大自製貼圖另案），後者屬 relay 保留策略。排隊只治「突發被限速 / 暫時失敗 / 重連補送」。

## 決策

在 `packages/core` 新增純狀態機 **`Outbox`**，並於 `RelayChatBackend` 整合：

1. **範圍**：只有**可靠訊息**（kind 1059：`sendMessage`/`sendReaction`/`unsendMessage`/`sendGroupMessage`/群組控制）改走 `publishReliable`→Outbox。**延遲敏感的 ephemeral**（WebRTC 信令、輸入中、心跳）維持 `publishAddressed` 直送，不被節流。
2. **節流**：以 `maxInflight`（預設 4）限制同時在途；`publishReliable` enqueue 後立即 pump 一次，其餘由 200ms 泵計時器續送。
3. **OK 感知**：home client 的 `onOk` 轉入 Outbox，依 NIP-01 前綴分類——`accepted`/`duplicate`→確認移除；`rate-limited`/`error`/未知→退避重試（`base × 2^attempts`，上限 `maxRetries` 後 `onDrop` 回報）；`blocked`/`invalid`/`pow`/`restricted`/`mute`→永久失敗立即 `onDrop`。
4. **重連補送**：`onConnection("online")` 呼叫 `onReconnect()`，把未確認在途改回 queued 立即補送（取代盲送）。
5. **絕不誤判失敗**：觀察不到 OK 的路徑（如未接 OK 的冗餘座）在 `inflightTtl`（30s）後**靜默丟棄、不回報失敗**，避免對實際已送達者顯示「未送達」。

## 理由

- **對症**：`maxInflight` 節流直接緩解外部 relay 突發限速；OK 重試救回暫時性失敗；`onReconnect` 只補未確認者，優於連接器的盲送。
- **不傷即時性**：把 ephemeral 信令排除在外，通話/輸入中延遲不受影響。
- **保守安全**：純狀態機、時鐘可注入、11 項單元測試；整合後既有 160 項桌面測試全綠（群訊/DM 投遞經新路徑仍正確）。「逾時靜默丟棄」的預設避免誤報。
- **Fix-First**：延伸既有 `publishAddressed` 路由與 `onOk` 掛鉤，不另建平行發送系統。

## 後果

- 正面：群組扇出與 DM 的投遞更穩健（尤其接第三方 relay 時）；重連後自動補送；relay 明確拒收可被重試或回報。
- 負面 / 已知限制：
  - 目前只在 **home client** 觀察 OK；經**外部座/foreign 路由**的事件不被 OK 追蹤，靠 `inflightTtl` 假設送達（不誤報，但也不重試）。全座 OK 路由為後續。
  - `onDrop` 目前僅 `console.warn`；**UI「未送達」提示**為後續（需擴 `ChatBackendEvents`）。
  - 不解決單事件過大與每收件人儲存上限逐出（各為獨立議題）。
- 後續行動：把 OK 路由擴到所有 pool 座；為 `onDrop` 接 UI 提示與手動重送；評估把連接器 `pending` 盲送也導入相同節流。
