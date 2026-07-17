# 0175. 行動端企業模式・階段 A——消費端補完（下班靜音＋組織資訊＋政策確認）

- 狀態：已接受（已實作）
- 日期：2026-07-17
- 相關文件：ADR-0157（公司設定/下班自動靜音）、0160（企業訊息保留天數）、0048（企業政策）、
  0173/0174（行動端企業身分後端接線/持久）、行動版完整企業模式路線圖（A~D）

## 背景與問題

「讓行動版可完整使用企業模式」路線圖的**階段 A**：把已能連公司座、採用名冊的行動端企業身分，
補上桌面早有的**消費端**企業行為，使其成為一等公民。盤點三項：

- **A1 政策套用**：查證發現**訊息保留天數**（ADR-0160）是**引擎內部**套用
  （`relay-backend.ts` 送出時讀 `lastRoster.policy` 蓋外層過期）——行動端傳 `orgAdminPubkey`
  （ADR-0173）後**已自動生效**，無需 UI 接線。其餘政策旗標多為桌面專屬功能的 UI 閘門，行動端
  暫無對應功能，故本階段不接 `onPolicy`。
- **A2 下班自動靜音**（ADR-0157）：行動端未實作。
- **A3 組織資訊**：行動端收 `onOrgInfo` 但只拿來設企業旗標，未用工時、未顯示歡迎詞。

## 決策

### 1. 下班靜音判定純函式**上移共用引擎**（消除重複）

`shouldMuteOrgNotification` 原本定義在桌面 `App.tsx`；本階段行動端也要用。依「不建立重複」原則，
把它移到 `@cinder/engine`（`backend/types.ts`，與 `OrgInfo`／`contactLabel` 同處），桌面改
**再匯出**（`export { shouldMuteOrgNotification }`）讓既有 import（含 `App.test.tsx`）不動；
行動端直接自 `@cinder/engine` 匯入。純函式行為由既有桌面測試把關。

### 2. 行動端接下班靜音

`onOrgInfo` 把 `{workHours, members}` 存進 `orgInfoRef`（切身分清空）；`onMessage` 的通知閘門
加 `shouldMuteOrgNotification(orgInfoRef, {senderContact 或 orgGroup}, 當地 minutesOfDay)`——
非工時且來源為組織（企業同事 1:1／組織群組）→ **不彈通知（未讀照常）**，與桌面同語意。

### 3. 歡迎詞顯示

`onOrgInfo` 於 `info.welcome` **變更時**顯示一次（`window.alert`，keyed by `nb.orgWelcome.<pubkey>`，
不重複打擾）——鏡像桌面。

## 後果

- 正面：行動端企業身分現在**完整消費**企業——保留天數（引擎免費）、下班自動靜音、歡迎詞。
  桌面/行動端共用同一份靜音判定（消除重複、單一真實來源）。
- 已知限制／取捨：
  - `onPolicy` UI 閘門未接（行動端暫無對應被閘功能）；保留天數這個**協定級**政策已由引擎內部
    套用，不受影響。
  - 歡迎詞用 `window.alert`（web 可用、原生建置時可換原生對話框）。
  - `shouldMuteOrgNotification` 的測試留在桌面 `App.test.tsx`（經再匯出仍驗同一函式）；未搬到
    engine 測試檔以免多餘 churn，覆蓋不減。
- 這是路線圖**階段 A**；接續 **B（邀請碼入職）→ C（儲存槽員工端）→ D（企業主管理）**。
- 測試：engine 259＋desktop 408（含 shouldMute 5 例，經再匯出）＋mobile 169 全綠；三端 typecheck 通過。
