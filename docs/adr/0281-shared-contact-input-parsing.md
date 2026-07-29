# ADR-0281：加好友輸入的解析上移共用，與 i18n 佔位符漏傳修正

- 狀態：已接受
- 日期：2026-07-29
- 相關：ADR-0034（中繼提示與多中繼路由）、ADR-0117（記住我／解鎖）、ADR-0280（行動端 QR 加好友）

## 脈絡

ADR-0280 的 APK 交付後，實機回報兩個問題。

### 一、掃桌面版的 QR 被回「掃到的內容不是 npub」

桌面「我的 QR」編的不是裸 npub，而是 `selfShareUri`＝**`npub…@wss://…`**
（`RelayChatBackend.selfShareUri`：npub 加上 home relay，供 ADR-0034 的多中繼路由）。

後端 `addContact` 本來就吃這個格式——它自己做了切分：

```ts
const [rawNpub, inlineHint] = input.trim().split(/[@\s]+/, 2);
```

但 ADR-0280 的掃描驗證另外寫了一份，**只認裸 npub**：

```ts
npubDecode(v.trim());   // `npub@wss://…` 在這裡直接丟例外
```

同一個輸入格式，兩處各寫一套規則，於是「後端加得進去的東西，掃描端擋在門外」。
這不是驗證太嚴，是規則不一致。

### 二、解鎖畫面印出字面「歡迎回來，{name}」

`unlock_title` 的內容是 `"歡迎回來，{name}"`，插值靠 `translate(locale, key, params)`
的第三個引數。桌面有傳（`t("unlock_title", { name })`），**行動端漏了**
（`t("unlock_title")`），佔位符就原樣印在畫面上。

參數是選填的，所以 TypeScript 擋不住這種漏傳。

## 決策

### 1. 切分規則上移 `packages/core/src/contact-input.ts`

- `parseContactInput(input)` → `{ npub, hint }`：只切分、不驗證。
- `isContactInput(input)`：UI 送進 `addContact` 前的把關（裸 npub 與 `npub@relay` 都收）。

`RelayChatBackend.addContact` 與行動端掃描**都改吃這一份**。同一個輸入格式只該有一份規則。

### 2. 行動端的 QR 也出示分享字串

先前行動端 QR 編的是裸 npub，掃到的人拿不到中繼提示。改為
`backendRef.current?.selfShareUri ?? selfNpub`，與桌面同一種內容（無 home relay 時退回裸 npub）。

### 3. `unlock_title` 補傳參數，並移除重複的名字

行動端改為 `translate(locale, "unlock_title", { name })`。原本標題下方另有一行單獨顯示名字，
補上插值後名字會出現兩次，故移除該行——與桌面同一種呈現。

### 4. 掃過全庫其餘漏傳

寫了一次性掃描：取出 45 個帶 `{placeholder}` 的訊息鍵，比對所有 `t("key")` /
`translate(x, "key")` 的呼叫是否漏帶參數。除行動端這處外，只有桌面
`SettingsPanel` 的 `vanish_sent` 以手動 `.replace("{n}", …)` 處理——功能正確但繞過了
正規 API，一併改為 `t("vanish_sent", { n: sentTo })`，免得這種寫法被照抄。

## 後果

**正面**

- 掃桌面／行動端任一方的 QR 都能加好友，且帶得到中繼提示。
- 加好友輸入格式的規則只有一份，不會再各自漂移。
- 解鎖畫面不再印出佔位符。

**負面／代價**

- `isContactInput` 只驗 npub 部分解得開，**不驗中繼提示是否為合法 URL**——
  那由 `normalizeRelayUrl` 在 `addContact` 內處理（既有行為，未改）。
- 行動端顯示與複製的內容從裸 npub 變成 `npub@wss://…`，字串變長。這與桌面一致，
  且 `addContact` 兩種都收，但使用者若習慣看裸 npub 會覺得不同。

**待辦**

- 型別上無法強制「帶佔位符的鍵必須傳參數」。目前靠本批的一次性掃描與個別測試；
  若日後再犯，可考慮把掃描做成 i18n 套件的常駐測試（需跨套件讀取 app 原始碼，
  故未在本批實作）。
