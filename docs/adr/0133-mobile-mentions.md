# 0133. 行動端補上 @提及——建議邏輯下沉 core、兩端共用一份

- 狀態：已接受（已實作）
- 日期：2026-07-15
- 相關文件：**ADR-0050（@提及：NIP-01 p-tag 攜於加密 rumor 內層）**、0037（尾端建議列）、
  0114（行動端建群/敲一下，行動端逐步補齊桌面功能的脈絡）

## 背景與問題

@提及（ADR-0050）在**桌面**能用：composer 打 `@` 跳建議、送出時解析成 `p` tag、收到被提及的
訊息會凸顯。但**行動端完全沒有**——

- 送出側：手機 composer 打 `@` 沒有任何建議，`onSend` 也只吃 `(text)`、把提及丟掉。
- 接收側：`ChatMessage.mentionsMe` 後端其實已經算好並帶上來（relay-backend 收訊時設），但
  行動端 UI **從不顯示**——被點名了也毫無跡象。

而且提及的建議純函式（`suggestMentions`／`applyMention`）當時**寫在 `apps/desktop/`**，行動端要用
就得複製一份——違反 Fix First／不重複。

## 決策

### 1. 建議純函式下沉 `@cinder/core`，兩端共用

`suggestMentions`／`applyMention`／`MENTION_SUGGEST_MAX`／`MentionSuggest` 從
`apps/desktop/src/ui/mention-suggest.ts` **移到** `packages/core/src/mention-suggest.ts`（它們本就純、
只依賴 core 的 `MentionCandidate`）。桌面改從 `@cinder/core` import、刪掉本地檔；測試一併移到 core。
名稱→公鑰解析 `parseMentions` 原本就在 core。→ **單一真實來源**，行動端直接取用。

### 2. 行動端送出側：建議列 ＋ 解析成 mentions

- `ConversationScreen` 新增 `mentionCandidates?: MentionCandidate[]`；`onSend` 改為
  `(text, mentions?)`。
- 草稿結尾有進行中的 `@token` → `suggestMentions` 過濾候選，在**輸入列上方橫向排一列可點的名字**
  （手機沒有下拉；體驗比照桌面尾端建議列）。點一下 → `applyMention` 補進草稿。
- 送出時 `parseMentions(text, candidates)` → `mentions` 交給 `onSend`。`MobileApp.send` 轉給後端
  `sendMessage(to, text, undefined, mentions)`／`sendGroupMessage(groupId, text, mentions)`
  （後端簽名本就支援，只是過去行動端沒傳）。
- 候選來源：**群組＝其他成員**（排除自己）、**1:1＝對方一人**（與桌面同一套）。

### 3. 行動端接收側：被提及就凸顯

`m.mentionsMe` 的訊息氣泡加**主色左邊條** ＋「@提及你」小徽章（比照桌面的 `mention` class ＋
`mention-badge`）。已收回（`gone`）的訊息不凸顯——收回後不得留殘影。

## 理由

- 提及結構隨 Gift Wrap 加密（`p` tag 在內層 rumor），**中繼看不到社交圖譜**——這條隱私性質由
  ADR-0050 保證，本 ADR 只是把「產生 `p` tag」的入口補到行動端，未動協定。
- 把建議純函式下沉 core 是 Fix First 的正解：與其在行動端複製一份會漂移的邏輯，不如兩端吃同一份、
  同一組測試守著。

## 後果

- 正面：
  - 行動端能**打 `@` 選人、送出帶提及、被點名會凸顯**——與桌面同體驗。
  - 建議邏輯單一真實來源（core），桌面與行動端共用、共測。
  - 測試小計不變但重新歸位：桌面 −5（`mention-suggest.test` 移出）、core +5（同一批測試落到
    `packages/core`）、行動 +4（提及徽章：被提及顯示/未提及不顯示/已收回不顯示/給候選不影響初始渲染）。

- 已知限制：
  - 行動端 composer 的**互動流程**（打字→建議→點選→送出）沒有 jsdom 級 UI 測試（行動端目前是
    純 SSR 測試環境，未引入 jsdom）；但每一步的純函式都在 core 有測，React 接線很薄。接收側的可視
    凸顯則有 SSR 測試守著。日後若要補互動測試，比照 ADR-0130 於行動端引入逐檔 jsdom。
  - 提及仍以**顯示名稱**比對（ADR-0050 既有性質）：同名者可能一起被點名——非本 ADR 引入。
