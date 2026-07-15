# 0139. 統一自訂對話框：取代瀏覽器內建 confirm / alert / prompt

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：ADR-0079（桌面佈局）、0080（設計 token）、0038（連結風險確認）、0037（觸發詞）、
  apps/desktop/src/ui/Dialog.tsx、apps/desktop/src/ui/msn.css

## 背景與問題

桌面前端有 ~20 處直接呼叫瀏覽器內建對話框（`window.confirm/alert/prompt`）：移除/封鎖聯絡人、
刪貼圖、換中繼站、關雲備、清 stale relay、觸發詞命名/衝突、外部連結確認、解鎖隱藏身分…

原生對話框的問題：
- **跳系統 chrome、不吃主題**（深色/主色全無）、位置與樣式不受控——與 app 的視窗美學脫節。
- **會凍結 JS 執行緒**（同步阻塞）。
- 部分 webview **停用 `prompt`**（回 null），功能靜默失效。

## 決策

### 1. 一套 Promise 介面的自訂對話框（`ui/Dialog.tsx`）

`DialogProvider`（掛在 app 根，`main.tsx`）＋ `useDialog()` hook，回傳三個**非同步**函式：

- `confirm(opts) → Promise<boolean>`
- `alert(opts) → Promise<void>`
- `prompt(opts) → Promise<string | null>`

`opts` 可為字串（只給訊息）或物件（`message/title?/confirmLabel?/cancelLabel?/danger?`；prompt 另有
`defaultValue?/placeholder?/password?`）。破壞性操作傳 `danger:true` → 確認鈕轉紅。

### 2. 重用既有視窗樣式，主題感知、可鍵盤操作

對話框用既有 `.modal / .modal__box.win / .win__title`（已主題感知、已做過封頂捲動修正，ADR 之前一次）
＋新的 `.dialog__*`。**Esc＝取消、Enter＝確認、點背景＝取消、× ＝取消**；prompt 聚焦輸入、其餘聚焦
主要按鈕。文案沿用既有已翻譯的 i18n 鍵，只新增泛用 `dialog_confirm/cancel/ok` 與三個標題。

### 3. 一次一個 ＋ 佇列

Provider 保存單一作用中對話框；開著時再進來的排入佇列（modal 擋住互動，實務罕見，但保險）。

### 4. 非元件情境的橋接 ＋ 無 provider 的回退

- **模組級 `dialog()`**：讓**非元件**的命令式程式（如後端回呼 `onHomeMigrate` 的自動搬家通知）也能
  用同一套對話框——`DialogProvider` 掛載時登記 api，未掛載回退 `window.*`。
- **`useDialog()` 無 provider 時回退 `window.*`、不丟例外**：隔離的 SSR 單元測試把元件裸渲染時不會
  炸——正式 app 一律有 provider。

## 理由

- 一致的視覺與行為（主題、鍵盤、位置）＋不凍結執行緒＋不受 webview 停用 prompt 影響——原生對話框
  三個痛點一次解決。
- Promise 介面比 callback 乾淨：`if (await confirm(...))` 讀起來就跟舊的 `if (window.confirm(...))`
  一樣，遷移機械化。
- 回退到 `window.*`（無 provider 時）讓既有一大批 `renderToStaticMarkup` 單元測試**零改動**通過。

## 後果

- 正面：
  - 全 app 的確認/提示/輸入都走**同一套主題化對話框**，不再跳系統原生視窗。
  - 破壞性操作統一紅色確認鈕；prompt 支援密碼遮罩（解鎖隱藏身分即用上）。
  - 測試 307 → **314**（Dialog jsdom：confirm 確定/取消/Esc＋danger、alert 單鈕、prompt 帶預設值/取消、
    無 provider 回退不炸）。順手把兩處硬編碼中文（解鎖隱藏身分的 prompt/alert）補了 i18n 鍵。

- 已知限制：
  - **`demo/main.ts`（獨立示範建置）仍用 `window.prompt`**：它不掛 `DialogProvider`、是命令式 demo，
    走 `dialog()` 也只會回退到原生——非產品 UI，維持現狀。
  - 自動搬家通知（後端回呼）走 `dialog()` 橋接，字串仍是既有硬編碼中文（buildBackend 無 i18n 情境）
    ——非本 ADR 引入的既有狀況。
