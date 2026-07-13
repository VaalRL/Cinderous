# 0087. 行動端底部分頁：聊天／聯絡人／設定

- 狀態：已接受
- 日期：2026-07-13
- 相關文件：ADR-0085（行動端 app 殼）、ADR-0086（接真實 relay）、ADR-0080（主題 token）；`apps/mobile/src/MobileApp.tsx`、`apps/mobile/src/screens/BottomTabs.tsx`、`SettingsScreen.tsx`

## 背景與問題

行動端 app 殼（ADR-0085）此前是單堆疊流程（登入→聊天清單→對話）。要更像完整通訊 app，需要**底部分頁導覽**在主要區塊間切換。參考 LINE/Signal/WhatsApp 的手機慣例。

## 決策

**採 3 分頁：聊天／聯絡人／設定。對話為 push 全螢幕（非分頁）。**

1. **`BottomTabs`**：固定底部列，聊天(💬)／聯絡人(👤)／設定(⚙️)；作用中＝主色、其餘＝灰；聊天分頁帶**未讀總數**紅色徽章。
2. **導覽（MobileApp 狀態機）**：`signin`／`pair`（登入前）→ `main`（登入後，含 `tab` 狀態）→ `conversation`（push，蓋掉分頁列）。返回回到 main。
3. **分頁內容**：
   - 聊天＝現有 `ChatsListScreen`（最近互動排序＋「＋」加好友）。
   - 聯絡人＝演化 `ContactListScreen`（依上線狀態分區、**點某人開對話**、空狀態）。
   - 設定＝新 `SettingsScreen`：身分備份（npub／可顯示 nsec＋警語）、外觀（**主題 深/淺、主色、語言即時切換**）、中繼站（顯示目前 relay／示範）、**登出**。
4. **主題/主色/語言上移到 app 殼**：`MobileApp` 以 state 掌管 `theme`/`locale`/`accent`（初始值由 `initial*` props 帶入），設定分頁經 callback 即時切換——全 app 立即套用（吃 `@cinder/theme`）。
5. **web preview**：主題/主色/語言的控制移入 app 內「設定」；preview 只留頁面外框淺/深、示範↔真實 relay、relay URL、示範 nsec。

## 理由

- **通用心智模型**：底部分頁是手機通訊 app 的標準導覽，最少層級、最直覺。
- **重用**：聊天分頁現成、聯絡人分頁小幅演化既有畫面；只新增 `BottomTabs`＋`SettingsScreen`。
- **設定內建主題切換**：主題/語言本就屬 app 設定，移入殼讓使用者在 app 內即時調整（不再靠 preview 外部控制）。

## 後果

- 正面：行動端更接近完整 app——分頁切換、設定內調主題/身分備份/登出。
- 負面 / 已知殘餘：
  - **無「通話」分頁**（行動端通話未接線，放了會是空殼；之後接通話再加，ADR 另立）。
  - 尚無群組建立 UI、聯絡人管理（刪除/封鎖）行動端入口。
  - 導覽為自帶狀態機（無深連結/返回堆疊歷史）；複雜導覽待原生時評估 react-navigation。
  - 仍以 localStorage 持久化（原生安全儲存待 D2）。
- 後續：通話分頁、群組建立、聯絡人管理、relay hint/雲端備份行動端 UI、RN 安全儲存、原生打包。
