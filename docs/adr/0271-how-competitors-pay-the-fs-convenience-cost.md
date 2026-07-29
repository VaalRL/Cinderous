# 0271. 對手怎麼處理「前向保密 vs 方便性」——他們沒有免費解掉，是把代價換了位置

- 狀態：**研究記錄（未決策，本文不改變任何產品行為）**
- 日期：2026-07-28
- 相關文件：**0270**（重新審查方便性考量——本文回答其未答的一半：「那對手怎麼做的」）、
  **0091**（MLS 暫緩：失效爆炸半徑——**本文發現該顧慮在對手規格裡是一個具名狀態**）、
  0236（選輪替子鑰而非棘輪；多設備共用 nsec 是根因）、0238／0245（我方 FS 設計與降階）、
  0107／0071／0072（多設備、快照、換機＝我方歷史還原路徑）、0268／0269（對手盤點與落差）
- 資料來源：**直接閱讀 Marmot 規格原文**（`github.com/marmot-protocol/marmot`，2026-07-28 clone）
  ——`protocol-core/{convergence,retained-history}.md`、`features/{multi-device,push-notifications}.md`

> 結論先講：**他們沒有在「未犧牲方便性」的前提下拿到 FS。**
> Marmot 把同樣的代價**明碼標價成可調參數**，並且在多設備與歷史這兩項上
> **直接宣告不解**。有兩處他們確實做得比我們好（機制上的），但不是免費的。

## 1. 他們付的代價，就是我們當初拒絕的那幾項

### 1.1 「離線太久就解不開」——他們也有，只是以 epoch 計

ADR-0238 被否掉的第一條是「離線超過 grace 的訊息會解不開」。Marmot 的
`protocol-core/retained-history.md`〈App-payload retention〉：

> An MLS application message outside the retained app-payload window **MUST expire** (a stale disposition).

窗寬是釘死的 convergence-policy 常數 **`app_payload_past_epoch_limit = 5`**
（`convergence.md` 的預設表）。即：**距離目前 tip 超過 5 個 epoch 的應用訊息，必須過期。**

⇒ **同一個代價，換了計量單位**：我方是「7 天 grace」（時間），他們是「5 個 epoch」（事件數）。
群組越活躍、epoch 推進越快，他們的窗在**時間上就越短**。

### 1.2 「掉一個 commit 會不會卡住」——ADR-0091 的顧慮是他們規格裡的具名狀態

ADR-0091 暫緩 MLS 的第一顆砝碼是：掉/亂序/過期一個 commit 可能讓**後續整段對話解不開**。
Marmot 規格對此有一個**正式的狀態名**：

> If the required retained state is missing … If the missing state is inside the rollback horizon,
> the client enters **`Unrecoverable`** until it has a verified repair path.（`convergence.md`）

且 commit 本身也會過期，規則是 epoch-based：

```text
canonical_tip_epoch - commit_source_epoch > max_rewind_commits   （預設 5）
```

⇒ **ADR-0091 當初的判斷沒有被推翻，反而被對手的規格證實**——他們沒有消除這個失效模式，
是為它建了一套狀態機（`deferred` → `stale` → `Unrecoverable`）與修復路徑。

### 1.3 他們**明說**保留量與 FS 是同一根拉桿

`retained-history.md` 開宗明義：

> Retention is a protocol tradeoff. Keeping more history improves recovery from delayed or withheld commits.
> Keeping less history limits how far a client can be forced to replay old state and **improves forward secrecy guarantees**.

⇒ 這正是我們在 ADR-0245 §2 記過的同一個張力（「凡進持久備份的 EK 就不具 FS」）。
**沒有人繞過它**；差別只在他們把它做成可調參數並寫進規格，我們把它做成 opt-in 開關。

## 2. ⚠ 兩項他們**直接宣告不解**

`features/multi-device.md`：

- **狀態是 draft**：「Status: branch draft.」「byte-level definitions … are placeholders and not yet finalized.
  They **MUST NOT be implemented for interop yet**.」
- **歷史直接放棄**：「**History synchronization is out of scope. A newly added device cannot decrypt epochs
  before it joined.**」

⇒ 對照我們的現況，**這一格我們是贏的，而且是結構性的贏**：
ADR-0236 已釐清**耐久歷史來自本機加密封存＋加密雲端快照，不是靠重新解密中繼密文**，
且 at-rest 金鑰由 nsec 導出、**與傳輸金鑰（EK）是兩回事**（ADR-0245 沿用）。
⇒ **我們刪 EK 得到 FS，同時新裝置仍還原得到完整歷史；Marmot 的新裝置拿不到加入前的任何內容。**

## 3. 但有兩項他們的機制確實比我們強——要誠實承認

### 3.1 亂序/遲到：`deferred input`（我們沒有等價物）

Marmot 對「parent 還沒到的 commit」不是丟棄，而是**延後保留**，等 parent 到了再接上
（`inbound-processing.md` 的 deferred input ＋ `convergence.md` 的 candidate branches）。
我們的模型不需要它（每則 Gift Wrap 自足），但**同一個工程能力我們在別處正缺**——
ADR-0267 查出的檔案塊靜默截斷/重收，正是「沒有保留與續取機制」的症狀。

### 3.2 多設備：per-device MLS leaf（結構上解掉我們的根因）

我們的痛點根因是**多設備共用同一把 nsec**（ADR-0107／0236）。Marmot 的作法是
**帳號身分仍是 Nostr 公鑰，但每個裝置是綁在該身分下的獨立 MLS client（各自一片 leaf、
各自的 MLS 金鑰材料與本機狀態）**。這在**結構上**解掉了「共用 nsec ⇒ 棘輪不可行」。

⚠ 但代價已在 §2 列出：**還是 draft、不可互通、且新裝置沒有歷史**。
⇒ 「per-device 身分」這個方向本身是對的（ADR-0269 §4 已指出我們要走棘輪就得先做這個），
**但它不是免費的，而且對手也還沒做完。**

## 4. 附帶發現：他們的推播設計比我在 ADR-0269 §1 建議的形狀更好

`features/push-notifications.md`：

- 裝置把**平台 token 加密給「通知伺服器的 Nostr 公鑰」**，密文以 token gossip
  （kind 447/448/449）**夾在一般的加密群組訊息裡**傳給其他成員；
- 推播提示**MUST NOT 夾帶訊息內容**；
- 通知伺服器**與中繼是不同角色**，以自己的 Nostr 公鑰為識別。

⇒ **中繼完全不必參與推播**——是**寄件者**（已從 gossip 拿到密文 token）去觸發通知伺服器，
而通知伺服器解得開 token、卻不必知道收件人的 Nostr 身分。

這比我在 ADR-0269 §1 建議的「中繼在 `#p` 命中時打 APNs」**乾淨**：
那個版本讓中繼多一個角色，這個版本讓推播與中繼解耦。
⇒ **ADR-0269 §1 的建議形狀應據此修訂**（結論「該做推播」不變，做法改）。

## 5. Keychat 未查證

ADR-0268 提到 Keychat「近乎每則訊息輪替地址」＋Signal/MLS。Signal 的棘輪靠
**skipped message keys 快取**吸收亂序、靠 **Sesame** 處理多設備——但**本文沒有讀 Keychat 的
原始碼或規格**，不確定它實際採用到哪個程度、多設備怎麼做。**不應據此下任何結論。**

## 結論

| 方便性代價 | 我們 | Marmot／White Noise |
|---|---|---|
| 離線太久 → 訊息解不開 | 有（grace 7 天）**但只在你按下換鑰後** | 有（`app_payload_past_epoch_limit = 5` epoch），**且是常態運作的一部分** |
| 掉 commit → 卡住 | **不存在**（每則 Gift Wrap 自足） | **存在且具名**（`Unrecoverable`），需修復路徑 |
| 新裝置的歷史 | **完整**（本機封存＋加密快照，與傳輸金鑰分離） | **拿不到**（明文寫在規格：out of scope） |
| 多設備 | 共用 nsec（限制了 FS 的形態） | per-device leaf（結構較優）**但仍是 draft** |
| 亂序/遲到的保留與續取 | **無等價機制** | 有（deferred input） |

**⇒ 對「他們怎麼在未犧牲方便性下處理 FS」這個問題，答案是：他們沒有。**
他們用更強的密碼學換走了「掉 commit 會卡住」與「新裝置沒有歷史」這兩項我們目前沒有的代價，
並把「離線過久解不開」從我們的 opt-in 一次性事件，變成常態運作的一部分。

## 決策（研究記錄，未決策）

- 本文**不改變任何產品行為**。
- 對 ADR-0270 的補充：方便性代價**不是我們獨有的怯懦**，是這條路上所有人都在付的。
  差別在**付在哪裡、以及誰能選擇不付**——我們的付法是 opt-in，他們的是常態。
- 若日後重啟 MLS 討論，ADR-0091 的第一顆砝碼**應保留**（對手規格已證實該失效模式存在），
  但可引用他們的 `deferred`／`rollback horizon` 作為緩解設計的參考。

## 後果

- 正面：把「對手是不是免費解掉了」這個問題查到規格原文，答案是否定的；
  順帶查出我們在「新裝置歷史」這一格是結構性領先，以及一個更好的推播形狀。
- 已知限制：
  - **只讀了 Marmot 規格，沒有讀 White Noise 的實作**——規格與實作可能不一致，
    且 White Noise 可能在規格之外自行補了歷史同步。
  - `features/multi-device.md` 與 `push-notifications.md` **都標示為 draft/branch draft**，
    未來會變；本文的引用有時效。
  - **Keychat 完全未查證**（§5）。
  - 未實測任何一款產品的實際使用感受——本文比較的是**規格承諾**，不是體感。
- 後續行動（**皆待決策**）：
  1. 修訂 ADR-0269 §1 的推播建議形狀（改為「通知伺服器與中繼解耦、寄件者觸發」）。
  2. 若要補「亂序/遲到的保留與續取」能力，先用在 ADR-0267 的檔案塊問題上——
     那裡今天就在痛，且不需要任何密碼學變更。
