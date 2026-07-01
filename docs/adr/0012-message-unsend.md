# 0012. 收回訊息（Unsend，M6）

- 狀態：已接受
- 日期：2026-07-01
- 相關文件：docs/adr/0010（M6 路線圖）、docs/adr/0011（Reactions，同通道）；ARCHITECTURE.md §5

## 背景與問題

M6 第二項功能：讓寄件人收回（撤回）已送出的訊息。需在不破壞隱私（隱藏誰收回誰）與既有 1:1 加密通道下實作，並與 Reactions 保持機制對稱。

## 決策

- **協定**：NIP-09 刪除為 rumor kind 5（`e` tag 指向目標訊息 id、content 空字串），包進 **kind 1059 Gift Wrap**，與私訊、回應走同一條加密通道；收件端以 `rumor.kind` 分流（14=訊息、7=回應、5=收回）。
- **UI（v1）**：收回後不刪除該行，改以佔位字「訊息已收回」呈現（寄件端與收件端一致）；自己送出的訊息旁提供「收回」按鈕。
- **持久化**：以收回目標訊息 id 存於本機（`markDeleted`/`loadDeleted`，localStorage 鍵 `nb.deleted`）並於重載回放，避免 relay 重送或重整後又顯示原文。

## 後果

- 正面：沿用私訊通道與 NIP-17/59 隱私機制；核心 `wrapDeletion`/`deletionTarget` 純函式可測，端到端經真實 relay 驗證（Playwright 兩 context）。
- 負面 / 未來：v1 僅在本地與已上線的收件端「軟性」隱藏原文，無法保證對方客戶端未曾快取／截圖；relay 上的原 Gift Wrap 密文仍存在至過期。此為 E2E 加密訊息「收回」的固有限制，與商業 IM 同。可於後續以較短 NIP-40 過期（限時訊息）進一步縮短暴露窗口。
