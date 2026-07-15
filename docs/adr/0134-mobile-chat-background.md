# 0134. 行動端補上對話背景——背景 token 下沉 @cinder/theme、兩端共用

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：**ADR-0077（本地個人化：頭像／每對話背景／對話框尺寸）**、0080（@cinder/theme 設計
  token SSOT）、0133（行動端補提及，同批「行動端功能對齊」）

## 背景與問題

每對話背景（ADR-0077 O3）在**桌面**能用：燈箱旁的 🖼 入口挑預設漸層或上傳圖片，純存 localStorage、
不廣播、不進雲端。但**行動端沒有**——聊天畫面只有預設面板色，換不了背景。

而背景的**純資料與純函式**（6 個預設漸層、`presetCss`、`chatBgCss`、儲存鍵 `nb.chatbg.`）當時
**寫在 `apps/desktop/src/ui/personalize.ts`**。行動端要用就得複製一份 → 違反 Fix First／不重複，
且兩份預設清單日後必然漂移。

## 決策

### 1. 背景 token 下沉 `@cinder/theme`，兩端共用

`ChatBg` 型別、`BG_PRESETS`、`presetCss`、`chatBgCss`、`CHATBG_PREFIX`、`CHATBG_MAX_EDGE` 移到
`packages/theme/src/chat-bg.ts`。theme 本就是「跨前端設計 token 的 SSOT」（ADR-0080），背景漸層正是
設計 token。桌面 `personalize.ts` 改成從 theme import 並 **re-export**——`ChatBgPicker`／
`ConversationWindow`／既有測試的 import 路徑（`./personalize.js`）完全不變。

新增 `chatBgStyle(bg)`：回**樣式物件** `{ backgroundImage, backgroundSize?, backgroundPosition? }`。
桌面沿用 `chatBgCss`（`background` 簡寫字串）；行動端用 `chatBgStyle`——因為 react-native-web 會把
`backgroundImage`（含漸層與 `url()`）**原樣送進 DOM inline style**（已實測）。同一份預設，兩種取用。

### 2. 行動端：本地儲存 ＋ 標題列入口 ＋ 挑選面板

- `apps/mobile/src/personalize.ts`：`getChatBg`／`setChatBg`／`removeChatBg`，localStorage、鍵用
  theme 的 `CHATBG_PREFIX`。與桌面同性質：**不廣播、不進 Nostr 事件、不進雲端快照或備份**。
- `ConversationScreen` 標題列加 🖼 入口（`onSetChatBg` 提供時才顯示）→ 展開挑選面板：預設漸層色塊
  一鍵套、已選的描主色框、可清除。背景以 `chatBgStyle(chatBg)` 套在訊息 `ScrollView` 上。
- `MobileApp` 持有 `chatBg` state：開對話時 `getChatBg(id)` 載入；套用/清除即時反映並寫 localStorage。
  背景是**本機偏好**，各裝置各存（不隨帳號同步）。

### 3. 圖片上傳留待原生建置

行動端這版只做**預設漸層 ＋ 清除**。自訂圖片上傳（桌面有）牽涉在 web 與原生各自的取圖/壓縮路徑
（行動端已有 `native/files.ts` 的 `pickFile`／`makeThumbnail` 可接），留作後續，不擋這次的核心體驗。
`chatBgStyle`／儲存已支援 `type:"image"`，接上取圖即可，無需再改 token 或協定。

## 理由

- 背景是 ADR-0077 定性的**本地個人化**：明文樣式只在本機，永不離開裝置——把它帶到行動端不改變這條
  隱私性質，只是補齊平台。
- 下沉 theme 是 Fix First 的正解：預設清單、CSS 產生、儲存鍵單一真實來源，桌面與行動端共用、共測，
  杜絕兩份漂移。desktop `personalize.ts` 以 re-export 當門面，既有程式零改動。

## 後果

- 正面：
  - 行動端能**挑對話背景**（預設漸層），重開仍在（localStorage）、各對話獨立、各裝置獨立。
  - 背景 token 單一真實來源（theme），桌面與行動端共用；桌面既有 import 不受影響。
  - 測試 +14（theme +7：`presetCss`／`chatBgCss`／`chatBgStyle` preset 與 image 分流；行動 +7：
    儲存 round-trip／壞值容錯／各對話獨立、UI 入口顯示分流、preset 漸層套進 inline style、未設不套）。

- 已知限制：
  - 行動端**尚無自訂圖片背景**（僅預設漸層）——見決策 3，token/儲存已預留，待原生取圖接上。
  - 背景**不跨裝置同步**（本地個人化的既有性質，ADR-0077）——換機需重設，符合「明文樣式不上雲」。
  - 行動端背景挑選是 SSR 測試（testID／inline style 斷言）；開合面板的互動未做 jsdom 級測試（行動端
    目前純 SSR 環境，同 ADR-0133 的取捨）。
