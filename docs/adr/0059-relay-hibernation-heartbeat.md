# 0059. 中繼站 WebSocket 休眠化 + 心跳間隔 30 秒（降免費層 duration/請求）

- 狀態：已接受
- 日期：2026-07-08
- 相關文件：PRD §8（容量模型）；ADR-0006（部署/容量，待回填）、0056（DO SQLite）、0057（NIP-42 AUTH）、0058（回條）；ROADMAP C4
- 觸發：容量分析發現「單一 global DO 用標準 WebSocket API → 24/7 常駐、光是開著就吃掉免費層 duration 約 83%（~10,800／13,000 GB-s/day）」

## 背景與問題

Cloudflare 免費層 Durable Objects：請求 100,000/day、**運算時長 13,000 GB-s/day**。進來的 WS 訊息以 **20:1** 計為請求（標準/休眠模式皆同）。原 relay 用**標準 WebSocket API**（`server.accept`）：只要有人連著，DO 就常駐記憶體、**持續計 duration**（與人數/好友密度無關，單房間 24/7 ≈ 10,800 GB-s/day）。這是免費層最先撞頂的瓶頸。

## 決策

**改用 WebSocket Hibernation API，並把心跳間隔 15s→30s。**

1. **休眠式接受：** `ctx.acceptWebSocket(server, [connId])` 取代 `server.accept()`；改用 `webSocketMessage/Close/Error` handler。DO 於訊息間可休眠、**不計 idle duration**（官方例：中等流量 ~$139→~$10/月）。
2. **狀態跨休眠存活：** 休眠會清空記憶體（constructor 重跑、`RelayCore` 全新）。故每連線的「挑戰／已認證 pubkey／訂閱 filters」存在其 **WebSocket attachment**（`serializeAttachment`，每次狀態變動後寫回）；喚醒時（`ensureHydrated`）從**所有存活連線的 attachment** 重建 `RelayCore`（新增 `exportConn`/`rehydrate`，純還原、無副作用）。
3. **路由以 tag：** `connId` 作為 WebSocket tag，`ctx.getWebSockets(connId)` 找回連線送訊息。
4. **心跳 30s、離線門檻 90s：** `HEARTBEAT_MS` 15→30（請求/CPU 減半）；`PRESENCE_TIMEOUT_MS` 45→90（維持 3× 心跳容忍，不因單次遲到就翻離線）。
5. **請求計費不變：** 20:1 標準/休眠皆同——本改動**只省 duration**，不增加請求（另由心跳拉長獨立減半請求）。

## 理由

- Duration 是免費層最緊的瓶頸；休眠把「整天空等」的費用砍掉，**不動請求那條帳**（純賺）。
- attachment 還原（非 DO storage）避免「每次喚醒讀全部連線」的**二次方 storage 讀取**問題；attachment 讀取隨 WebSocket 免費。
- 心跳 30s 對「上線即時性」影響小，但請求/CPU 直接減半。

## 後果

- 正面：閒置時 duration 趨近零；免費層可容更多房間/使用者；請求不變。
- 負面 / 已知限制：
  - **attachment 上限 16 KB**：存訂閱 filters（presence sub 的 `authors` 為聯絡人清單）。約 **>240 位聯絡人**的極端使用者可能超限 → 該連線狀態無法完整存回、休眠後會掉訂閱（優雅退化：重連即恢復）。日後可改存 DO storage + attachment 只放 key。
  - 高流量時 DO 甚少真正休眠（訊息密集）→ duration 省得有限，但那時通常已上付費層。
  - **需線上驗證**：休眠行為屬執行期，單元測試只涵蓋 `exportConn`/`rehydrate` 還原邏輯；部署後以「連線→訂閱→靜置至休眠→再送訊息確認仍收得到」實測。
- 後續：回填 **ADR-0006 / C4** 的容量模型（本 ADR 的量級估算）。
