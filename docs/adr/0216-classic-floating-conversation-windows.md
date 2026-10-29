# 0216. 經典佈局：左固定經典即時通主視窗 ＋ 右浮動對話視窗區

- 狀態：已接受
- 日期：2026-07-20
- 相關文件：ADR-0079（三欄佈局）、ADR-0104（原生拖放送檔）、ADR-0205（autoHide 標題列）、ADR-0206（三欄控制項上移標題列）、ADR-0214/0215（聯絡人列）、`apps/desktop/src/ui/ConversationWindow.tsx`、`ContactListWindow.tsx`、`App.tsx`、`msn.css`

## 背景與問題

經典佈局目前是 `.desktop` 的 **flex 流**（`msn.css:74`）：聯絡人視窗與對話視窗以 flex 排排站、可換行。對話視窗**已可縮放**（右下 `convo__resize`／`startResize`，`ConversationWindow.tsx:466`），但：

- 尺寸是**全域單一偏好**（`getConvoSize`，所有對話共用一個尺寸），非每窗獨立。
- **不能自由拖曳移動**（位置由 flex 流決定，不能重疊）。
- 聯絡人視窗**不可縮放**；設定 ⚙️ 埋在聯絡人視窗的標題列。

目標（經典即時通擬真，使用者定案）：**左側＝完整的原本主視窗**（列聯絡人、通用控制鈕收斂於此、固定不浮動）；**右側＝多個可拖曳/縮放/置頂的浮動對話視窗**，各自記位置＋尺寸。

## 考量的選項

視窗模型（使用者選定）：
- **左固定主視窗 ＋ 右浮動對話（採用）**：左錨點固定、右側自由浮動——最貼經典即時通「主視窗＋多聊天窗」。
- 右側單一對話面板／右側分頁（較單純，但失去經典即時通多窗浮動手感）。
- 全畫布自由浮動（含左側也浮動）：已被使用者否決（左側應為固定錨點）。

控制鈕去處（使用者選定）：**收斂在左側**（否決先前的「全域頂部工具列」）。

## 決策

把經典 `.desktop` 重構為 **左固定欄 ＋ 右浮動畫布** 兩區（三欄 modern 模式完全不受影響）：

**左固定欄**
- 保留 `ContactListWindow` 的**完整經典即時通主視窗外觀**（標題列、me 面板、名冊、ADR-0214/0215 的統一列/分組/收合），固定於左、不浮動。
- **通用控制鈕收斂於此**：把設定 ⚙️ 從聯絡人視窗標題列移入既有 `idbar`（身分切換/＋/🔒/🗂），並讓 idbar 位於左欄頂端 → 所有全域控制集中左側。
- 固定寬度（v1；寬度可調留待後續）。

**右浮動畫布**
- 新增 `.desktop__canvas`（`position: relative`）；每個開啟的對話 = **絕對定位**的 `ConversationWindow`。
- 抽共用 hook **`useFloatingWindow(id)`**：管理 `{x, y, w, h, z}`，回傳 `{ style, onTitleMouseDown（拖曳移位）, onResizeMouseDown（縮放）, bringToFront }`；以現有 `startResize` 為範本擴充拖曳，並把「全域單一尺寸」改為**每窗獨立**。
- **拖曳**：`.win__title` mousedown 移窗，**夾在畫布邊界內（clamp）**；排除點在標題列按鈕上。
- **縮放**：沿用 `convo__resize` 把手，尺寸每窗持久化。
- **z 序/聚焦**：點任何對話窗 → `bringToFront`（升到最上層）。
- **持久化**：每窗 position+size+z（localStorage，key＝對話 pubkey|groupId）；新窗以**層疊(cascade)**預設位。首次無記錄時，尺寸沿用舊 `getConvoSize` 全域值當預設（平滑遷移）。
- 無對話時畫布顯示佔位提示。

**autoHide 標題列（ADR-0205）範圍**
- autoHide **只套用最外層的視窗外框標題列**（app 自繪 window chrome）。
- 內部經典即時通視窗——左主視窗與右側每個浮動對話窗——的 `.win__title` **常駐、不 autoHide**（既供拖曳移位、也供辨識與置頂點擊）。

**響應式：小螢幕/行動改用單欄檢視切換**
- 低於斷點時**不套用左右分區與浮動**（避免視窗跑出畫面、且符合行動導覽習慣）。
- 預設顯示**主視窗**（經典即時通風：聯絡人列＋自身狀態/控制）；點聯絡人 → **直接切到該對話滿版**，並提供**返回主視窗**入口（如上一頁/返回）。
- 一次一個檢視（列表 ↔ 對話）；桌面寬螢幕才回到「左固定＋右浮動」。

**純邏輯抽出可測**：`floating-window.ts` 的 `clampRect(rect, bounds)`、`cascade(index, bounds)`、`nextZ(zmap)`。

## 理由

- **Fix First**：拖曳/縮放的 mousemove/mouseup 機制、convo 尺寸持久化都已存在（`startResize`），本 ADR 把它們一般化進 `useFloatingWindow`、加上位移與每窗持久化，不新造機制。
- **只動經典、隔離風險**：三欄 embedded 對話維持 grid/`display:contents`（ADR-0079）不變；改動封在 classic 分支。
- **控制收斂左側＝更經典即時通**：經典即時通主視窗自帶控制；集中左側比散在各窗或另拉頂欄更貼原味。

## 後果

- 正面：經典佈局成為「左主視窗＋右多浮動聊天窗」，可拖曳/縮放/重疊/置頂、每窗記憶——擬真度大幅提升；控制集中左側、對話窗更乾淨。
- 負面 / 已知殘餘風險：
  - 這是經典佈局**最大一次改動**（flex 流 → 左右分區＋絕對定位畫布）。
  - **事件消歧**：標題列拖＝移窗、內容區拖＝送檔（ADR-0104）、右下把手＝縮放、標題列按鈕＝點擊，須分清。
  - **autoHide（ADR-0205）**：只套用最外層外框、內部視窗標題列常駐（已於決策界定）；實作須確認 classic 內部 `.win__title` 不吃到 autoHide 的 `:has()` 規則。
  - **小螢幕/行動**：改單欄檢視切換（主視窗 ↔ 對話滿版，已於決策界定）——需新增「目前檢視」狀態與返回入口，且此路徑**不**啟用浮動/拖曳。
  - **持久化遷移**：全域尺寸 → 每窗；舊值作首次預設。
- 後續行動 / 待辦（實作步驟）：
  1. `floating-window.ts` 純邏輯（clamp/cascade/nextZ）＋測試。
  2. `useFloatingWindow(id)` hook（含每窗持久化；併吞 `startResize`）。
  3. `msn.css`：左欄＋右 `.desktop__canvas`（relative）＋浮動窗定位＋小螢幕 fallback。
  4. `App.tsx` classic 分支：**寬螢幕**＝左欄（idbar＋ContactListWindow）＋右畫布（open 對話 → 浮動 ConversationWindow）；**窄螢幕**＝單欄檢視切換（新增「目前檢視」狀態：主視窗 ↔ 對話滿版＋返回入口，不啟用浮動）。⚙️ 移入 idbar。斷點以 CSS media query＋一個 `isNarrow` 判斷驅動。
  5. `ConversationWindow.tsx`：接受浮動 props（絕對定位 style／標題列拖曳／縮放／聚焦置頂），一般化既有 `startResize`。
  6. `ContactListWindow.tsx`：標題列移除 ⚙️（改由 idbar 提供）。
  7. 測試（純邏輯＋元件把手/樣式）；本 ADR 由「提議中」改「已接受」＋更新 README。
