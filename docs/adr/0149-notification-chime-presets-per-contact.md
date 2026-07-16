# 0149. 通知音效自訂（合成預設集＋依聯絡人音效，桌面）

- 狀態：已接受（已實作）
- 日期：2026-07-16
- 相關文件：**ADR-0076（通知提示音與內文預覽）**、0116（桌面通知：Tauri 原生 toast＋web 後備）、
  0148（本地暱稱——依聯絡人本地欄位的同型模式）、0071（加密雲端快照）、0125（搬家捆包）

## 背景與問題

通知提示音（ADR-0076）只有**全域開/關**（`nb.notifySound`），聲音固定為 `playChime()` 以 Web Audio
即時合成的上行「叮咚」兩音——刻意不用音檔（零資產、離線/CSP 相容）。使用者要：**自訂通知音效**，
且**可依聯絡人指定不同音效**（一聽就知道是誰，MSN 時代的肌肉記憶）。

限制與現實：

- **OS 層不可自訂**：Windows 原生 toast 音效只能選系統內建清單。但 Cinder 的提示音本來就在 app 內
  以 Web Audio 播、與 toast 分離（`App.tsx` 收訊處），桌面（Tauri）與瀏覽器版行為一致——自訂音效走
  app 內播放即可，不碰 OS 限制。
- **音檔的代價**：使用者自訂音檔需要雙套儲存（Tauri fs／瀏覽器 OPFS）、大小上限、解碼錯誤處理，
  且體積不適合塞加密快照（跨裝置不同步）。

## 決策

使用者選定：**兩者都要、分兩階段**——本 ADR 先做「內建合成預設集」，自訂音檔留待後續 ADR；
範圍做**全域預設＋依聯絡人覆寫**。

### 1. 內建合成預設集（`CHIME_PRESETS`，零音檔）

`ringtone.ts` 定義 6 組**純資料配方**（`ChimePreset`＝音符列表：頻率/起點/音長/滑音）：
`classic`（叮咚，ADR-0076 原音色）、`descend`（咚叮）、`triple`（三連音）、`bell`（鐘聲）、
`drop`（水滴）、`knock`（叩叩）。`playChime(presetId?)` 依配方合成；**未給/未知 id 一律退回 classic**
（設定損壞也不失聲）。顯示名走 i18n（`nameKey` 型別鎖住 `Messages`，鍵漏加會編譯失敗）。
配方是純資料→可測（id 唯一、節拍合法、每音符一振盪器）。

### 2. 全域預設音效（`nb.notifyChime`）

設定面板通知區在「通知提示音」開啟時多一列**音效下拉＋試聽**；選定即試播一次（所聽即所得）並落地
localStorage。播放處：收訊且視窗未聚焦時 `playChime(依聯絡人 ?? 全域)`。

### 3. 依聯絡人覆寫：`StoredContact.notifySound`（完全比照 ADR-0148 alias 模式）

- 資料：`StoredContact.notifySound?: string`（預設集 id）＋ `AppStorage.setContactNotifySound(pubkey, id?)`
  （空/undefined＝清除）；memory/local/tauri 三實作。`Contact.notifySound` 隨 DTO 帶出；
  `ChatBackend.setContactNotifySound?` 於 `RelayChatBackend`（寫儲存→重載→重發清單，**不送任何事件**）
  與 `BrowserChatBackend`（記憶體 Map）實作。
- **純本地私有**：音效偏好**絕不廣播、絕不送對方或中繼站**；id 是小字串，隨你自己的加密快照
  （ADR-0071）/搬家捆包（ADR-0125）在你的裝置間流動。
- UI：`ConversationWindow` 標頭 ✎ 旁多一顆 🔔（提供 `onSetNotifySound` 才顯示，即 1:1），展開一列
  「跟隨全域預設＋六種預設＋試聽」；換對話即收合。群組訊息一律播全域預設。

## 後果

- 正面：
  - 通知音效可自訂（6 種合成音色）且可依聯絡人指定；不聚焦時「聽聲辨人」。
  - 零音檔——維持 ADR-0076 的離線/CSP/零資產路線；配方純資料，TDD 容易。
  - 資料層完全重用 ADR-0148 的本地欄位模式（不外送、隨加密快照流動），無新協定、無新依賴。
  - 測試 +13（ringtone 預設集 4／storage 1／relay-backend 不外送 1／SettingsPanel 2／
    ConversationWindow 2／既有 playChime 改簽名調整）。全綠 engine 245／desktop 341／mobile 145／i18n 8。

- 已知限制／取捨：
  - 本階段**不支援使用者自訂音檔**（範圍與儲存代價大）；若要做，另立 ADR（檔案選取、OPFS/Tauri fs、
    大小上限、不隨快照同步等取捨屆時決）。
  - 桌面（含瀏覽器版）先行；行動端資料層已通（欄位/後端方法共用），UI 待後續需求。
  - 群組不套用依聯絡人音效（群訊播全域預設）；per-group 音效留待需求出現。
  - OS toast 本身的系統音不受控（我們播自己的聲、通知本體交給 OS）；使用者若嫌雙聲可關 OS 通知音。
