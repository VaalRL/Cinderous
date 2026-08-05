# ADR-0327：雲端備份開關是身分層，不是裝置層

- 狀態：已採用
- 日期：2026-08-04
- 關聯：ADR-0071（加密雲端備份）、ADR-0294 §2／Phase P4（行動端 per-identity 範圍隔離）、ADR-0138（行動端多身分）、ADR-0045（profiles 登錄）

## 1. 問題：同一個設定，兩端語意不同

| | 儲存位置 | 語意 |
| --- | --- | --- |
| 桌面 | `profiles.ts` 每個 profile 一份（`setProfileCloudSync`） | **身分層** |
| 行動端 | `nb.cloudSync` 全域 localStorage 鍵 | **裝置層** |

後果：**在手機上，工作身分開了雲端備份，個人身分也跟著開著。**

而 `cloudSync` 決定的是「**這個身分**的資料要不要離開裝置」——它跟「這台要不要送已讀回條」（`readReceipts`）或「這台留多少訊息」（`retentionCap`）不同類，後兩者的裝置層語意說得過去。

ROADMAP Phase P 的〈順帶發現（未處理）〉把這三個一起列為「設計題」。**這個判斷對其中兩個成立，對 `cloudSync` 不成立**：桌面早就是身分層，所以這不是待討論的設計題，是**兩端已經分歧**。

## 2. 決策

行動端改用**與桌面同一條路**：值存 profiles 登錄檔，經既有的 `setProfileCloudSync()`。行動端本來就在用 engine 的 `loadProfiles`／`saveProfiles`（ADR-0138），所以是接上既有管線，不是新開一條。

`MobileApp` 的 `cloudSync` state 因此從「裝置/外殼層」改列 **per-identity**，`signInWith` 內必須重讀——`MobileApp.perIdentityState.test.ts` 的守衛會強制這件事。

⚠ 讀的是**持久化的登錄檔**（`cloudSyncOf()`）而不是 React state：`signInWith` 那一輪 `profiles` 可能還是 stale（剛 remember/switch，`setProfiles` 未 commit）。該檔案內早有一段註解為同樣的理由要求「不依賴 `prof`」。

## 3. 遷移：不能讓任何人的備份靜默停掉

升級前的使用者，`nb.cloudSync` 有值而每個 profile 都是 `undefined`。直接切換 ⇒ 全部讀成 `off` ⇒ **他的備份停了，而他以為還開著**。

一次性遷移，掛在 `loadIdentities()`（那裡已經是舊 `nb.remembered` 的遷移點——**同一件事只有一個入口**）：

- 舊值是 `basic`／`full` ⇒ 寫進**每個尚未設定**的 profile。遷移前它們本來就共用這個值，所以行為完全不變。
- 舊值是 `off`（或不存在）⇒ **不寫入**，只清鍵。留著 `undefined` 讓 `adoptCloudSyncMode()` 的「還原時接續備份習慣」仍然有效——寫死 `off` 會把那條路堵掉。
- 清掉舊鍵，不留兩個真實來源。

**遷移後，新建立的身分預設 `off`**，不再繼承上一個身分的選擇。那正是這次要修的東西。

## 4. 順帶修掉一個因為分不出而存在的錯

行動端接收快照傳播的備份模式時原本寫：

```ts
onCloudSyncMode: (mode) => { if (readCloudSync() === "off") changeCloudSync(mode); }
```

裝置層那把鑰匙**分不出「從未設定」與「明確關閉」**——兩者都讀成 `off`。所以**明確把備份關掉的人，會被另一台的快照重新打開**。

engine 的 `adoptCloudSyncMode()` 註解本來就寫著「不覆蓋使用者較新的手動選擇（**含明確設 `off`**）」，只是行動端當時沒有辦法照做。改成身分層之後兩者可分，直接用它。

## 5. 買不到什麼

1. **遷移後才第一次登入的身分預設 `off`**。若使用者從未「記住」某個身分（每次輸入 nsec），遷移時它不在登錄檔裡，之後會拿到 `off` 而不是舊的全域值。方向是安全的（不上傳），但**是行為改變**。
2. `readReceipts`／`retentionCap` **維持裝置層**。它們的語意撐得住，且沒有兩端分歧。
3. 沒有做「桌面／行動端設定跨裝置同步」——`cloudSync` 仍是各裝置各自決定（ADR-0071 的原設計如此，快照只在「從未設定」時傳播）。
