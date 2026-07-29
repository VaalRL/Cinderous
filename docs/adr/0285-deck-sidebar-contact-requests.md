# ADR-0285：三欄佈局補上訊息請求區與已封鎖名單

- 狀態：已接受
- 日期：2026-07-29
- 相關：ADR-0079（三欄佈局）、ADR-0121（訊息請求：不給陌生人回饋）、ADR-0127（請求防洪）、ADR-0214（三欄版補齊列操作）、ADR-0284（QR 帶自報名稱）

## 脈絡

實機回報：從行動端加對方好友後，**對方那側完全沒看到邀請**。

追下去是 `App.tsx` 的一處漏接。兩個側欄的 props 這樣傳：

```tsx
<DeckSidebar        … {...addContactProps} />               // 三欄佈局
<ContactListWindow  … {...addContactProps} {...manageProps} />  // 經典佈局
```

而 `requests` / `onAcceptRequest` / `onDeclineRequest` / `onOpenRequest` /
`onClearRequests` 全都在 **`manageProps`** 裡。三欄佈局從來沒拿到它們，
`DeckSidebar` 也就從來沒有請求區——`grep -c request DeckSidebar.tsx` 是 **0**。

後果比「少一個區塊」嚴重：

- 對方把你加為好友 → 引擎確實收到、確實寫進請求區、確實 emit。
- 但你在三欄佈局下**看不到任何東西**，於是永遠不會按接受。
- ADR-0121 規定「接受之前不回送個人檔」，所以雙方的顯示名稱都停在 `npub1abc…`。
- 使用者的體感是「加好友沒有用」。

這也是 ADR-0284 那份回報的另一半：名字之所以一直不出現，正是因為請求永遠沒被接受。

## 決策

`DeckSidebar` 補上請求區，`App.tsx` 把 `manageProps` 也傳給它。

結構與 class 與經典版**完全一致**（`.requests` / `.request` / `.request__ok` …），
共用 `msn.css` 既有樣式——不為三欄版另寫一套外觀。放在名冊**之前**：
這是需要使用者裁示的東西，不該被埋在聯絡人清單裡。

四個操作與經典版對齊：預覽（只開窗、不送已讀回條給非聯絡人）、接受、拒絕、封鎖；
兩筆以上才顯示「全部刪除」（ADR-0127 是防洪，不是單筆操作）。

## 後果

**正面**

- 加好友的迴圈終於閉合：對方看得到請求 → 接受 → 個人檔互換 → 雙方看到彼此的名字。
- 兩個佈局的請求體驗一致。

**負面／代價**

- 側欄又多一個可能佔高度的區塊。只在有請求時出現，且請求被處理後即消失。

### 同源漏接的稽核

既然成因是「`manageProps` 沒傳給三欄版」，就把該物件的每個鍵都對一次。
除了請求，還漏了 **`blocked` / `onUnblockContact`**——三欄版沒有已封鎖名單，
代表**封鎖之後沒有任何地方解得開**。一併補上（同樣沿用經典版的 class 與結構）。

`onRemoveContact` / `onBlockContact` 三欄版本來就個別傳過，不受影響。

**待辦**

- 這類「兩個佈局各接一半 props」的漏接，型別擋不住（全是選填）。本批補了
  `DeckSidebar.test.tsx` 的請求區與封鎖區斷言，並把 `manageProps` 整包對過一次；
  但其他 props 物件（如 `addContactProps`）未逐一稽核。
