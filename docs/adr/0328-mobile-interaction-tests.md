# ADR-0328：行動端互動測試——先補安全網，再談 P4 治本重構

- 狀態：已採用
- 日期：2026-08-04
- 關聯：ADR-0294 §2／ROADMAP Phase P4（行動端 per-identity 範圍隔離）、ADR-0130（桌面的 jsdom 掛載工具）、ADR-0138（行動端多身分）、ADR-0117（Argon2id 記住我）

## 1. 為什麼是這個，而不是直接重構

ROADMAP 對 P4 治本重構的判斷是：

> **未做**：以身分為 `key` 的子元件⋯⋯那是 1588 行、51 個 `useState` 的重構，而**行動端測試只有靜態渲染、抓不到互動回歸**，風險過高。

盤點時發現這句話還有下半段沒被說出來：**同一個弱點兩頭都佔**。

- 沒有互動測試 ⇒ 重構不敢動。
- 沒有互動測試 ⇒ 這類 bug **平常也不會被發現**。

那是個循環，而**先做重構是錯的順序**：拿掉安全網去搬 1823 行等於盲改。先補測試則兩頭都受益——它既是重構的安全網，**不重構也立刻有價值**。

## 2. 現有守衛擋不住什麼

`MobileApp.perIdentityState.test.ts`（ADR-0294 §2）掃原始碼，強制「每個 `useState` 都要被分類、per-identity 的必須在 `signInWith` 內被指派」。它擋得住「忘了想」，擋不住這四類：

| # | 漏洞 | 為什麼守衛看不到 |
| --- | --- | --- |
| 1 | **分錯類** | 只驗「有沒有被分類」，不驗分得對不對 |
| 2 | **`useRef`** | regex 只掃 `useState`，ref 完全在射程外 |
| 3 | **非同步落地** | `.then(setState)` 在切身分之後才回來。全專案 `grep cancelled\|generation\|epoch\|abort` 是空的——桌面 `App.tsx` 有 `let cancelled = false`，行動端一個都沒有 |
| 4 | **重設了但值是錯的** | 只驗 setter 名字有沒有出現，不驗傳什麼（ADR-0327 的 `cloudSync` 就是這一類：光呼叫 setter 會過，正解是重讀該身分的持久化值） |

## 3. 做了什麼

- `apps/mobile/src/test/jsdom-mount.ts`——比照桌面 ADR-0130 的 `mount`／`act`，加上行動端需要的互動小工具（`click`／`typeInto`／`byTestId`／`settle`）。逐檔以 `// @vitest-environment jsdom` 切環境，**不動既有的 node-env SSR 測試**。
- `MobileApp.identitySwitch.test.tsx`——**走真正的 UI**，不繞過任何一步：填顯示名稱 → 貼 nsec → 設本地密碼 → 登入 → 加聯絡人 → 送訊息 → 設定頁新增身分 → 再登入 → 切回去解鎖。
- 沿路補了幾個 `testID`（`signin-name`／`signin-submit`／`tab-*`／`chat-*`／`convo-back`／`add-contact-*`／`locale-*`／`theme-*`）。純測試可及性，不改行為。

斷言涵蓋兩個方向——**分類要兩邊都對，不是一律清光**：

- per-identity **不得殘留**：上個身分的訊息、聯絡人。
- 裝置層**必須保留**：語言偏好切了身分仍是英文。

## 4. 兩個實作上的坑

**`typeInto` 不能直接改 `el.value`。** React 攔截了 `value` 的 setter 來追蹤變更，直接寫它看不到 ⇒ 必須用原型上的原生 setter，再送 `input` 事件。

**測試不該碰網路。** 多身分區塊在示範模式不顯示（`onAddIdentity` 只在真 relay 模式傳入），所以測試得給 `relayUrl`。但那會讓引擎真的去連 `wss://…`：退避重試的計時器在測試與 jsdom 環境拆掉之後才回來 ⇒ `localStorage` 已消失、`ws` 丟 `ERR_INVALID_ARG_TYPE`，變成**與測試內容無關的未處理例外，而且只在整包跑時才出現**。裝一個什麼都不做的 `WebSocket` 讓測試封閉。

逾時放寬到 30 秒：每個案例要跑 1～3 次 Argon2id（登入包裹 nsec、切回解鎖）。**那是刻意的成本（ADR-0117），所以放寬逾時，不是調低 KDF 參數。**

## 5. 買不到什麼

1. **這一批只覆蓋第 1 類的一部分**（分類經由可觀察的 UI 行為驗證了兩個方向），**沒有覆蓋第 2、3 類**。
2. **第 3 類在 jsdom 裡不好觸發**：`archived` 那條走 OPFS（jsdom 沒有）、`slotQueue` 那條走檔案挑選器。要覆蓋它們得先做**可注入的時鐘／可控 promise**，是下一步而不是這一步。
3. **不是端到端**：`WebSocket` 被打樁，所以驗的是**本機狀態隔離**，不是真的收發。那正好是 P4 的範圍。
4. ~~沿路發現但**未處理**：行動端的 `theme` 完全沒有持久化。~~ ✅ **已修（ADR-0333，2026-08-05）**——實際上 `theme`／`locale`／`accent` 三個都沒有。`main.tsx` 的註解卻寫著「使用者在設定改的偏好由 App 自行讀回」——**那句話當時對三個都不成立**（我原本以為只有 `theme` 有問題，`locale` 也一樣沒有讀回，只是切身分時看不出來）。

## 6. 後續

- 補第 3 類：可控 promise ＋ 世代守衛（`signInWith` 開一個 epoch，非同步落地前比對）。那個守衛本身就是治本重構的一部分。
- 有了這層之後，P4 的治本重構才具備「改壞看得見」的前提。**本 ADR 不主張現在就動它**。
