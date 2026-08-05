# 0308. Composer 輸入層統一：草稿建議聚合、Enter 政策可設定、IME 守衛

- 狀態：已接受
- 日期：2026-08-03
- 相關文件：ADR-0037（貼圖文字觸發／建議列鍵盤契約）、ADR-0038（貼上清除網址追蹤參數）、
  ADR-0050／0133（@提及）、ADR-0220（自訂 emoji 短碼）、ADR-0264（日期建議列）、
  ADR-0309（斜線指令，接在本層之上）、`apps/desktop/src/ui/ConversationWindow.tsx`

## 背景與問題

草稿 composer 的「輸入即建議」已經長成三份能力不同的實作：

| | 建議狀態 | 鍵盤鏈 | Tab 縮排 | 貼上清理 |
| --- | --- | --- | --- | --- |
| 主 composer | 6 個 state | 5 段分支 | ✅ | ✅ |
| 串內回覆 composer | 2 個 state | 1 段分支 | ❌ | **❌** |
| 行動端 | 只有 `suggestMentions` | — | — | — |

後果不是「不夠整齊」，是使用者看得到的行為分裂：

1. 串內回覆**打不出 `:shortcode:` 自訂 emoji、貼圖觸發字無效、Tab 不能縮排**。
2. **串內 `<textarea>` 沒有 `onPaste`** ⇒ ADR-0038 的「貼上清除網址追蹤參數」只在主 composer 生效，
   貼進對話串的連結會帶著追蹤參數送出去。這是隱私相關的缺口，不只是缺功能。
3. Enter 硬編為送出，且**兩處各寫一份**（主 composer 與串內回覆）。

Enter 另有兩個獨立問題：

- **沒有反向鍵**。全檔 `grep ctrlKey|metaKey` 零命中——對話視窗至今沒有任何組合鍵。
  一旦允許把 Enter 設成換行，就必須同時定義送出鍵。
- **沒有 IME 守衛**。全庫 `grep isComposing|compositionstart` 零命中。繁中／日文輸入法選字時
  按 Enter，在部分瀏覽器與輸入法組合下會直接把半成品送出。這是「Enter 預設送出」能不能安全
  當預設值的前提，不是附帶優化。

## 考量的選項

- **選項 A：只加 Enter 設定，不動結構。** Enter 判斷仍是兩份、串內缺口不修，
  而斜線指令（ADR-0309）進來時會變成第三份要各接一次的路徑。否決。
- **選項 B：統一全專案的輸入監控。** 盤點為 25 個檔案、68 處 `onKeyDown`/`onChangeText`，
  但其中五十多處是「Enter＝提交這個小欄位／Esc＝取消」的**一行慣用法**（`ContactRow`、
  `ContactListWindow`、`DeckSidebar`、`SignIn`、`Dialog`、行動端各設定頁）。那裡重複的是
  慣用法不是邏輯，抽成共用管理器只是拿一層間接換整齊。否決。
- **選項 C（採用）：只統一「草稿建議 ＋ 鍵盤政策」這一族**，其餘一行式原地不動。

## 決策

1. **邊界**：本 ADR 只管**草稿 composer**（主對話、串內回覆）。訊息搜尋框、暱稱／標籤／
   狀態文字等單行欄位、`Dialog`、登入與解鎖畫面**明確不納入**。

2. **新增三個純模組**（皆為純函式＋薄包裝，可完整單元測試、零 React 依賴）：
   - `apps/desktop/src/ui/composer-suggest.ts`：把 @提及／`:短碼`／斜線／貼圖觸發字四種比對
     聚合成單一 `ActiveSuggest` 判別聯集，含固定優先序與環狀選取。
   - `apps/desktop/src/ui/composer-keys.ts`：`resolveComposerKey()` 把按鍵解析成動作聯集
     （`accept`／`move`／`dismiss`／`indent`／`send`／`newline`／`none`）。
     **IME 守衛集中在這裡**：`isComposing` 為真一律回 `none`，交還給輸入法。
   - `apps/desktop/src/ui/composer-prefs.ts`：`enterToSend` 偏好，localStorage
     `nb.composer.enterToSend`，**預設 `true`（送出）**。形狀比照 `url-hygiene.ts` 的
     `cleanOnPasteEnabled()`／`setCleanOnPasteEnabled()`。

3. **聚合器落在桌面而非 `packages/core`**：自訂 emoji 庫（`sticker-library`）與觸發字表
   （`sticker-triggers`）都是 localStorage-backed 的桌面模組，把它們搬進 core 是另一個決策、
   不在本次範圍。core 只收與平台無關的斜線命令比對（ADR-0309）。行動端維持只用 core 的
   `suggestMentions`，本次不動。

4. **優先序**（維持現況並明文化）：`@提及` → `:短碼` → 斜線 → 貼圖觸發字。
   同一時間只顯示一列建議。

5. **鍵盤契約**（維持 ADR-0037 立場）：
   - `Tab` 接受選中、`↑`/`↓` 移動、`Esc` 關閉至下次輸入變化。
   - **Enter 只接受「非破壞性」建議**（@提及、短碼、斜線——三者都只是填入草稿）。
     貼圖觸發字**接受即送出訊息**，維持 ADR-0037 的 **Tab-only**，不掛在最高頻按鍵上。
   - 無建議時：`enterToSend=true`（預設）→ `Enter` 送出、`Shift+Enter` 換行；
     `enterToSend=false` → `Enter` 換行、`Ctrl/Cmd+Enter` 送出。
     **`Ctrl/Cmd+Enter` 在兩種設定下都送出**（肌肉記憶不隨設定改變）。

6. **兩個 composer 走同一條路徑**：串內回覆一併補齊 `:短碼`／斜線指令／`Tab` 縮排／
   **`onPaste` 追蹤參數清除**（關閉上述缺口 2）。
   **唯一刻意的例外是貼圖觸發字——串內不給**：接受觸發字＝立刻送出一則貼圖訊息，而送貼圖的
   路徑沒有串內語意（會落到主對話而非該串）。在串內回覆給這個入口只會製造意外，
   要正確支援需先讓貼圖送出路徑帶 `replyTo`，那是另一個決策。串內只給「填入草稿」型建議。

7. **設定入口**：設定面板**外觀分頁**新增「輸入行為」區（`ComposerSettings`，
   自管 localStorage，與 `LayoutSettings`／`AccentSettings`／`AccessibilitySettings` 同一模式，
   不需經 `App.tsx` 傳 props）。放外觀而非隱私分頁，是因為 Enter 行為是互動偏好、不是隱私設定。
   i18n 新增 `settings_composer`／`settings_enterToSend`／`settings_enterToSendHint`
   與 `slash_hint`（zh-Hant／en 兩語系）。

## 理由

- **為何不全面統一**：那五十多處一行式沒有共用狀態、沒有優先序、沒有可測邏輯。
  把它們套進管理器，是為了「看起來統一」而增加閱讀成本，與 Fix First 的目的相反。
- **為何 IME 守衛必須跟這次一起做**：使用者指定預設值是「Enter 送出」。在沒有 `isComposing`
  判斷的前提下，這個預設對本專案的主要語言（繁體中文）使用者是最不安全的那一個。
  設定本身不能取代守衛——它只是把問題轉嫁給使用者自己繞過。
- **為何 Enter 不接受貼圖觸發字**：ADR-0037 已經為此立過理由（「送出貼圖是不可逆動作，
  不能掛在最高頻按鍵上」）。統一鍵盤鏈不是推翻既有決策的機會。
- **為何現在做而不是加完斜線再做**：斜線指令是第六條要在兩處各接一次的路徑。
  先統一，接一次；後統一，要先複製再拆。

## 後果

- 正面：串內回覆行為與主 composer 一致；ADR-0038 的串內缺口關閉；斜線指令（ADR-0309）
  只需接一次；IME 誤送風險降低；Enter 行為可依使用者習慣調整。
- 負面：`ConversationWindow.tsx`（2856 行）這次要動兩處鍵盤區塊與兩處 `onChange`。
  回歸風險以既有 `ConversationWindow.test.tsx`／`.emoji.test.tsx` 為安全網——
  **DOM 結構與所有 `data-testid` 不變**（`mention-bar`／`emoji-bar`／`trigger-bar` 沿用）。
- 殘餘風險：IME 守衛依賴瀏覽器的 `isComposing`，在少數輸入法／瀏覽器組合下仍可能不準；
  `enterToSend=false` 是確定性的退路。
- 待辦：
  - 行動端 composer 仍是單行 `TextInput`（連換行都打不出來），屬獨立缺口、本次不處理；
    聚合器若日後要給行動端共用，再議是否上移 `packages/core`。
  - **既有行為保留、未在本次更動**：貼圖觸發字**不受 `stickersDisabled` 企業政策約束**
    （短碼補全有受約束、觸發字沒有）。接受觸發字會送出一則貼圖訊息，因此這看起來是
    ADR-0048 政策的一個繞道。本次刻意維持原行為以免夾帶非本 ADR 範圍的行為變更，
    但應另開決策處理。
  - 串內回覆的貼圖觸發字（見 §6 例外），需先讓貼圖送出路徑支援 `replyTo`。
