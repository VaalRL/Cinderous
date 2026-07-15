# 0144. 更改顯示名稱（桌面＋行動端）

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：**ADR-0061（顯示名稱以加密 profile 廣播給聯絡人）**、0045/0138（多身分登錄）、
  0112（nsec 不明文落盤）、0142（設定分頁）

## 背景與問題

顯示名稱過去**只能在建立身分時設定一次**，之後唯讀：聯絡人清單/側欄只顯示 `self.name`，設定面板
沒有名稱欄，`ChatBackend` 也沒有改名方法。想改名唯一的路是登出重建身分——但那會**產生新金鑰＝變成
另一個人**，等於不能改名。

而傳播的管線其實**早就有**：`sendProfileTo`／`broadcastProfile`（ADR-0061）在加好友/接受請求時把
`wrapProfile(name)`（kind 0）加密送給聯絡人，對方以 `parseProfile` 收下更新顯示名。只差「改」的入口。

## 決策

### 1. 後端加 `setSelfName(name)`（ADR-0061 之上）

`ChatBackend` 新增可選 `setSelfName?(name)`。`RelayChatBackend` 實作：更新 `this.self.name` → 落地本機
`storage.saveIdentity({ nsec:"", name })`（**nsec 不明文**，只更名，ADR-0112）→ 清 `profileSentTo` 後
`broadcastProfile()`（讓**每個**聯絡人都重新收到新名字）。空白或未變動則忽略。`BrowserChatBackend`
（示範）僅更新本機顯示（無聯絡人可廣播）。

### 2. 前端：設定裡的「顯示名稱」欄，並同步本機登錄

- **桌面**：SettingsPanel「身分與安全」分頁加 `NameEditor`（輸入＋更新，預填目前名稱）。App 的
  `renameSelf`：`backend.setSelfName` → 更新 `self` state → 更新 profiles 登錄該身分的名稱（保留順序）
  ＋存檔（讓切換器/重載也顯示新名）。
- **行動端**：SettingsScreen「身分備份」區的名稱改為可編輯（輸入＋更新）。MobileApp 的 `renameSelf`：
  `backend.setSelfName` → 更新 selfName → `renameIdentity(profiles, pubkey, name)`（純函式：更新登錄＋
  同步該身分**記住的密碼包裹 blob** 的名稱，讓解鎖畫面也顯示新名）。

### 3. 為什麼要同步三處

名稱在三個地方各有一份：後端記憶體（`self.name`）、加密儲存（`saveIdentity`）、多身分登錄
（`nb.profiles`；行動端另有 `nb.remembered.<pubkey>`）。只改一處會不一致（例如切換器/解鎖畫面仍顯示
舊名）。改名一次同步全部，並廣播給聯絡人。

## 後果

- 正面：
  - 桌面與行動端都能**改顯示名稱**，即時反映在自己介面、切換器/解鎖畫面，並**加密廣播給聯絡人**
    （對方自動學到新名，ADR-0061）——**不換金鑰、不換身分、聯絡人/訊息全保留**。
  - 測試 +7（engine setSelfName 1：更新/落地/廣播/空白忽略；mobile renameIdentity 1：登錄＋blob 更名/
    保留順序/持久化；UI SSR 4：桌面/行動改名欄顯示分流）。全綠 engine 234／desktop 323／mobile 143。

- 已知限制：
  - 名稱走 ADR-0061 的**加密 profile**，只有**你的聯絡人**收得到更新（陌生人/請求區在被接受前不主動
    回送，防垃圾訊息確認，ADR-0121）——這是既有性質，非本 ADR 引入。
  - 示範模式（`BrowserChatBackend`／行動 demo）只更新本機顯示，不廣播（無聯絡人）。
  - 改名欄放在設定；「點自己名字就地編輯」的 inline 版留作後續 UX（非必要）。
