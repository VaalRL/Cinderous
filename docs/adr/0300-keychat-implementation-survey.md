# 0300. Keychat 實作查證：最強的傳輸側 FS，換來最集中的備份風險

- 狀態：**研究記錄（未決策，本文不改變任何產品行為）**
- 日期：2026-07-30
- 相關文件：**0292 §5**（明載「本文沒有讀 Keychat 的原始碼或規格…**不應據此下任何結論**」——
  **本文填上這個空白**）、**0289**（對手盤點——**§1 更正其兩個說法**）、**0295**（與 0xchat／Keychat
  的差異；其 §4 的 Keychat 段落同屬未查證）、0291（方便性重新審查）、0236／0245（我方 FS 形態、
  EK 與 at-rest 金鑰分離、備份碼**身分-only**）、0107（多設備共用 nsec）、0027（我方群組扇出）、
  0298（本機暴露面與分層）、0297 §6（保護等級分級）、0272（無內容推播喚醒）
- 資料來源（皆 2026-07-30 取得）：
  - `git clone keychat-io/docs`（App 文件，NIP-04 世代）
  - `git clone keychat-io/keychat-protocol`（**正式規格 v2**：`keychat-protocol-spec-v2.md`
    1639 行、`nips/nip-signal.md` 602 行、`nips/nip-mls.md` 464 行）
  - `gh api` 讀 `keychat-io/keychat-app` 的 `packages/app/lib/page/dbSetup/db_setting.dart`

> **結論：他們仍然沒有免費解掉 FS 與方便性的取捨**（ADR-0292 的總結論不變）。
> Keychat 的形狀是：**傳輸側 FS 三家最強**（double ratchet ＋ 每來回輪替位址 ＋ PQXDH），
> 代價集中在**一個「備份檔 ＋ 一個密碼」包住身分、全部歷史與會話狀態**——
> 而那個檔案完全不受它的 FS 保護。

## 1. ⚠ 先更正 ADR-0289 對 Keychat 的兩個說法

### 1.1 「近乎每則訊息輪替地址」——不準確

那句來自 App 文件的行銷語（「update sending and receiving addresses for nearly every message」）。
正式規格 `nip-signal.md` §Address Rotation 講得很清楚，而且相反：

> **Rotation is directional:** The DH ratchet only advances on direction change (receive then send,
> or vice versa). **Sending 5 messages in a row does NOT rotate the address.**

⇒ 是**每個來回（round-trip）輪替一次**，不是每則訊息。連發不換位址。
這對元資料分析的意義差很多：**單向連發的那一串在中繼看來是同一個收件位址**。

### 1.2 「Signal/MLS」——那是兩套並存，不是一套

- **1:1**：Signal double ratchet（`nips/nip-signal.md`）。
- **群組**：另一份 `nips/nip-mls.md`——RFC 9420 的 Nostr binding，**與 1:1 是不同機制**。

## 2. 位址輪替的機制與代價

**導出方式**（跨曲線單向映射，`nip-signal.md`）：

```
shared_secret = Curve25519_ECDH(私鑰, 對方公鑰)      # ratchet 狀態
seed          = [0xFF; 32] || shared_secret
hash          = SHA256(seed)
secret_key    = secp256k1_secret_key(hash)
位址          = x_only_public_key(secret_key)
```

**代價（規格自己寫明的）**：

| 項 | 內容 |
| --- | --- |
| **滑動窗 2–3** | 「Implementations SHOULD maintain a sliding window of 2–3 receiving addresses per peer」。舊位址從訂閱移除 ⇒ **落後超過窗就收不到**，只能退回 `firstInbox` 或身分金鑰 |
| **訂閱數線性成長** | 每個聯絡人 2–3 個位址 ⇒ 訂閱量隨聯絡人數成長。我們是**單一 `#p: 自己` 收件匣**，聯絡人再多都是一條 filter |
| **一次性 prekey 要補貨** | App 文件：預設 3 把，用掉即標記、一天後刪除，低於 3 自動補生成 |
| **`firstInbox` 過渡期** | ratchet 啟用前的臨時收件位址，收到第一個 ratchet 位址的訊息後才清掉 |

⇒ 位址輪替買到 message unlinkability，代價是**訂閱管理複雜度**與**落後窗**。
我們選的是相反的取捨：一個固定收件匣（元資料較差）換取零狀態、零窗、零補貨。

## 3. 群組：三種模式，只有一種有 FS

App 文件（NIP-04 世代）：

| 模式 | 上限 | 加密 | FS |
| --- | --- | --- | --- |
| **Pairwise Group** | < 10 | Signal，對每位成員各送一則 1:1 | 有（沿用 1:1 ratchet） |
| **Shared Key Group** | < 30 | `NIP4(NIP4(rawMessage))`，**所有成員持有同一把私鑰** | **無** |

Pairwise 的扇出模型與我們 ADR-0027 相同（每成員各包一份、無共用群鑰）。
**Shared Key Group 則是共用私鑰**——那不只沒有 FS，任何成員都能冒充其他成員。

規格 v2 **已不再提 Shared Key Group**（grep 無結果），改以 MLS 處理群組：

- `nip-mls.md` 是 RFC 9420 的 binding，提供群組 FS ＋ PCS，操作複雜度 O(log N)。
- **建議 admin-only Commit**：「significantly reduces the probability of concurrent Commit
  conflicts on a decentralized network」。
- 而該文件**自己承認前提不成立**：「MLS was designed with the assumption of a semi-trusted
  infrastructure — a Delivery Service (DS) that reliably orders and forwards messages…
  **Nostr provides neither guarantee**」，並要求客戶端自行處理亂序。

⇒ 與 ADR-0292 §1.2 對 Marmot 的發現一致：**在 Nostr 上跑 MLS，交付層的不確定性是所有人共同的難題**，
不是我們 ADR-0091 特有的顧慮。

## 4. ⚠ 最重要的發現：備份檔的爆炸半徑

`packages/app/lib/page/dbSetup/db_setting.dart`（實際原始碼，非文件）：

- 金鑰：**Argon2id**(password, 16-byte salt)，註解寫 OWASP 建議參數（47 MB／1 iteration／1 lane）→ AES-256
- 檔案格式：`KCBK` magic ＋ version ＋ salt ＋ metadata JSON ＋ 檔案項
- **備份內容**：
  - `getDatabaseFiles(sourcePath)` ＝ **該目錄下每一個非空檔案**
    ⇒ Isar 訊息庫、`signal-storage` 的 **ratchet 狀態**、MLS sqlite 全在內
  - `secure_storage.json` ＝ `SecureStorage.instance.readAll()`
    ⇒ 依規格 §2.1，**助記詞／nsec 就存在 secure storage**
  - `shared_prefs_export.json`
- 密碼強度檢查：≥8 字、需大寫等

⇒ **一個檔案 ＋ 一個密碼 ＝ 身分（助記詞）＋ 全部歷史 ＋ 全部會話狀態。**

這與我們的立場正好相反：ADR-0245 的備份碼是**身分-only、刻意不含 EK**，
而 ADR-0298 §5 的分層設計正是在減少「一個秘密解開一切」的面積。

三點後果：

1. **per-message FS 保護不到這裡。** FS 防的是「日後取得長期金鑰 ⇒ 解開被囤積的傳輸密文」；
   備份檔裡是**明文歷史**，不需要破 FS。
   ⇒ 這再次證實 ADR-0298 的前提：**本機／備份才是長期暴露面，而傳輸側 FS 管不到它。**
2. **備份是手動的。** 沒導出過 → 重灌／換機＝全失（**與 0xchat 的處境相同**，ADR-0295 §3.2）；
   導出過 → 多出一個高價值檔案要保管。
3. **爆炸半徑最大。** 我們的備份碼洩漏 ＝ 身分被奪（嚴重但可界定）；
   Keychat 的備份檔洩漏 ＝ 身分 ＋ 歷史 ＋ 可續用的會話。

## 5. ⚠ 多設備：他們也**沒有**解決——「多身分」不是「多設備」

這一格容易誤讀，必須分清楚：

- `docs/fetures/multi-identities.md` **內容是空的**（只有一行標題 `# Multi Identities`）。
- `keychat-protocol` 的 `docs/superpowers/plans/2026-06-17-multi-identity.md`（966 行）目標是
  「一個 runtime 註冊多個 Nostr 身分、可切換作用中身分、資料按身分隔離」
  ——**那是我們 ADR-0138 的「多身分」，不是多設備。**
- `deviceId` 欄位存在（friendRequest payload），註解寫 "for multi-device disambiguation"，
  但規格**沒有定義跨裝置的會話同步**。

⇒ **Keychat 沒有多設備方案。** 他們重用了 libsignal，但**沒有重用 Sesame**
（Signal 真正解決多設備的那一層，ADR-0291 §4）。

⇒ 對照 ADR-0292 §3.2：Marmot 用 per-device MLS leaf **在結構上**解掉了；Keychat 沒有等價機制。
⇒ 所以「共用單一身分金鑰讓 per-message FS 的多設備形態受限」這個問題，
**Keychat 是靠「不做多設備」規避的**，不是解掉。

## 6. 值得學的一項：金鑰儲存的分級寫成規範性要求

規格 §2.1 明確定義優先序，且用 MUST／RECOMMENDED 標示：

1. 硬體安全元件（Secure Enclave／TPM／Android Keystore）
2. OS keyring／Keychain（軟體模式）
3. 加密的 secrets 檔（passphrase，`0600`）
4. `0600` 明文檔（**last resort**，明確標為 NOT RECOMMENDED）

另要求 `zeroize` 記憶體、**建立時絕不顯示助記詞**（只在使用者明確要求備份且通過身分驗證後才顯示）。

⇒ 這與我們 **ADR-0297 §6 的 L2／L1／L0 分級同構**，而且他們把它寫成規範性要求。
**我們的分級可以引用它作為先例**——這不是我們獨創的形狀。

## 7. 推播：他們的設計**不要學**

`docs/fetures/notifications.md`：客戶端把 pubkey 清單（含**身分金鑰、SharedKeyGroup 群鑰、
私聊的 ratchet 位址**）POST 給 `notify.keychat.io`；中繼以 **gRPC 把每一顆事件推給 PushServer**；
PushServer 比對訂閱後呼叫 OneSignal → APNs／FCM。

⚠ 這使 PushServer 成為一個**知道「誰、在何時、收到了訊息」的中央點**——
而且它拿得到 ratchet 位址清單，等於拿到位址輪替想隱藏的那份關聯。
中繼還主動把全部事件推給它。

對照 ADR-0292 §4 查證的 Marmot 設計：**寄件者**觸發通知伺服器、token 加密給通知伺服器的
Nostr 公鑰、與中繼**解耦**、且推播 MUST NOT 夾帶內容。**那個設計乾淨得多。**

⇒ ADR-0272 的無內容喚醒方向不變；**推播的伺服器形狀應照 Marmot 那版，不是 Keychat 這版**。

## 8. 附帶發現：他們有 PQXDH（後量子）

規格 v2 §14.4 定義 PQXDH：X3DH 的四個 DH 之外，加上 Kyber 封裝
`(CT, SS) = PQKEM-ENC(PQPK_B)`，`SK = KDF(DH1 || DH2 || DH3 [|| DH4] || SS)`。

⇒ 這一格他們**領先我們一整代**（我們完全沒有後量子路線）。
但本文未查證它是否已在上線版本啟用（見〈已知限制〉的版本歧異）。

## 9. 對「FS vs 方便性」的答案

| 方便性代價 | 我們 | Keychat |
| --- | --- | --- |
| 離線太久 → 收不到 | grace 7 天，**且只在按下換鑰後** | **位址滑動窗 2–3**：落後超過窗需退回 fallback 位址 |
| 訂閱成本 | 單一 `#p` 收件匣，與聯絡人數無關 | 每聯絡人 2–3 個位址，**線性成長** |
| 新裝置／重灌的歷史 | **自動**（本機封存＋加密快照，at-rest 與傳輸金鑰分離） | **手動備份檔**；沒導出過＝全失 |
| 備份的爆炸半徑 | 備份碼**身分-only**（不含 EK） | **身分＋歷史＋會話狀態同一個檔** |
| 多設備 | 共用 nsec（限制 FS 形態） | **沒有方案**（多身分 ≠ 多設備） |
| 群組 FS | 無（粗粒度 FS 僅 1:1） | MLS 有 FS/PCS，但其 nip 自承 Nostr 無 DS 保證 |
| 後量子 | **無** | PQXDH（Kyber） |

⇒ **ADR-0292 的總結論不變：沒有人在未犧牲方便性的前提下拿到 FS。**
Keychat 的交換是：**更強的傳輸側 FS ＋ 更複雜的訂閱管理 ＋ 更集中的備份風險 ＋ 不做多設備。**

## 決策（研究記錄，未決策）

- 本文**不改變任何產品行為**。
- **填上 ADR-0292 §5 的空白**：該節的「不應據此下任何結論」現在可以解除，改引本文。
- **更正 ADR-0289**：§1.1（不是每則訊息，是每來回）與 §1.2（Signal 與 MLS 是兩套並存）。
- ADR-0297 §6 的分級可**引用 Keychat 規格 §2.1 作為先例**。
- ADR-0272 的推播**伺服器形狀照 Marmot（0292 §4）**，不採 Keychat 的中央 PushServer。
- 本文**支持 ADR-0298 的前提**：Keychat 有三家最強的傳輸 FS，其備份檔仍是明文歷史
  ⇒ 本機／備份是獨立於 FS 的一條軸。

## 後果

- 正面：這批研究裡最大的未查項補上了；且查出兩件對我們的設計有直接意義的事——
  **傳輸側 FS 再強也保護不到備份檔**（支持 0298），以及**推播有一個明確不該學的形狀**。
- 已知限制：
  - **版本歧異**：`keychat-io/docs`（App 文件）描述的是 **NIP-04 世代**（`NIP4(NIP4)` 雙層、
    Shared Key Group）；`keychat-protocol` 的 **spec v2** 用 NIP-17、且已不提 Shared Key Group。
    **無法確定上架版本目前跑哪一版**——本文的比較因此可能混用了兩代。
  - **未讀 Rust 實作**：`libkeychat`／`keychat_rust_ffi_plugin`／其 `libsignal` fork 都沒讀。
    位址導出、滑動窗、備份格式皆以規格與那一支 Dart 檔為據。
  - **未實機驗證**：沒有安裝 App、沒有觀察實際流量或訂閱行為。
  - PQXDH 是否已啟用於上線版本**未查證**。
  - `multi-identities.md` 為空，多設備的「沒有方案」是**由規格缺席推論**，不是他們明文宣告
    （對比 Marmot 是**明文寫** out of scope）。
- 後續行動（**皆待決策**）：
  1. 解除 ADR-0292 §5 的保留、更正 ADR-0289 的兩個說法。
  2. 若日後要評估後量子路線，Keychat 的 PQXDH 是現成的參考點。
  3. 若要做位址輪替（我們目前沒有），先算清楚「訂閱量隨聯絡人線性成長」對免費額度的影響
     ——那與 ADR-0165 的心跳降載是同一類預算問題。
