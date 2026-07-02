# 0036. Hint 陳舊偵測與離線回退；群訊 rumor 帶 hint

- 狀態：已接受
- 日期：2026-07-02
- 相關文件：docs/adr/0034（多中繼路由）、0035（hint 自動學習）、
  apps/desktop/src/backend/relay-backend.ts、packages/core/src/group.ts

## 背景與問題

ADR-0035 的兩項後續：

1. **群訊 rumor 不帶 hint**：群組往往是雙方第一次接觸（group-create 送達
   時對方還不是聯絡人），1:1 訊息才學得到 hint，群組情境學習缺口最大。
2. **hint 會陳舊**：對方換 relay 或該座長期停機時，本地 hint 指向死路——
   送出的 addressed 事件在該座的重連佇列裡無限等待，且使用者毫無感知。

## 決策

- **群訊帶 hint（送端）**：`wrapGroupMessage` / `wrapGroupControl` 增加
  `relayHint?`，寫進每個扇出 rumor 的內層 `relay` tag（同 0035，加密、
  外層不可見）；後端群組送訊/建群/離開一律帶上自己的 home relay。
  **學端**：`receiveGroup` 入口即學習（沿用 `learnRelayHint`——僅更新
  「既有聯絡人」，陌生群組成員不會被 hint 塞進聯絡人清單，維持 0027 的
  「不自動灌聯絡人」原則）。
- **陳舊偵測（連線層訊號）**：後端記錄各 pool relay 連續離線的起點；
  連續離線超過 **5 分鐘**（`RELAY_STALE_MS`）即標記 `stale`，隨
  `onRelayPool` 送出，設定面板顯示 ⚠（該座 hint 可能過期）。以既有的
  1 秒 UI tick 重算，快照有變才通知（簽章比對防抖）。
  不做「per-contact 猜測」（presence 缺席可能只是對方離線，訊號不可靠；
  連線層的持續離線才是硬證據）。
- **離線回退（雙發）**：`publishAddressed` 發現目標座狀態為 `offline`
  時，除照常投入該座的重連佇列外，**同時發一份到 home**。收端本就以
  event id 全域去重（0034），目標座復活後重送的副本無害。對方訂閱不到
  我 home 的情境（他沒有我的 hint）仍收不到——此回退是盡力而為的
  補救，不是保證。

## 理由

- 群組是 hint 學習覆蓋率最高的缺口，補上後「入群即互相學會路由」。
- 陳舊偵測以連線狀態為準：客觀、免猜測、零新協定。
- 雙發成本只在目標座離線期間發生，且上限為每則一份額外副本；
  換得離線期間的送達機會與佇列積壓風險下降。

## 後果

- 正面：群組第一則訊息（含 group-create）即完成雙向 hint 學習；
  死 hint 有可視警示；離線期間訊息不再只困在佇列。
- 負面／限制：stale 只是警示，尚無自動清除（誤清可能斷路由，先觀察）；
  雙發在目標座短暫抖動時會產生少量重複流量（收端去重吸收）。
- 後續：stale 持續過久時提示使用者確認/清除 hint 的 UI 動作。
