# 0251. 解鎖畫面逃生口降級為細字連結（否決 icon-only＋懸停文字）

- 狀態：已接受
- 日期：2026-07-27
- 相關文件：ADR-0067（本地密碼解鎖）、ADR-0073（救援）、ADR-0211（用其他身分登入）、ADR-0122（nsec 登入）、`msn.css` 393-404（登入頁次要動作語言）

## 背景與問題

解鎖畫面三顆按鈕——「解鎖」「忘記密碼？用私鑰或救援登入碼登入回來」「用其他身分登入」——視覺等重地疊在一起，使用者提議改為 icon 按鈕＋滑鼠懸停顯示文字。

研究發現真正病因：兩顆逃生口掛的 `settings__reveal` 是**幽靈 class**（全 codebase 10+ 處引用，`msn.css` 零規則），在 `.signin` 範疇內 fallback 到 `.signin button` 的主色實心樣式 → 三顆同重量實心鈕。而 `msn.css:393-404` 早已為登入頁建立「次要動作」語言（`signin__relaytoggle` 底線細字連結、`signin__secondary` 幽靈鈕），解鎖畫面沒跟上。SignIn 頁的「用私鑰登入」（`nsec-open`）同病。

## 考量的選項

- **A：細字連結降級（本案）**——逃生口改用既有 `signin__relaytoggle` 語言＋縮短文案；「解鎖」獨佔主色。
- **B：icon＋文字並排**——輔助辨識但增加視覺元素，對此頁無必要。
- **C：icon-only＋懸停文字（使用者原提案）**——技術可行，但逐顆評估不利：「解鎖」是表單主 CTA 不該 icon 化；「忘記密碼？」是**焦慮情境的逃生口**（密碼打不開的人沒有餘裕猜 🔑＋hover），且「用私鑰/救援碼救回」無無歧義 icon，業界慣例一律文字連結；「用其他身分登入」勉強可（👥）但屬低頻動作，icon-only 的學習成本只有高頻動作攤提得回來。硬傷：**觸控裝置無 hover**（webapp 於平板/觸控筆電上說明永不出現）；原生 `title` tooltip 有 ~1s 延遲且樣式不可控，自製 tooltip 又添元件。

## 決策

採 **A**：

1. 解鎖畫面 `unlock-forgot`／`unlock-switch` 與救援面板「返回」改掛 `signin__relaytoggle signin__escape`（新增 2 行 CSS：`signin__escape`＝各自成行置中、與主鈕留距）；「解鎖」獨佔主色實心。
2. `unlock_forgot` 文案縮短：「忘記密碼？」／“Forgot password?”——細節說明本就在救援面板 `rescue_hint`，按鈕不再 16 字。行動端同鍵（本就是連結樣式）一併受益。
3. SignIn 頁 `nsec-open` 改 `signin__secondary`，與兄弟「從其他裝置登入」（`pair-import`）同語言。
4. `settings__reveal` 於登入/解鎖範疇退場（測試鎖住不回歸）；SettingsPanel 等其餘引用處**不動**（另一脈絡、非本案範圍）。

## 理由

病因是視覺層級消失，不是文字太多——降級即治本，乾淨程度接近 icon 化但零猜謎、觸控友善、零新元件。重用既有次要動作語言（Fix-First），全部改動 2 行 CSS＋class 替換＋文案縮短。「忘記密碼」用文字連結是所有主流產品的慣例，逃生口不能藏。

## 後果

- **正面**：解鎖畫面主次分明；SignIn/Unlock 兩頁次要動作語言統一；文案精簡（zh 16 字→5 字）；行動端連帶受益。
- **負面 / 已知殘餘風險**：`settings__reveal` 幽靈 class 仍存在於 SettingsPanel／App（那些脈絡下的實際樣式為各自容器的 fallback，未經本案審視——留待日後盤點或正名）。
- **後續行動 / 待辦**：無（icon 化不再追）。
