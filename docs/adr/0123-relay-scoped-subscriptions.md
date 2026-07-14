# 0123. 中繼訂閱必須具名——不帶 `#p` 也不帶 `authors` 的 filter 是一支消防水管

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：**ADR-0057（NIP-42 AUTH：關掉第三方探測收件匣）**、0092（節點自報與一致性稽核）、
  0088（presence 元資料最小化）、0120（typing/nudge 封裝）、0119（健檢：本問題於該次發現）

## 背景與問題

### 🔴 缺口：ACL 只檢查「有 `#p` 的 filter」

ADR-0057 加了 NIP-42 AUTH 與收件匣 ACL：

```ts
/** 帶 `#p` 的 filter：其所有 `#p` 值須等於認證 pubkey（只能查自己的收件匣）。 */
private inboxAllowed(connId: string, filters: RelayFilter[]): boolean {
  for (const filter of filters) {
    const pValues = filter["#p"];
    if (pValues && pValues.length > 0 && !pValues.every((v) => v === self)) return false;
  }
  return true;
}
```

看仔細：**`pValues` 是 undefined 就直接放行。**

所以 `{"kinds":[20000]}`——沒有 `#p`、沒有 `authors`——**完全合法**。任何通過 AUTH 的人
（自己隨手產一把金鑰就能通過，AUTH 只證明你掌握某把私鑰，不代表你是誰）都能訂閱它，
然後拿到**全站每一則心跳**：

- 每一個在線使用者的 pubkey
- 他的狀態訊息（那行自由文字）
- 他正在聽什麼（ADR-0088 F5 把音樂併進了心跳）

**這不是「洩漏某個人的元資料」，是把整個使用者名冊連同即時線上狀態做成一支消防水管。**
攻擊者不需要事先知道任何 pubkey——這正是質變所在。

`{"kinds":[1059]}` 同理：拿不到明文（Gift Wrap 是加密的），但拿得到**全站的收件人 p-tag
與時間分布**——流量分析的完美輸入。

### 而合法的客戶端**從不**送出這種 filter

實際檢查引擎送出的每一個 filter：

```ts
{ kinds: [HEARTBEAT],  authors },          // 我的聯絡人
{ kinds: [TYPING],     "#p": me },
{ kinds: [NUDGE],      "#p": me },
{ kinds: [1059],       "#p": me, …since },
{ kinds: [SNAPSHOT],   authors: me },
{ kinds: [SDP_SIGNAL], "#p": me },
{ kinds: [CALL_SIGNAL],"#p": me },
{ kinds: [RELAY_LIST], authors: [maintainer] },
{ kinds: [ORG_ROSTER], authors: [orgAdmin] },
```

**每一個都有 scope**（`#p` 或 `authors`）。所以要求「filter 必須具名」，
對合法用法是零影響。

### 🔴 而且在查這件事時，發現一致性探測**現在就是壞的**

ADR-0092 的 `probeLive()` 這樣做：

```ts
ws.send(["REQ", "live", { kinds: [1], limit: 0 }]);   // ← 沒有 AUTH，也沒有 scope
// 等 EOSE
```

但我們的中繼是 `requireAuth: true`。實測：

```
未認證的 REQ → 回應: ["CLOSED", "AUTH"]     ← 永遠不會有 EOSE
```

**探測必然逾時 → `live: false`。** 而那個結果會餵進 `health-check` 的滾動 uptime
（`live = h.live + (conf.live ? 1 : 0)`）——也就是說，**每一次 cron，我們自己的中繼站都被
自己的健檢判定為「不存活」**，uptime 一路往下掉。

這兩件事必須一起修：探測不 AUTH 已經是壞的，而本 ADR 若再要求 filter 具名，它會更壞。

## 決策

### 1. 每個 filter 都必須**具名**：帶 `#p`（等於自己）或**帶** `authors`

```ts
private scoped(connId: string, filters: RelayFilter[]): boolean {
  const self = this.authState.get(connId)?.pubkey;
  for (const filter of filters) {
    const p = filter["#p"];
    if (p && p.length > 0) {
      if (!p.every((v) => v === self)) return false;   // 只能查自己的收件匣（ADR-0057）
      continue;
    }
    const authors = filter.authors;
    if (!authors) return false;                       // ← 沒有 authors ＝ 不過濾作者 ＝ 消防水管
    if (authors.length > MAX_AUTHORS) return false;   // 也不准「一次列舉一萬個人」
  }
  return true;
}
```

**「具名」的意思是：你得先知道要問誰。** 這不是完美的隱私（你仍可訂閱任何**已知** pubkey 的
心跳——見「已知限制」），但它把攻擊從「一鍵拿到整個名冊」降級為「一次問一個你已經知道的人」。

`MAX_AUTHORS` 上限擋掉「用 `authors: [十萬把金鑰]` 繞過」——那等價於枚舉全站。
取 **1024**（遠大於任何真實聯絡人清單／組織名冊）。

#### ⚠️ 邊界：`authors: []` **必須放行**

第一版我寫的是 `if (!authors || authors.length === 0) return false`。一個既有的引擎測試立刻爆了。

原因：**還沒有任何聯絡人的新使用者**，他的心跳訂閱就是 `{ kinds: [20000], authors: [] }`
（authors 就是聯絡人清單）。而 `matchFilter` 的 `!filter.authors.includes(pk)` 對空陣列**恆為真**
→ 它匹配不到任何事件，**不是消防水管**。

把它擋掉的後果是：**新使用者的整個 REQ 被拒 → 什麼都收不到。** 該擋的是 `authors`
**不存在**（＝不過濾作者＝全站），不是「空的」。這兩者差一個字，差別是「擋住攻擊者」
與「擋住所有新使用者」。

### 2. 一致性探測要**先做 NIP-42 AUTH**，且 filter 要具名

探測沒有身分——但 NIP-42 **本來就不需要身分**：它只證明你掌握某把私鑰。所以探測當場
`generateSecretKey()`，用那把臨時金鑰回應挑戰即可（`buildAuthEvent` 已經寫好了）。

filter 隨之改為 `{ kinds: […], authors: [臨時 pubkey] }`——**這反而讓探測更精確**：
它查的是「我剛剛送出的那顆事件」，本來就該用作者過濾，之前的 `{kinds:[1], limit:0}`
只是在問「你有任何 kind 1 嗎」，語意鬆散。

### 3. 錯誤訊息要**說得出原因**

```
["CLOSED", subId, "restricted: 訂閱必須指定 #p（自己）或 authors"]
```

一個沉默的空回應會讓實作者以為「這個中繼沒有資料」，然後去別的地方找 bug。

## 理由

- 這個洞的形狀是**「檢查了有值的情況，忘了沒有值的情況」**——`if (pValues && …)` 這一行
  讀起來完全正常，而漏掉的分支不會產生任何錯誤，只會**放行**。
  這與 ADR-0119/0122 的失敗模式同源：**安靜地做錯的事**。
- 而修法的關鍵在於先確認「合法客戶端從不這樣用」。確認過了：引擎的 9 個 filter 全部具名。
  **一個不會影響任何合法用法的限制，就該加上去。**

## 後果

- 正面：
  - 無法再一次性收割全站的線上名冊、狀態訊息、正在聽什麼。
  - 無法再對全站 Gift Wrap 做流量分析（收件人 p-tag ＋ 時間分布）。
  - **一致性探測修好了**——它現在會 AUTH，也就真的量得到 uptime
    （在此之前，每次 cron 都把我們自己的中繼判定為「不存活」）。
  - 合法客戶端**零影響**（所有 filter 本來就具名）。
  - `bootstrap/` **終於會被型別檢查**（新增 `tsconfig.bootstrap.json`）——它過去不在任何
    tsconfig 的 include 裡，ADR-0119 因此漏掉 `health-check.ts` 的一個未定義變數。
  - 測試 994 → **1006**（relay +12：消防水管被擋、流量分析被擋、空 filter、混夾一個無 scope 的
    filter 也整組拒、`authors` 上限、**合法客戶端的 9 個 filter 全通過**、**`authors: []` 必須放行**；
    ＋4 個**真實 WebSocket** 的探測整合測試——用假物件測不到「探測不 AUTH」這件事）。

- 已知限制：
  - **仍可訂閱任何已知 pubkey 的心跳**（`{kinds:[20000], authors:[某人]}`）。這是 Nostr
    廣播式 presence 的固有性質——要修得把心跳也封裝成 NIP-59（每位聯絡人各一則），
    那會讓發佈數乘以聯絡人數，摧毀 ADR-0109 的配額節省。**ADR-0120 已把這件事留給專門的 ADR**，
    本 ADR 不處理。
  - **AUTH 不代表身分**：任何人都能產一把金鑰通過 AUTH。這道 ACL 防的是「大規模收割」，
    不是「認證使用者」——中繼本來就不該知道誰是誰。
  - 中繼仍從 REQ 的 `authors:` 看得到你的聯絡人清單（ADR-0120 已記錄）。
