# 前向保密外部審計：申請材料（草稿，尚未送出）

> **性質**：這是 ADR-0306 D4 步驟 3「投 OTF／OpenSats」的申請材料草稿。
> **使用者 2026-11-11 決定要投**；本文件只是材料，**送出與否、何時送出由使用者決定**——
> 送出是對外動作，填表時需要的聯絡人姓名與信箱也請使用者自行填寫，本文件刻意不放。
>
> 背景：ADR-0245（opt-in FS）、0306（實驗性、不宣稱、審計期限 2027-01-30）、
> 0290 §2B（資助管道查證）、0302 §6（審計範圍量測）、0313（自動輪替）、0365（後量子混合）。

## 一、送出前檢查清單

- [ ] **OTF Security Lab**：到 <https://www.opentech.fund/labs/security-lab/> 確認線上申請表仍開放
      （2026-11-11 查：頁面仍寫「免費審計、填線上申請表」，沒有截止日；2026-03 的 RFP 是招審計廠商，
      不是招專案）。ADR-0290 記載的經費政治風險仍要留意。
- [ ] **OpenSats（The Nostr Fund）**：<https://opensats.org/apply>，滾動受理、分波發放
      （2026 年已有第 15～17 波）。官方建議申請書一頁為度。
- [ ] 兩邊可以同時投；若其中一邊先核准，通知另一邊撤回或改申請別的項目。
- [ ] 送出前把第二節的行數與版本號重新量一次（程式會變）。
- [ ] 送出後回填 ADR-0306 的 D4 狀態與本文件第五節。

## 二、審計範圍（2026-11-11 量測）

ADR-0302 §6.2 當時量到 420 行；之後協定程式搬進 SDK（ADR-0370），又加了自動輪替（0313）、
版本協商（0302）與後量子混合封裝（0365），範圍變大。現況（不含空行與純註解行）：

| 位置 | 非空非註解行數 | 內容 |
|---|---:|---|
| SDK `src/protocol/subkey.ts` | 515 | EK 輪替狀態機、10040 公告、hint、TOFU 釘選、強度比較、降級偵測 |
| SDK `src/protocol/nip59.ts` | 197 | rumor／seal／wrap 三層封裝 |
| SDK `src/protocol/hybrid-kem.ts` | 162 | ML-KEM 混合封裝、對話金鑰合成 |
| SDK `src/protocol/ek-envelope.ts` | 104 | EK 分發信封（多裝置） |
| SDK `src/protocol/nip44.ts` | 52 | NIP-44 薄包裝 |
| SDK `src/protocol/keys.ts`＋`key-ops.ts` | 59 | 金鑰型別與導出 |
| Cinderous `packages/core/src/giftwrap.ts` | 225 | App 端封裝入口（`encryptToFor`、多收件者） |
| Cinderous `packages/core/src/fs-enabled-merge.ts` | 23 | 多裝置 FS 開關合併 |
| **小計** | **約 1,340** | SDK v0.87.0（a9695ca）＋Cinderous main |

另需審計方看的接線（不算核心範圍，但決定金鑰何時刪、何時降級）：
`packages/engine/src/backend/relay-backend.ts` 中呼叫 `shouldRotateFs`、`pruneFsKeys`、`openFs`
的路徑，以及 `packages/engine/src/storage/cloud-snapshot.ts` 的 EK 快照合併。

**不在範圍**（可另案）：本機靜態加密 `at-rest.ts`、搬家配對 `pairing.ts`、WebRTC、中繼伺服器。

### 希望審計回答的問題（取自 ADR-0302 §6.3，依現況更新）

1. NIP-44 對話金鑰的導出與使用是否正確，有沒有誤用同一把金鑰。
2. Gift Wrap 三層的欄位與外層 tag 有沒有洩漏內層資訊（含 EK hint）。
3. EK 輪替狀態機：7 天輪替＋7 天 grace、舊金鑰是否真的刪除、多裝置同時輪替的收斂。
4. 降級偵測與 TOFU 釘選：能不能被中繼或攻擊者誘導降級到靜態金鑰而不被察覺。
5. 後量子混合：ML-KEM 封裝與 ECDH 結果的合成方式，種子儲存與展開。
6. 隨機性來源（一次性金鑰、nonce）。

## 三、OTF Security Lab 申請草稿（英文）

> 表單欄位以實際頁面為準；以下是各常見欄位可直接貼上的內容。

**Project name:** Cinderous

**Repository:** https://github.com/VaalRL/Cinderous (AGPL-3.0-only); protocol library:
https://github.com/VaalRL/cinderous-sdk (AGPL-3.0-only)

**Short description:**
Cinderous is a decentralized, end-to-end encrypted instant messenger built on Nostr and WebRTC.
Messages are encrypted with NIP-44 and wrapped with NIP-17/59 Gift Wrap so relays see neither
content nor sender. Real-time media and files go peer-to-peer. It ships as a desktop app (Tauri),
an Android app, a web app and a CLI. There is no central server holding plaintext or keys.

**Relevance to internet freedom:**
It gives users a messenger with no account, no phone number and no central operator; anyone can
self-host a relay, and organizations can run a closed relay. Relay operators are treated as the
primary adversary in the threat model, and metadata minimization is an explicit design goal.

**What we want audited:**
An opt-in forward-secrecy layer: per-identity encryption subkeys rotated weekly and deleted after a
7-day grace period, announced via signed replaceable events, with downgrade detection, TOFU pinning,
multi-device key distribution, and a hybrid post-quantum (ML-KEM) encapsulation on top of NIP-44.
Roughly 1,340 lines of TypeScript (listed by file in our scope document). Cryptographic primitives
come from @noble/* and nostr-tools; we do not implement primitives ourselves.

**Current status and why an audit matters now:**
The feature is implemented, tested, and available to users as an experimental, off-by-default
option. We deliberately do not advertise it as forward secrecy until it is externally reviewed.
An internal deadline (2027-01-30) forces us to decide whether to keep, weaken, or withdraw the claim.

**Known limitations we already disclose:**
Rotation-based forward secrecy (7–14 day window), not a per-message double ratchet; no
post-compromise security; falls back to static keys when the peer has no announced subkey;
does not protect locally stored history.

**Team:** small independent open-source team; single primary maintainer.

## 四、OpenSats（The Nostr Fund）一頁申請草稿（英文）

**Project:** Cinderous — a Nostr-native, end-to-end encrypted instant messenger (desktop, Android,
web, CLI), AGPL-3.0-only.

**Request:** Funding for an independent cryptographic audit of our opt-in forward-secrecy layer
built on NIP-44 and NIP-17/59 (rotating encryption subkeys, downgrade detection, multi-device key
distribution, hybrid ML-KEM). Scope is about 1,340 lines of TypeScript on top of @noble/* and
nostr-tools.

**Why it matters for Nostr:** Forward secrecy for Nostr DMs is an open problem. Our design stays
compatible with standard NIP-44 / Gift Wrap clients and only adds signed key announcements. A public
audit report and the reusable protocol module (published separately as cinderous-sdk) give other
Nostr clients a reviewed reference instead of each project inventing its own scheme. OpenSats has
previously funded a NIP-44 / noble-ciphers audit; this would extend that work one layer up.

**Status:** Implemented and shipping as experimental, off by default, not marketed as forward
secrecy until audited. Test suite: about 3,400 tests across the monorepo.

**Deliverables:** Public audit report; fixes for all findings; updated design documents (ADRs).

**Budget:** to be filled in after getting an auditor quote.

## 五、送出紀錄

| 日期 | 對象 | 結果 |
|---|---|---|
| （尚未送出） | | |
