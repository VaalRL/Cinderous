# 0065. 離線留言壽命上限（無標籤給預設 TTL、超長標籤截斷——孤兒資料不可能）

- 狀態：已接受
- 日期：2026-07-09
- 相關文件：ADR-0056（SQLite 離線留言）、0057（AUTH）、0059（休眠）；PRD §8
- 觸發：審查發現 `prune` 只清 `expiration IS NOT NULL` 的列，而 `put` 接受無標籤事件（存 NULL）→ 永存。

## 背景與問題

我們自己的 client 對所有 gift wrap 一律帶 NIP-40 `expiration`（預設 7 天）。但 relay 是開放協定端點：
1. **無 `expiration` 的事件**（標準 Nostr 客戶端或惡意者）會落地成 NULL、永不清除。
2. **超長 `expiration`**（如 100 年）同樣近乎永存。
3. 寫入不受 AUTH 管（只有讀取有 #p inbox gate），惡意者可不斷換隨機收件人 pubkey 各塞滿 500 則（配額只管單一收件人）→ DB 無上限增長。

## 決策

**每列壽命必有界：存入時一律計算「有效到期時間」= `min(標籤值, now + 上限)`，無標籤即 `now + 上限`；上限預設 7 天（`maxTtlSeconds`，對齊 client 端 gift wrap 預設 TTL）。**

- `effectiveExpiration()` 共用 helper；記憶體版（`MessageStore`，以 id→exp map 追蹤）與 SQL 版（`SqlMessageStore`，直接落地非 NULL 欄位）行為一致。
- **遷移**：SQL 版建構時 `UPDATE … SET expiration = created_at + TTL WHERE expiration IS NULL`，讓修正前殘留列也能被 prune 收走。
- 已過期事件照舊拒收；prune／query 行為不變。

## 理由

- 「孤兒資料」從「靠 client 自律」變成「數學上不可能」——任何一列最多活 7 天。
- 搭配既有三層（7 天 TTL、每小時 DO alarm prune、每收件人 500 配額），隨機收件人塞爆攻擊的成本從「永久佔用」降為「最多 7 天的暫存」。

## 後果

- 正面：儲存有界、免費層安全；帳號本就不存在 relay（零伺服器狀態），孤兒帳號無此概念。
- 負面 / 已知限制：與期待「永存留言」的標準 Nostr 客戶端不完全互通（刻意；Cinder 是自足生態、中繼只做短期信箱）。閱後即焚（disappearAt）不受影響（一定 ≤ 上限才有意義）。
- 測試：無標籤套預設 TTL、超長截斷、NULL 遷移（SQL + 記憶體版共 5 例）。
