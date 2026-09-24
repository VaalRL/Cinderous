# 0369. 車道的訂閱範圍檢查不再依附 `requireAuth`，並提供可選的 NIP-42 AUTH

- 狀態：已接受
- 日期：2026-09-24
- 相關文件：ADR-0366（§決策 5「寬鬆車道只開三道閘」）、ADR-0123（訂閱必須具名）、
  ADR-0057（NIP-42 AUTH、`#p` 只能是自己）、ADR-0368、`relay/src/relay-core.ts`

## 背景與問題

ADR-0366 §決策 5 規定車道只放寬三件事：`scoped()` 另接受標籤 filter、可尋址讀取閘收窄、
`requireAuth` 可關。**裸 filter（`{"kinds":[…]}`、`{}`）與指向別人的 `#p` 仍然要擋**。

撰寫官網開發者文件時對照程式碼，發現車道上**根本沒有做範圍檢查**：

```ts
if (this.requireAuth && !this.scoped(connId, msg.filters)) { … }   // relay-core.ts
```

`scoped()` 只在 `requireAuth` 為真時執行，而上線的車道設定是
`guardFor("app")` ＝ `{ publicLane: true, requireAuth: false }`。以該設定實測：
`{"kinds":[20000]}` 與 `{"#p":[別人]}` 都回 `EOSE`（放行）。

沒有被測試抓到的原因：車道的測試全部用 `requireAuth: true ＋ publicLane: true` 組 core，
與上線設定不同——測試測的是一個產線上不存在的組合。

此時已合併（PR #6）但**尚未部署**。

修掉它會碰到第二個問題：車道**不發 AUTH 挑戰**（`connect()` 在 `!requireAuth` 時直接返回），
`handleAuth` 在沒有挑戰時一律拒絕 ⇒ 車道上**無法做 AUTH**。範圍檢查一旦生效，
「`#p` 只能是自己」就會變成「`#p` 一律不能用」，而遊戲規格（`game-layer-spec.md` §八）
的指名信令正是 `{kinds:[20078], "#p":[自己]}`。

## 考量的選項

- **A：範圍檢查一律執行（`requireAuth || publicLane`）；車道也發 AUTH 挑戰但不強制。**
  做了 AUTH 的客戶端可用 `#p`（自己）；沒做的只能用標籤與 `authors`。寫入維持不需 AUTH。
- **B：只擋裸 filter，`#p` 在車道上不設限。** 最簡單，但任何人都能訂閱別人的 `#p`，
  看到「誰在何時被誰邀請」——遊戲玩家的元資料外洩。
- **C：維持現狀，改寫 ADR 與文件配合。** 車道等於一座不限查詢的公共中繼：
  成本上有消防水管，且違反 ADR-0366 §決策 5。

## 決策

採用 **A**。

1. `REQ` 的範圍檢查條件由 `requireAuth` 改為 `requireAuth || publicLane`。
2. `connect()` 在 `publicLane` 時也發 AUTH 挑戰（`requireAuth` 仍為 false ⇒ 發事件、
   訂閱標籤 filter 都**不需要** AUTH）。
3. 車道的 `restricted:` 拒絕訊息改為英文，並點出三條合法路徑（標籤 filter、`authors`、
   AUTH 後的 `#p` 自己）——讀者是第三方開發者。嚴格平面的訊息不變。
4. 車道行為的測試**一律以 `guardFor("app")` 組 core**，不再用自組的選項組合。

## 理由

- 這是讓實作回到 ADR-0366 的原意，不是新政策：裸 filter 與別人的 `#p` 本來就該擋。
- 可選 AUTH 是讓「`#p` 只能是自己」在車道上**有辦法成立**的最小改動：
  身分只有 AUTH 證明得了，而不強制則保住了 ADR-0366 的前提——《辭職信》這類
  不處理 AUTH 的客戶端仍然能用標籤訂閱與發事件（挑戰訊息會被它忽略）。
- 選項 B 讓元資料外洩；選項 C 讓成本失控。兩者都比多發一則挑戰貴。

## 後果

- 正面：
  - 車道的消防水管關上；別人的 `#p` 看不到。
  - 支援 AUTH 的第三方客戶端可以在車道上收指名信令。
  - 測試與上線設定對齊，同類錯誤（測了一個不存在的組合）不會再發生在車道上。
- 負面 / 已知殘餘風險：
  - 車道連線多收一則 `["AUTH", challenge]`。依 NIP-42，不處理 AUTH 的客戶端應忽略它；
    若有客戶端把未知訊息當錯誤，會在這裡出現。
  - 車道上做了 AUTH 的連線，事件速率改以 AUTH 身分計數（與嚴格平面相同）；
    沒做的仍以事件作者計數。
- 後續行動 / 待辦：
  - 官網開發者文件（ADR-0368）的「訂閱」與「認證」兩頁依本 ADR 撰寫。
  - `docs/relay-changes-adr-0366-0367.md` 中「車道仍擋裸 filter」一句，在本 ADR 之前
    的程式碼上並不成立，已加註更正。
