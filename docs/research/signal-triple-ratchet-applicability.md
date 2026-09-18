# 研究稿：Signal 三重棘輪（Triple Ratchet／SPQR）對 Cinderous 是否有用

- 日期：2026-09-18
- 狀態：**研究稿，尚未成為決策**。採納才進 ADR（依 CLAUDE.md 慣例）。
- 起點：使用者問「Signal 基金會後續有發布三重棘輪的設計，這對我們來說是有用的嗎」
- 相關 ADR：0028／0091／0236／0238／0245／0300／0301／0302／0306／0313（FS 系列）、0107（多裝置自封同步）

## 結論（先講）

**三重棘輪本身我們用不上，但它解決的問題在我們身上更嚴重——而且我們反而比 Signal 好修。**

三個層次分開講：

1. **三重棘輪不能直接搬**：它是掛在雙棘輪上的第三條棘輪，而我們**沒有雙棘輪**，
   ADR-0236 還明確否決過。它又假設**裝置對裝置的長期 session**，而我們刻意一個 npub 跨裝置。
2. 🔴 **但它針對的「先側錄、日後用量子電腦解」在我們身上是全有全無的**：
   NIP-44 的對話金鑰直接由**雙方的 npub** 導出，而 npub 是公開的。攻擊者不需要偷任何東西。
3. 🟢 **SPQR 最難的那個工程問題，我們沒有。** Signal 花大力氣做抹除碼分塊，是因為要把 1KB 級的
   ML-KEM 塞進**逐則訊息**的棘輪。我們的 FS 是**每週一把**的粗粒度輪替——1184 bytes 放在一顆
   每週一次的公告事件裡，不構成任何問題。

⇒ 值得做的不是「引進三重棘輪」，是**把我們已經在輪替的那把金鑰換成後量子的**。
我們已經蓋好的三樣東西（獨立於 nsec 的加密子鑰、公開的金鑰公告通道、機制版本協商）
恰好就是 Nostr 社群在 issue #1971 裡卡住的那三件事。

---

## 1. 三重棘輪是什麼

Signal 2025 年發布，設計者 Graeme Connell 與 Rolfe Schmidt，建立在 Eurocrypt 2025／USENIX 2025 的學術成果上。

- **既有的雙棘輪**＝對稱棘輪（每則訊息）＋ DH 棘輪（每輪往返）。兩者都是橢圓曲線，
  **量子電腦可破**；只有雜湊的那部分是量子安全的。
- **PQXDH**（2023）已經把**初始握手**變成後量子，但**握手之後的持續 session 仍是古典 ECDH**。
  也就是說 harvest-now-decrypt-later 的攻擊者只要等過握手那一刻，後面整段對話都拿得到。
- **SPQR（Sparse Post-Quantum Ratchet）** 補的正是這一段：用 **ML-KEM-768**（FIPS 203）
  持續產生新的共享祕密，與雙棘輪的輸出一起餵進 KDF ⇒ **混合安全**，
  攻擊者要同時打破古典與後量子兩邊才有用。
- **三重棘輪 ＝ 雙棘輪 ＋ SPQR。**

**它為什麼難做**：ML-KEM 的封裝金鑰 1184 bytes、密文 1088 bytes，而 ECDH 只要 32 bytes。
逐則訊息帶不動。Signal 的解法是**抹除碼分塊**：切成約 100 bytes 的小塊分散在多則訊息裡，
任意 N 塊即可還原；攻擊者要阻止金鑰協商就得把門檻之後的訊息**全部**丟掉，而那會變成
明顯的通訊中斷（＝可觀測，不是靜默降級）。

Signal 從設計之初就上形式化驗證：ProVerif 模型、Rust 實作對應模型、CI 每次改動用 hax ＋ F\* 重跑證明。

## 2. 為什麼不能直接搬——三個結構性理由

### 2.1 我們沒有第一、二條棘輪，而那是刻意的

ADR-0236 評估過對話層棘輪並**撤回**，改走「輪替加密子鑰」，原話：

> 近期 FS 路徑改為「輪替加密子鑰」（粗粒度 FS，避開棘輪多設備地雷）

三重棘輪是**第三條**。沒有前兩條，第三條無處可掛。

### 2.2 SPQR 假設 pairwise device session，我們刻意不是

Signal 官方說明裡寫得很清楚：SPQR 運作在**裝置之間的 pairwise session** 上，
session 建立後「SPQR is locked in and used for the remainder of the session」，可能存續數年。

而 ADR-0236 已經點出這正是入場費：

> Signal 是共用身分金鑰＋各自預金鑰＋各自 session，棘輪的入場費是 per-device

Cinderous 是**一個 npub 跨所有裝置**（ADR-0107 多設備自封同步）。要引進棘輪，
得先引進 per-device 身分與 per-device session——那是整個身分模型的改寫，不是加一個模組。

### 2.3 我們的傳輸沒有 session 可言

我們是 store-and-forward 的 Gift Wrap：收件人可能離線數天、一次拉回大量訊息、順序不保證。
棘輪需要「跳過訊息金鑰」窗與有序的鏈狀態；而 SPQR 的狀態機還要協調「誰在什麼時候送哪一塊」。
把長期有狀態的 session 架在無 session 的中繼投遞上，是另一個量級的工程。

## 3. 🔴 但它針對的威脅，在我們身上更嚴重

這是本研究真正的發現。

### 3.1 npub 同時是身分**和**加密目標

`packages/core/src/nip44.ts` 第 16 行（本機查證）：

```ts
const key = nip44.getConversationKey(senderSk, recipientPk);
```

對話金鑰＝ECDH(寄件者私鑰, **收件者公鑰**)。而收件者公鑰**就是 npub**，公開在每一個
中繼站、每一張名片、每一則事件的 `pubkey` 欄位上。

⇒ 一個有量子電腦的攻擊者要解開側錄的密文，只需要兩樣東西：**密文**與**npub**。
**不需要偷任何私鑰、不需要入侵任何裝置、不需要任何一方犯錯。**

Signal 的對應情境要打破的是**臨時**的棘輪金鑰（同樣是 ECC、同樣可破，但至少不是公開發佈的、
而且 PQXDH 已經擋住握手那一段）。我們是身分金鑰直接當加密金鑰。

### 3.2 🔴 我們的 FS 層對量子攻擊者**完全不生效**

這一點必須講清楚，因為它推翻了一個很容易有的直覺。

ADR-0238 的 FS 機制是：另生一把加密子鑰 `EK_e`（**不由 nsec 導出**，每週一把），
收件人在 epoch＋grace（最長 14 天）後**在所有裝置與快照上刪除 `priv(EK_e)`**。
ADR-0238 自己的說法：

> 事後即使 nsec 失竊，也解不開被側錄的網路密文

**那個威脅模型是「金鑰失竊」，不是「密碼分析」。** 而這兩者對「刪除私鑰」這個動作的反應完全相反：

| 攻擊 | 刪掉 `priv(EK)` 有用嗎 |
| --- | --- |
| nsec 失竊（ADR-0238 的目標） | ✅ 有用——小偷拿到的東西裡沒有它 |
| 量子密碼分析 | ❌ **無用**——攻擊者不需要你那份，他從公鑰**算出來** |

而 `pub(EK_e)` 是**明文公告**的。`packages/core/src/subkey.ts` 第 213 行（本機查證）：

```ts
const content = JSON.stringify({ v: 1, ek: ekPk, ...(opts.next ? { next: opts.next } : {}) });
```

kind 10040 事件，內容未加密，簽章後發佈到中繼站，任何人讀得到、永久留存。

⇒ **對量子攻擊者而言，我們二十多份 ADR 堆出來的前向保密，價值是零。**
不是「比較弱」，是這個機制的作用原理（刪除自己手上的那一份）對這種攻擊不適用。

這句話要公平地說完：**那不代表 FS 白做了。** 它對它自己宣稱的威脅（nsec 失竊）確實有效，
而那是今天真實得多的威脅。只是它**與量子威脅正交**，不能被當成已經涵蓋了。

### 3.3 「量子電腦反正會打破 Nostr 的簽章」不是忽略的理由

Nostr 社群的 [issue #1971](https://github.com/nostr-protocol/nips/issues/1971)（2025-07-10 開啟，至今**未關閉**、無共識）
裡有這個論點：既然量子電腦會讓 secp256k1 整個垮掉、任何人都能偽造事件，
那單獨保護 NIP-44 的機密性有意義嗎？

**有，而且差別很關鍵：**

| | 偽造簽章 | 解開側錄的密文 |
| --- | --- | --- |
| 何時能做 | **量子電腦問世之後**才能做 | **現在就開始收集**，之後再解 |
| 可否事後補救 | 可以——換金鑰、換協定、重建信任 | ❌ **不可能**。訊息已經在對方硬碟裡 |

也就是說，簽章那一格是**未來式**的攻擊，我們日後有機會應對；機密性那一格是**過去式**的損害，
今天每多傳一則訊息，就多一則將來會被解開的訊息。兩者不能互相抵銷。

對一個把「隱私預設」寫進 PRD §7 的產品，這個區別是實質的。

## 4. 🟢 為什麼我們反而比 Signal 好做

SPQR 整份設計最貴的部分——抹除碼分塊、狀態機協調、DoS 分析——**全部是為了把 1KB 塞進
逐則訊息的棘輪**。

我們的 FS 是**每週一把**的粗粒度輪替。ML-KEM-768 的 1184 bytes 封裝金鑰，放在一顆
**每週發一次**的 kind 10040 公告事件裡，相對於中繼站的事件大小上限（256 KiB，實測於
`relay/src/relay-core.ts`）根本不構成問題。

**Signal 的難題是我們的非問題，正因為我們的 FS 粗。** 粗粒度在這裡第一次變成優勢。

更進一步：issue #1971 列出的兩個卡點，我們**已經各自解決了**：

| #1971 的卡點 | Cinderous 現況 |
| --- | --- |
| 「要用不從 npriv 導出的金鑰加密」 | ✅ `EK_e` 就是**隨機生成、不從 nsec 導出**（ADR-0238 §2） |
| 「PQ 公鑰需要新的發佈機制，npub 那套不適用」 | ✅ kind 10040 公告 ＋ 可取代事件 LWW（ADR-0238 §3） |
| （隱含）新舊機制如何並存 | ✅ ADR-0302 的版本協商，註解裡連 `ek-v2` 都已經寫進去了 |

也就是說：**我們為古典 FS 蓋的那三樣基礎建設，恰好就是後量子升級需要的那三樣。**

## 5. 可行路徑草案（未定案）

把 `EK_e` 從「一把 secp256k1 金鑰」升級為「**混合 KEM 金鑰對**」：

```
封裝金鑰公告（kind 10040, v2）：
  { v: 2, ek: <secp256k1 pubkey>, pq: <ML-KEM-768 encapsulation key, base64> }

寄件時：
  ss_classic = ECDH(ephemeral_sk, ek)
  (ct, ss_pq)  = ML-KEM.Encaps(pq)
  conversation_key = HKDF(ss_classic || ss_pq)      ← 混合：兩邊都要破才有用
  Gift Wrap 內帶 ct（1088 bytes）

收件時：
  ss_pq = ML-KEM.Decaps(priv_pq, ct)
  …同上
```

- **混合而非取代**：古典那半保留。ML-KEM 相對年輕，混合是 Signal、OpenSSH、iMessage 的共同做法。
- **每則訊息多 1088 bytes 的密文**——這是真實成本，見 §6。
- **版本協商**走 ADR-0302 既有路徑，宣告字串類似 `ek-pq-v1`。
- 相依：`@noble/post-quantum`（v0.7.1，2026-08-27 發布，FIPS 203/204/205＋Falcon，
  維護者與現有 `@noble/*` 同一家）。

## 6. 反對意見與未解問題（沒有一項已經回答）

1. 🔴 **我們的密碼學從來沒有經過外部審計**（ADR-0306，複查期限 2027-01-30）。
   現在加一套 ML-KEM，是在一個未經審計的基礎上疊第二層未經審計的東西。
   **這可能是最強的反對理由**：後量子做錯了比沒做更糟，因為它會讓人以為問題解決了。
2. **每則訊息 +1088 bytes**。目前文字訊息連 Gift Wrap 外層大約幾百 bytes；加上 KEM 密文
   等於**體積增加數倍**。對中繼站的免費層容量模型（PRD §8）與離線信箱配額（每收件人 500 則）
   的實際影響**未計算**。
   - 可能的緩解：KEM 密文只在 **epoch 首則**送一次、之後用導出的鏈金鑰——但那就開始長得像棘輪了，
     而棘輪的多裝置問題會跟著回來。**這一條需要真正的設計工作，不是註腳。**
3. **相依版本落差**：`@noble/post-quantum` 需要 `@noble/{curves,hashes,ciphers}` **2.4.0**，
   而我們目前分別是 `^1.6.0`／`^1.5.0`／`^2.2.0`。noble v2 是 major bump ⇒ 要一併升級並驗回歸。
4. **v0.7.1 是 pre-1.0**。API 可能變動。
5. **打包體積**：ML-KEM 的 JS 實作對瀏覽器版與行動端 WebView 的影響**未量測**。
6. **簽章仍是 secp256k1**。這個方案完全不碰它——身分偽造在量子時代仍然成立，
   而那是 Nostr 全協定的問題，不是我們單獨解得了的。文案上**絕對不能**因為做了這個就說「量子安全」。
7. **上游可能有自己的方向**。#1971 沒有共識，若 NIP-44 日後定出官方 PQ 版本而我們自己先走一套，
   就會有互通性代價。反過來說，等待也有代價（§3.3 的過去式損害）。

## 7. 建議

**不要引進三重棘輪。** 它的前提（雙棘輪、per-device session、長期有狀態 session）我們都不滿足，
而滿足它們等於重寫身分模型。

**但應該把「後量子機密性」從『完全沒有路線』（ADR-0300 §8 的自評）升為一個明確的待辦**，
理由是 §3.2 那個具體結論：**我們現有的 FS 對量子攻擊者不生效，而我們原本可能以為它有幫助。**
這件事本身值得寫進 ADR-0238 的殘餘風險欄，**無論後續做不做後量子**——因為那份 ADR 現在
讀起來會讓人高估自己的保護。

至於要不要真的做 §5 那條路，我認為**先卡在第 6.1 與 6.2 兩項**：
外部審計還沒有，而訊息體積的影響還沒算過。這兩項是決定性的，
在它們有答案之前開工，只是把一個未經驗證的密碼學決定換成兩個。

---

## 資料來源

- [Signal >> Blog >> Signal Protocol and Post-Quantum Ratchets](https://signal.org/blog/spqr/)（SPQR 與三重棘輪的官方設計說明）
- [Signal >> Specifications >> The Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
- [NIP-44: post-quantum security · Issue #1971 · nostr-protocol/nips](https://github.com/nostr-protocol/nips/issues/1971)（2025-07-10 開啟，未關閉，無共識）
- [Signal's Post-Quantum Cryptographic Implementation — Schneier on Security](https://www.schneier.com/blog/archives/2025/10/signals-post-quantum-cryptographic-implementation.html)
- [Signal's Post-Quantum Triple Ratchet: A Technical Deep Dive on SPQR — Red-Team News](https://redteamnews.com/news/signals-post-quantum-triple-ratchet-a-technical-deep-dive-on-spqr/)
- [Quantum resistance and the Signal Protocol: From PQXDH to Triple Ratchet — CSO Online](https://www.csoonline.com/article/4078062/quantum-resistance-and-the-signal-protocol-from-pqxdh-to-triple-ratchet.html)
- 本倉庫查證：`packages/core/src/nip44.ts:16`、`packages/core/src/subkey.ts:213`、
  `relay/src/relay-core.ts`（事件大小上限）、ADR-0236／0238／0300／0302／0306
- `npm view @noble/post-quantum`（v0.7.1，2026-08-27）
