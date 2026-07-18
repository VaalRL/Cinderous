# 0201. 軟登出（三端）：結束 session 回登入頁、保留身分與資料

- 狀態：已接受
- 日期：2026-07-18
- 相關文件：`packages/engine/src/storage/profiles.ts`、`apps/desktop/src/App.tsx`、`apps/desktop/src/ui/SettingsPanel.tsx`、`apps/mobile/src/MobileApp.tsx`、ADR-0045（多身分登錄）、ADR-0138（移除身分）、ADR-0202（清空裝置，破壞性）

## 背景與問題

桌面/瀏覽器**沒有登出**：一旦登入，只能切換身分或關 App。行動端把「登出」直接接到 `forgetActive`＝**移除身分並刪密文**（破壞性），語意過重、易誤刪。使用者要的是一個**非破壞性**的「結束目前登入、回到登入頁」動作，與「移除身分／清空裝置」清楚分開。

## 決策

新增**軟登出**：只結束作用中 session、清 `active`，**保留所有身分與本機資料**。

- **引擎**：純函式 `clearActive(state)` = `{ ...state, active: null }`（不刪任何 profile；與 `removeProfile` 破壞性移除刻意分開）。可單元測試。
- **桌面/瀏覽器（`App.tsx`）**：`logout()` = app 風格 `confirm` → `saveProfiles(clearActive(...))` → `location.reload()`。重載後無 active＝顯示登入頁；有本地密碼的身分下次需解鎖。經 `SettingsPanel` 新 `onLogout` prop 在「身分與安全」分頁呈現。
- **行動端（`MobileApp.tsx`）**：`logout()` 改為**不再** `forgetActive`，而是 `setScreen(activeProfile(profiles) ? "unlock" : "signin")`——記住的身分回解鎖畫面、暫時 session 回登入。破壞性的 `forgetActive`（ADR-0138）保留於解鎖畫面的「移除此身分」入口，語意與軟登出切開。

## 理由

- 登出是日常、可逆動作，不該牽動私鑰或資料；`clearActive` 讓「回登入頁」與「刪身分」在資料層就是兩件事。
- 三端一致：都是「結束 session、留資料」。有密碼者登出後仍需密碼才回得來（符合期待）。

## 後果

- 正面：三端都有真正的登出；不再有「登出＝誤刪身分」的風險。破壞性動作（移除此身分／清空裝置）獨立於 ADR-0202。
- 中性：桌面無密碼的身分登出後，因 nsec 仍在 OS 金鑰庫，再次以名稱登入即回得來——這是刻意（登出≠移除）。
- 負面 / 已知殘餘：行動端設定的登出鈕沿用紅色樣式（原為破壞性），現為非破壞性；樣式微調留待 ADR-0202 一併處理。需重建桌面方於安裝版生效。
