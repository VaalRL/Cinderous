# 0167. 外觀依身分覆寫、回退裝置層——主色/佈局/標題列＋標題列按鈕風格

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0064（自訂主色）、0078（副色）、0079（佈局）、0150/0151/0152/0153
  （自繪標題列）、0045（多身分命名空間）、0164（本機依身分持久化的先例）

## 背景與問題

盤點（前一輪）發現：主題、主色、佈局、語言、標題列配置全存**不分身分的全域鍵**
（`nb.theme`/`nb.accent`/`nb.layout`/`nb.locale`/`nb.titlebarControls`）——切身分不換外觀。
使用者要求：**主色/佈局/標題列**改為可依身分不同；並在設定標題列按鈕時多幾種風格可選。

## 決策

### 1. 身分層覆寫、回退裝置層（`identity-scoped.ts`）

新增純函式儲存層：
- 讀 `scopedGet(suffix)`：先讀 `nb.<pubkey>.<suffix>`（身分層覆寫），沒有才回退
  `nb.<suffix>`（裝置層預設），皆無回 null。
- 寫 `scopedSet`：作用中有身分 → 寫身分層；未登入（登入前畫面）→ 寫裝置層。
- 清 `scopedRemove`：有身分 → 只清身分層（回退裝置層）。
- `activeIdentity()`：無副作用地讀 `nb.profiles.active`（不呼叫會遷移的 `loadProfiles`）。

**套用於主色（accent/accent2）、佈局（layout）、標題列配置（titlebarControls）。**
Provider 於 App 掛載時讀取；切身分走 `location.reload()`，重掛時即讀當前身分的值。

### 2. 主題/語言**維持全域**（裝置偏好）

深/淺主題與語言比較像「整台機器一致」的裝置偏好，刻意**不**依身分——`nb.theme`/
`nb.locale` 照舊全域。分兩層：**裝置層**（主題/語言）＋**身分層可覆寫**（主色/佈局/標題列）。

### 3. 遷移零痛

既有全域值（`nb.accent` 等）自然成為**裝置層預設**：新身分未覆寫時讀到它，一旦在該
身分下調整即寫成身分層覆寫並分岔。無資料遷移、無損失。

### 4. 標題列按鈕風格（`TitlebarControls.style`）

`TitlebarControls` 加 `style: "flat" | "rounded" | "mac" | "compact"`（未知/缺＝flat）：
- `flat`：ADR-0150 原樣（方形、close 懸停轉紅）。
- `rounded`：圓角膠囊、按鈕間留白。
- `mac`：紅黃綠交通燈圓點（close 紅／min 黃／max 綠／⚙ 灰）。
- `compact`：較小、低調（窄視窗）。

`TitleBar` 掛 `titlebar--style-<x>` 類＋每顆按鈕 `titlebar__btn--<id>` 類（mac 著色靠它）；
CSS 於 msn.css 定義四種。設定頁標題列編輯器上方加風格 chip 選擇，切換即時反映（同一
Provider 狀態，編輯器本身也套該風格＝所見即所得）。風格隨 titlebarControls 一起走
身分層。

## 後果

- 正面：工作/個人身分可各有主色、佈局與標題列風格（避免視覺混淆、誤送）；主題/語言
  維持全機一致；標題列外框按鈕四種風格可選。
- 已知限制／取捨：
  - 切身分才換外觀（走 reload，非即時切換）——與既有多身分重載模型一致。
  - 身分層鍵 `nb.<pubkey>.*` 為裝置本地，不隨換機/搬家同步（同 chatbg/avatar/presence）。
  - 行動端未接（桌面先行）。
- 測試：identity-scoped 覆寫/回退/清除/未登入寫裝置層；titlebar-controls style 解析；
  SettingsPanel 風格 chip；既有標題列測試補 `style` 欄位。
