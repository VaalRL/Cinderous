# 0085. 行動端 app 殼與導覽：聊天清單（最近互動排序）＋對話（LINE/Signal 風格）

- 狀態：已接受
- 日期：2026-07-12
- 相關文件：ADR-0063（行動端骨架）、ADR-0080（跨前端主題 token）、ADR-0081（行動端登入）、ADR-0079（桌面三欄左側欄的最近互動排序，概念平行）；`apps/mobile/src/*`

## 背景與問題

行動端此前只有零散畫面（登入、聯絡人清單），**沒有把它們串成一個 app 的殼與導覽**。需求：**登入後即進入「聯絡人＋群組」的聊天清單（預設依最近互動排序），點某列開啟該對話**，整體流程參考 LINE / Signal 的手機版佈局。

## 考量的選項

- **導覽方案**
  - A（採用）：**內建狀態機路由**（`useState<Screen>`，signin/pair/chats/conversation）。零額外依賴、此環境（react-native-web + vitest）即可開發驗證。
  - B：引入 `react-navigation`／Expo Router——功能完整但需原生工具鏈與大量依賴，與 ADR-0063「此環境只寫介面＋邏輯、跑 web 驗證」不合，暫不引入。
- **最近互動排序邏輯**
  - 重用桌面 `deck-sidebar.ts`：但它綁在 `apps/desktop`（含標籤/搜尋），且行動端需要的是「聊天列超集」（多帶最後訊息預覽與未讀）。
  - 採用：**行動端自帶純模組 `chat-list.ts`**（概念同桌面，最近互動 desc），不動桌面；trivial 的排序基元日後要單一化再抽共用套件。

## 決策

**新增行動端 app 殼 `MobileApp` 與兩個畫面，接 `@cinder/engine` 的 `ChatBackend`，以 LINE/Signal 佈局把登入→清單→對話串起來。**

1. **`MobileApp.tsx`（殼／路由）**：狀態機在 signin／pair／chats／conversation 間切換；登入成功後建立 `ChatBackend`（此環境用 `createDemoChat` 接記憶體 relay＋機器人；正式版注入 `RelayChatBackend`），訂閱 `onContacts/onMessage/onHistory/onGroups` → 狀態；未讀在「非正在看該對話」時累加。
2. **`ChatsListScreen.tsx`（主畫面，LINE/Signal 風格）**：聯絡人＋群組**合成單一清單**、預設**依最近互動排序**；每列＝彩色頭像（聯絡人帶狀態點／群組顯示 `#`）＋名稱＋最後訊息預覽（可帶「你：」）＋時間＋未讀徽章；點列 `onOpen(id)` 進對話。
3. **`ConversationScreen.tsx`（對話）**：頂部返回列（‹ ＋名稱＋副標）、訊息氣泡（自己靠右主色、對方靠左淺底；群組顯示發送者名）、底部輸入列（輸入框＋送出）。
4. **`chat-list.ts`（純邏輯）**：`chatList()`＝合成＋依最近互動排序；`lastMessageOf`／`previewText`／`chatTimeLabel`。全數單元測試。
5. **色彩**：三個畫面皆吃 `@cinder/theme`（ADR-0080），與桌面同主色/副色/深淺主題。

## 理由

- **重用引擎、只加 UI**：同一套 `ChatBackend` 契約，行動端換前端呈現層即可，登入後把 `createDemoChat` 換成 `RelayChatBackend` 就是正式版。
- **零依賴導覽**：狀態機路由在此環境可開發＋以 SSR 測試驗證（沿 ADR-0063）；不背上 native-only 的導覽庫。
- **符合大眾預期**：LINE/Signal 式「一條聊天清單＋點入對話」是手機通訊 app 的通用心智模型。

## 後果

- 正面：行動端首次成為**可用的 app 骨架**——登入即見聊天清單、點擊進對話、可送訊（示範後端與機器人對話）。
- 負面 / 已知殘餘：
  - 尚無**底部分頁**（聊天／聯絡人／設定 tab）、無設定畫面；目前是單堆疊流程。
  - 導覽狀態機夠用但非完整（無深連結／返回堆疊歷史）；上原生若需複雜導覽再評估 B。
  - 仍接**示範後端**；真實 relay 接線、RN 安全儲存（D2）、原生打包、以及可在瀏覽器實跑的 web preview entry 皆未做（沿 ADR-0063 以 vitest SSR 驗證）。
  - `chat-list.ts` 與桌面 `deck-sidebar.ts` 的最近互動排序概念重複（各自超集）；未單一化。
- 後續：底部分頁與設定畫面、接 `RelayChatBackend`、RN 安全儲存、原生/EAS 打包、web preview entry。
