# 0214. 統一聯絡人列規格 ＋ 狀態訊息上列（情境切換副線）

- 狀態：已接受
- 日期：2026-07-20
- 相關文件：ADR-0079（三欄佈局）、ADR-0142（自訂狀態文字/富狀態）、ADR-0148（本地暱稱）、ADR-0158（企業頭銜 chip）、`apps/desktop/src/ui/ContactRow.tsx`、`ContactListWindow.tsx`、`DeckSidebar.tsx`、`deck-sidebar.ts`

## 背景與問題

客戶端有兩套聯絡人列表：經典視窗（`ContactListWindow`，依上線狀態分區）與三欄側欄（`DeckSidebar`，最近互動排序＋搜尋）。兩者「一列（row）」的顯示規格分歧：

- 經典列＝單行，狀態訊息/正在聽**只在 tooltip**；操作鈕 🧠/🚫/🗑；無標籤 chip。
- 三欄列＝兩行（名＋末則預覽）；操作鈕只有 🏷；有頭銜/標籤 chip。
- 資料源不同：經典吃 `Contact`（有 statusMessage/nowPlaying）、三欄吃 `SidebarEntry`（**無** statusMessage/nowPlaying）。

使用者要求：(1) 統一兩邊的列顯示規格；(2) 把自訂狀態訊息**顯示在列上**（而非只在 tooltip）。

## 考量的選項

副線內容的關鍵取捨（使用者選定）：
- 選項 A：副線固定顯示狀態訊息（MSN 風），三欄移除末則預覽。
- **選項 B（採用）：情境切換**——有未讀顯示末則預覽、無未讀顯示狀態訊息/正在聽。活躍時看對話、閒置時看人設。
- 選項 C：兩條副線（狀態＋預覽）並存，列更高、密度下降。

範圍取捨：只統一「列的內容規格」，**不**合併兩種容器的排序/分區（經典依狀態、三欄最近排序＋搜尋是 ADR-0079 的雙模式身份）。

## 決策

採用選項 B，並抽出**單一共用 `ContactRow` 元件**作為聯絡人列的 SSOT，經典與三欄都用它（群組列各自保留 `GroupRow`／`DeckRow`）。

**情境切換副線**（純函式 `rowSecondary`，可測）：
1. 有未讀 → 末則預覽（`messagePreview`，檔案以 `📎 檔名`）
2. 否則 正在聽 → `♪ nowPlaying`
3. 否則 狀態訊息 → `renderStatus`（富狀態 `:emoji:`，ADR-0142）
4. 否則 有對話史 → 末則預覽（閒置仍保留脈絡）
5. 皆空 → 留白
單行 ellipsis，完整文字仍留 tooltip。

**統一列規格**：狀態點＋名字（暱稱）＋情境切換副線＋頭銜/標籤 chip＋操作鈕超集（🧠 有未讀才顯示 / 🚫 / 🗑 / 🏷）。

**資料層**：`SidebarEntry` 補 `statusMessage`/`nowPlaying`（`buildEntries` 帶入）；`messagePreview` 抽到 `deck-sidebar.ts` 供兩邊共用。**接線**：經典 `ContactListWindow` 新增 `convos`（算預覽）＋聯絡人標籤 plumbing；三欄 `DeckSidebar` 新增 `onRemoveContact`/`onBlockContact`/`onSummarize`。

## 理由

- **SSOT / Fix First**：一份 `ContactRow` 決定列長相，消除兩邊漂移；`rowSecondary`/`messagePreview` 為純函式、可測。
- **調和而非推翻既有**：狀態訊息上列滿足需求，同時以「情境切換」保留三欄末則預覽的實用性（活躍對話仍優先）。
- **零伺服器狀態/隱私不變**：純本機顯示，資料來自既有 `Contact`（廣播的狀態訊息）與本機對話，不新增外洩面。

## 後果

- 正面：兩種佈局的聯絡人列一致；狀態訊息、正在聽、末則預覽依情境自動選最有用者；經典聯絡人列同時獲得頭銜/標籤與統一操作鈕。
- 負面 / 已知殘餘風險：經典列從「刻意單行」變為兩行，列高增加、MSN 超緊湊感略減（這是「狀態上列」的直接代價，使用者已知悉並接受）。群組列尚未併入共用元件（另案）。
- 後續行動 / 待辦：可選把群組列也收斂進共用元件；末則預覽可選加 `你:`／傳訊者前綴（目前無前綴）。
