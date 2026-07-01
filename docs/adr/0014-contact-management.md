# 0014. 聯絡人管理：刪除與封鎖（Phase A3）

- 狀態：已接受
- 日期：2026-07-01
- 相關文件：docs/ROADMAP.md（Phase A3／A6）；ARCHITECTURE.md §5；docs/adr/0009（多設備）

## 背景與問題

Phase A3 要把桌面前端從「只能加好友」推進到可實際管理聯絡人：刪除、封鎖與解除封鎖。需在既有 `ChatBackend` 抽象與本機 `AppStorage` 下實作，且封鎖要能真正阻擋對方後續訊息。

## 決策

- **刪除（remove）**：自 `AppStorage` 移除聯絡人並**一併清除其對話訊息**（`nb.msgs.<pubkey>`）；後端重新訂閱並更新清單。已刪除者若日後再傳訊，會如常以陌生人身分重新出現（標準行為）。
- **封鎖（block）**：移出聯絡人 + 記入封鎖名單（`nb.blocked`）。後端在 `receiveDm` 以寄件人公鑰比對，**丟棄被封鎖者的 Gift Wrap 私訊**；`ensureContact` 亦拒絕自動加回被封鎖者。封鎖名單經 `onBlocked` 事件回傳 UI，於聯絡人視窗「已封鎖」區顯示。
- **解除封鎖（unblock）**：僅移出封鎖名單；不自動加回聯絡人（如需往來須重新以 `npub` 加好友），語意單純、避免意外恢復。
- **抽象一致**：`removeContact`/`blockContact`/`unblockContact` 為 `ChatBackend` 可選方法，真實 relay 與示範（瀏覽器）後端皆實作，UI 以能力偵測（capability detection）決定是否顯示按鈕；之後 Tauri 後端沿用同介面。

## 後果

- 正面：封鎖為**客戶端層**過濾，不需中繼支援即生效；刪除連帶清資料，符合本地優先與隱私預設。純資料層（`AppStorage`）與後端過濾皆可測，並經真實 relay E2E 驗證（加→封鎖→解除封鎖）。
- 負面 / 未來：客戶端封鎖無法阻止對方持續往中繼發送（僅本端忽略）；封鎖狀態目前不跨設備同步（多設備一致性待 ADR-0009 的對帳延伸）。QR 加好友與雙向同意（M9／Phase D）另行處理。
