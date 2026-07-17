# 0168. 行動端功能對齊批次一——自訂狀態文字、正在聽、上線狀態本機還原、敲一下震動

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0142（自訂狀態文字／正在聽）、0114（上線狀態與敲一下）、0164（本機
  記住上線狀態，桌面先行）、0100（行動端後端接線補齊）、0086（行動端後端選擇）

## 背景與問題

盤點桌面／瀏覽器／行動三端功能差異後發現：**行動端與桌面共用同一套
`RelayChatBackend`**（`apps/mobile/src/backend.ts` → `createRelayChat`），因此多數缺口
不是「引擎沒有」，而是「行動端 UI 沒接」。使用者要求「依桌面實作把瀏覽器端與行動端
都加強」。瀏覽器端經查已近乎對等（`<input type=file>`／Web Notification／下載 等後備
皆在）；行動端則有一批**引擎已就緒、只差 UI** 的高價值項目。

本 ADR 為行動端對齊的**第一批**，挑選改動面小、彼此相關、可測的四項：

1. **自訂狀態文字**（ADR-0142）：`setStatus(status, message)` 引擎早支援，行動端
   `changeStatus` 卻丟掉 message 參數、設定頁也沒有輸入框。
2. **正在聽 nowPlaying**（ADR-0142）：`Contact.nowPlaying` 與 `setNowPlaying()` 都在，
   行動端不曾設定、對話副標題也不顯示。
3. **上線狀態本機還原**（ADR-0164 桌面先行）：桌面已把上次手動狀態存 `nb.presence.<pubkey>`
   並於上線還原；行動端每次上線都硬回 `online`、自訂文字全丟。
4. **敲一下收到即震動**（ADR-0114）：行動端 `onNudge` 是 no-op（收到敲一下毫無反應）。

## 決策

### 1. 移植 presence 儲存（`apps/mobile/src/presence.ts`）

與桌面 `apps/desktop/src/ui/presence-store.ts` **同一份契約**：`loadPresence/savePresence`
讀寫 `nb.presence.<pubkey>` 的 `{status, statusMessage}`。額外加 `typeof localStorage`
守衛（行動端 SSR 測試環境無 localStorage 時安全回 null／不丟例外）。

- **純本機、依身分、不進 Nostr／雲端**——與 ADR-0164 完全一致，中繼站仍不持久化狀態。
- 只記**手動**選擇；`nowPlaying` 維持 Ephemeral（換歌就換、不落地）。

### 2. 初始狀態塞進後端建構（首次心跳即正確）

`MobileBackendOptions` 加 `initialStatus?`／`initialStatusMessage?`，`createRelayChat`
轉進引擎既有的 `RelayPoolOptions.initialStatus/initialStatusMessage`。`signInWith` 於
建後端前 `loadPresence(pubkey)`，把上次狀態塞入——**讓 `start()` 的首次心跳就照這個
廣播**（與 ADR-0164 桌面同招：避免先廣播 online 再改，杜絕「離線狀態上線瞬間洩漏」）。
隱身另有攔截（ADR-0088），不經此路徑。

### 3. 設定頁三欄：狀態段＋自訂文字＋正在聽

`SettingsScreen` 狀態區在原 online/away/busy 段控下方新增兩個輸入框（沿用既有 i18n
`personalMessage_placeholder`／`nowPlaying_placeholder`，無新增鍵）：

- **自訂狀態文字**：受控輸入，即時 `onStatusMessage`（引擎自會節流心跳）＋本機記住。
- **正在聽**：草稿本地暫存，**離開輸入框（失焦）才廣播**——不把打到一半的歌名逐字送出；
  空＝不分享。為此 `react-native-web.d.ts` 的 `TextInputProps` 補上 `onBlur`。

`changeStatus/changeStatusMessage` 皆 `savePresence` 落地；`changeNowPlaying` 不落地。

### 4. 對話副標題顯示 nowPlaying、收到敲一下震動

- 1:1 副標題順序對齊桌面：**正在聽（♪）優先 → 自訂狀態文字 → 上線狀態**。
- `onNudge` → `navigator.vibrate([120,60,120])`；不支援 Vibration API（多數桌面瀏覽器、
  iOS Safari）時**靜默略過**（不是錯誤，只是沒有觸覺回饋）。

## 理由

- 四項共享同一批接線點（backend 建構／設定頁狀態區／對話副標題／nudge 回呼），一起做
  改動面最小、脈絡一致；且全部「引擎已就緒」＝零協定變更、零中繼變更。
- 依身分還原沿用 ADR-0164 桌面已驗證的模型（含「上線瞬間不洩漏舊狀態」的正確性），
  行動端只是把同一份契約接上——Fix First，不另發明。

## 後果

- 正面：行動端與桌面在「自訂狀態文字／正在聽／上線狀態記憶／敲一下觸覺」對等；狀態仍
  純本機、依身分，中繼鐵則不動。
- 已知限制／取捨：
  - `nb.presence.<pubkey>` 為裝置本地，不隨換機同步（同 chatbg／avatar，與桌面一致）。
  - Vibration API 在 iOS Safari 不支援——該平台敲一下無觸覺回饋（不影響訊息本身）。
  - 這是**批次一**；仍待對齊：輸入中提示（composer 節流送出）、限時訊息 TTL、移除聯絡人、
    新增群組成員、連線狀態指示、企業／組織套件等（後續批次另立 ADR）。
- 測試：`presence.test.ts`（round-trip／離線還原／防禦／無 localStorage 安全）；
  `backend.test.ts` 補 initialStatus 轉入 self；行動端全套 155 測試綠燈；typecheck 通過。
