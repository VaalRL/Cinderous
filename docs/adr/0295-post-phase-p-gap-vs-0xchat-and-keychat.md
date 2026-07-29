# 0295. 修完 Phase P 之後，我們與 0xchat／Keychat 還差什麼（研究記錄）

- 狀態：**研究記錄（未決策，本文不改變任何產品行為）**
- 日期：2026-07-28
- 相關文件：**0273**（自我審查——Phase P 的來源）、ROADMAP **Phase P**（P1–P5 待辦）、
  **0268**（對手盤點——**§0 更正它的一個錯誤主張**）、0269（落差與追趕路徑）、
  0271／0272（Marmot 規格與 White Noise 實作）、0245（我方 opt-in FS）、0236（FS 方向）、
  0237（連線歸屬）、0044/0047（企業自架與名冊）、PRD §12（排除金流）
- 資料來源：**clone `keychat-io/keychat-app` 與 `0xchat-app/0xchat-core` 讀其 README 與設計文件**
  （2026-07-28）——ADR-0292 §5 曾明載「Keychat 完全未查證」，本文補上

> 一句話結論：**修完 Phase P 幾乎不會改變任何競爭差異。**
> P1–P4 修的是**只有我們有的 bug**（對手有沒有等價 bug 我沒查），P5 是唯一會動到競爭軸的一項，
> 而它也只補到一半。真正的差異在別處，且大多是**刻意選的**。

## 0. ⚠ 先更正 ADR-0289 的一個錯誤主張

ADR-0289 §2.5 寫：「本專案已有而 0xchat **尚未有**的：WebRTC 語音／視訊通話（0xchat 列為規劃中）」。

**這是錯的。** 0xchat 的 README「planned features」清單裡 `- [x] P2P audio/video calling`
是**打勾的**（＝已完成），`Nips Supported` 也列了 NIP-100 WebRTC，
`lib/src/chat/contacts/contacts+calling.dart` 有 offer/answer/candidate 的信令實作。

錯誤來源可還原：當初是靠網頁摘要取得該 README，摘要器把「planned features」這個**標題**
當成整段未完成，忽略了勾選狀態。**教訓：二手摘要不足以支撐競爭主張，要讀原文。**

**但同一份清單裡有一項真的沒勾**：`- [ ] Desktop&Tablets versions`
⇒ **0xchat 沒有桌面版**。這才是那一格真正的差異，而且比通話更站得住。

## 1. Phase P 修完會改變什麼？—— 幾乎沒有

| 項目 | 性質 | 對競爭差異的影響 |
|---|---|---|
| P1 檔案塊補水位 | 修我們自己的 bug | **零**——對手不會因此變差，我們只是不再重跳存檔框 |
| P2 重組失敗要報錯 | 修我們自己的 bug | **零** |
| P3 重取策略成為訂閱屬性 | 內部結構 | **零**（但降低未來再犯的機率） |
| P4 行動端範圍隔離 | 內部結構 | **零** |
| **P5 匿名發布 plane** | **動到元資料軸** | **有，但只有一半**——見 §2 |

⇒ **Phase P 是「把自己的地板補平」，不是「追上對手」。** 兩者都該做，但別混為一談。

## 2. P5 補的那一半，與補不到的那一半

ADR-0237 的洩漏有兩側：

- **發布側**：我發出的匿名 wrap，因為連線 AUTH 成我，中繼知道是我送的。
  ⇒ **P5 修掉這一側**（REQ 保留 AUTH、EVENT 不要求）。
- **接收側**：`#p` 是**穩定的身分 tag**，而收件匣必須 AUTH 才能讀（否則誰都能讀你的信）。
  ⇒ **P5 修不掉**——中繼仍能把「你的來信」分桶、看出收件時間樣態。

**Keychat 兩側都沒有這個問題**：他們的收件地址**就是 Double Ratchet 的新 DH 公鑰**，
「Alice updates the receiving address when sending a new message」——**近乎每則訊息換一次**，
中繼根本無從分桶。（他們的代價寫在同一段：「Alice should listen to the old addresses for
some time to avoid missing messages」——**這就是他們的 grace**。）

⇒ 修完 P5，我們在元資料軸上**從落後兩側變成落後一側**。
要補完另一側得讓 `#p` 也輪替，而 ADR-0290 §4 已判定不追（會改寫收件匣模型，
連帶衝擊離線投遞、多裝置、補送、NIP-62 清除）。**這個判斷本文不推翻。**

## 3. 修完 Phase P 之後，與 0xchat 的差異

### 3.1 他們有、我們刻意沒有

- **互通**：30 個標準 NIP，含 NIP-02 聯絡人清單、**NIP-05**、NIP-65 relay 清單、
  NIP-28 公開頻道、NIP-29 relay 群組 ⇒ 身分與聯絡人跨 App 帶著走。我們刻意不做（ADR-0061/0065）。
- **金流**：Cashu 錢包、Zap 紅包、NIP-47/57 ⇒ PRD §12 排除，無例外。
- **公開社群面**：公開頻道、長文、轉發、徽章 ⇒ PRD §12 明確排除。

### 3.2 ⚠ FS：形狀與我們**幾乎一樣**，但他們付了我們刻意避開的代價

0xchat 的 `doc/secretChat.md`（Secret Chat，**Beta**）：

> **Forward Secrecy**: … employ the NIP-101 protocol to exchange alias keys and locally compute
> the shared key … **Periodic key updates** are performed following a set of rules …
> **Irrecoverability on Other Devices**: The shared key for each secure chat session is stored locally.
> **If the app is uninstalled or the device is changed, the secure chat history becomes irretrievable.**

- **相同**：別名金鑰＋週期性更新＝**粗粒度輪替 FS**，與我們 ADR-0245 的 EK 輪替是同一個形狀。
- **⚠ 不同（我們較好）**：他們的 FS 模式**換裝置／重灌就失去該對話歷史**。
  我們刻意把 **at-rest 金鑰（nsec 導出）與傳輸金鑰（EK）分開**（ADR-0236/0245）
  ⇒ **刪 EK 得 FS 的同時，本機封存與加密快照仍還原得到完整歷史。**

⇒ 在 FS 這一格，**我們的設計比 0xchat 好，而且和 White Noise 的「新裝置拿不到加入前內容」也是同樣的對比**
（ADR-0292 §2）。**但我們沒上線**（Phase 3 審計未過），他們的至少是 Beta 可用。
**設計較好、交付較慢——這句話要一起講才誠實。**

### 3.3 我們有、他們沒有

- **桌面版**（他們的 `Desktop&Tablets versions` 未勾）。
- **自架＋企業身分**（管理者簽章名冊／邀請碼／離職接管）——他們的文件無此面向。
- 通話**兩邊都有**（更正見 §0）。

## 4. 修完 Phase P 之後，與 Keychat 的差異

### 4.1 他們明確較強的一項

**1:1 的密碼學與元資料**：Signal Double Ratchet ⇒ 每則訊息一把金鑰、**FS＋PCS 俱全**，
且收件地址＝ratchet 的新公鑰 ⇒ 元資料輪替是**加密機制的副產品**，不是額外機制。
這比我們的手動 opt-in 粗粒度輪替**嚴格更強**，即使我們把 ADR-0245 上線也是。

### 4.2 但有一格他們的文件**完全沒提**

**`Signal-Protocol-over-Nostr-NIP-DRAFT.md` 全文沒有出現 "device" 這個字。**
多裝置正是 ADR-0236 指出的棘輪殺手級問題（共用身分金鑰 ⇒ 並行送訊撞同一 counter＝金鑰重用），
Signal 本體靠 Sesame 的 per-device session 解決。

⚠ **我不能據此宣稱「Keychat 不支援多裝置」**——沒寫不等於沒做，可能在 app 層另有處理。
但**他們的協定草案確實沒有回答這題**，而這正是我們選輪替子鑰而非棘輪的理由。
**要當成競爭主張使用前必須實測。**

### 4.3 其餘差異

- **金流是他們的架構核心**（ecash 郵票付費投遞：「Senders send messages stamped with Bitcoin
  ecash to Nostr relays」）⇒ PRD §12 排除，這是產品定位的分岔，不是落後。
- **平台**：Android/iOS/macOS/Windows/Linux——**桌面兩邊都有**，這一格沒有差異。
- **自架＋企業身分**：他們的 README 無此面向（AGPL 開源但無商業部署說明）。

## 5. 綜合：修完 Phase P 之後仍然存在的差異

**仍然落後（且 Phase P 不解）**：

1. **群組 FS／PCS**——White Noise 有、我們沒有（ADR-0290 §3；本文兩個對手中 0xchat 的 FS 只在 1:1 的 Secret Chat）。
2. **1:1 的 FS 強度與元資料**——Keychat 的 per-message 棘輪＋地址輪替嚴格更強；
   P5 只補發布側，接收側的 `#p` 仍穩定。
3. **1:1 FS 尚未可產線啟用**——卡外部審計（ADR-0290 §2），對手至少 Beta 可用。
4. **行動端沒有推播**——ADR-0290 §1；Phase P 不含此項（它卡在真 RN 移植）。
5. **零生態網路效應**——刻意，但代價真實。

**仍然領先／不同（且是刻意的）**：

1. **E2E＋自架＋企業身分/離職流程的交集**——兩個對手都沒有。
2. **開了 FS 也不失去歷史**——0xchat 的 Secret Chat 換裝置就沒了、Marmot 新裝置拿不到加入前內容；
   我們把 at-rest 與傳輸金鑰分開，這一格設計上贏兩家。
3. **桌面版**——0xchat 沒有（Keychat 有）。
4. **無公開社交圖譜／無金流**——刻意，換來的是 Gift-Wrap-everything 與 PRD §12 的定位。

## 決策（研究記錄，未決策）

- 本文**不改變任何產品行為**。
- **Phase P 該做，但不要當成追趕**——它是把自己的地板補平（P1/P2 是已測證實的缺陷）。
  真正影響競爭的是 ADR-0290 的優先序（推播 → FS 審計 → 入站互通 → 群組粗粒度 FS）。
- **§3.2 值得單獨記住**：在「FS 是否犧牲歷史」這一格，我們的設計比兩個對手都好——
  這是可以講的差異，前提是**先把它上線**。

## 後果

- 正面：更正 ADR-0289 一個站不住的競爭主張；把 Keychat 從「完全未查證」變成有據；
  釐清 Phase P 與競爭力的關係（幾乎無關）；找到一格我們設計較優且可對外講的差異。
- 已知限制：
  - **全部為閱讀公開 repo 的 README 與設計文件，未實機使用、未讀完整原始碼。**
  - §4.2 的多裝置**是「文件未提」不是「不支援」**——不可當競爭主張使用。
  - 0xchat 的 Secret Chat 標示 **Beta**，實際穩定度未知。
  - 未查證兩個對手是否有與 P1–P4 等價的自身缺陷——**本文的「Phase P 不影響競爭」只成立於
    「對手沒有更嚴重的同類問題」這個未驗證前提**。
- 後續行動（**待決策**）：
  1. 若要對外使用 §3.2 的差異，先讓 ADR-0245 通過審計上線。
  2. 若要把 §4.2 寫進任何比較材料，先實測 Keychat 的多裝置行為。
