# 0051. 對話串 Thread（NIP-10 reply e-tag + 右側面板）

- 狀態：已接受
- 日期：2026-07-06
- 相關文件：`docs/ROADMAP.md`（Phase E 對話串）、ADR-0011（reaction e-tag）、ADR-0027（群組成對扇出）、ADR-0050（@提及）

## 背景與問題

借鏡 Slack 的對話串：對某訊息「在討論串中回覆」，回覆不灌爆主頻道，改於**右側面板**單獨檢視。需求：

1. 回覆如何標記所屬串、且不新增事件類型/不破壞加密與扇出？
2. 主頻道與串面板的顯示切分（回覆不入主流、根訊息顯示「N 則回覆」）。
3. 版面：右側可獨立開啟 thread 面板（Slack 佈局）。

## 考量的選項

- **選項 A（採用）：NIP-10 reply-marked e-tag，攜於加密 rumor 內層。** 回覆＝kind 14 聊天 rumor 加 `["e", rootId, "", "reply"]`；隨 Gift Wrap 加密，中繼看不到串結構（比公開頻道更私密）。串一律**扁平**掛在根訊息下（回覆某回覆時，root 仍指原始根，比照 Slack 非巢狀）。
- 選項 B：另立「串」事件類型或群組。過度工程、破壞既有扇出/加密路徑，否決。
- 選項 C：純文字引用（`> 原文`）。無結構、無法聚合回覆數/面板，否決。

## 決策

1. **回覆 = kind 14 rumor + NIP-10 `["e", rootId, "", "reply"]`。** core `thread.ts`：`replyTag(rootId)`、`threadRoot(rumor)`（讀 reply-marked e-tag）。`wrapMessage`／`wrapGroupMessage` 新增 `replyTo?` 選項→附回覆 e-tag。與 reactions(kind 7)/deletions(kind 5) 的 e-tag 不同 kind，互不干擾。
2. **收端解析→`ChatMessage.replyTo = rootId`（持久化）。** 送出回覆時 root 取 `訊息.replyTo ?? 訊息.id`（扁平化）。
3. **顯示切分：** 主頻道**隱藏 replyTo 訊息**；根訊息渲染「💬 N 則回覆」入口，每則訊息另有「在討論串回覆」動作。
4. **右側 thread 面板（Slack 佈局）：** App 層維護單一 active thread `{convId, rootId}`；`ThreadPanel` 以 `.desktop` flex 列渲染於對話視窗之後（視覺上位於右側），內容＝根訊息＋所有 `replyTo===rootId` 回覆（依時間），附獨立 composer（送出即帶 `replyTo=rootId`）。1:1 與群組共用同一機制。

## 理由

- 複用 NIP-10 標準 e-tag 與既有 Gift Wrap 扇出/加密，零新事件類型、零中繼改動、隱私不退讓，與 reactions/mentions 同源。
- 扁平串（Slack 語意）避免巢狀複雜度；root 解析為純函式，易測、UI/後端解耦。
- 右側面板沿用既有浮動視窗 flex 版面，不重寫視窗系統。

## 後果

- 正面：討論不淹沒主頻道；串結構加密私密；回覆一樣可 @提及/回應/收回/限時。
- 負面 / 已知殘餘風險：扁平串無多層巢狀（刻意，比照 Slack）；根訊息若未同步（對方尚未收到根）仍可顯示回覆，面板以「回覆」清單呈現、root 缺席時顯示佔位。
- 後續行動：thread 面板 UI 與回覆數彙整；未來可加「同時發到頻道」與串內未讀。
