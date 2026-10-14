# 0374. @noble／@scure 升到 2.4.0、整棵樹只留一份，並以黃金向量保證既有資料與線上格式逐位元不變

- 狀態：已接受
- 日期：2026-09-30
- 相關文件：ADR-0004（core 用 `@noble` 做 secp256k1）、ADR-0007（NIP-44 用 nostr-tools）、ADR-0070（NIP-49 備份碼）、
  ADR-0112（web／行動端 at-rest 加密、密碼鎖）、ADR-0307（單一 TypeScript 實作、常數時間限制）、
  ADR-0365（後量子 EK 混合式封裝）、Cinderous SDK ADR 0020／0034（SDK 端的同一件事）、
  `docs/SECURITY.md`〈實作語言的固有限制〉、`packages/core/src/golden/`

## 背景與問題

### 樹裡有三份密碼學函式庫，App 自己的簽章停在 1.9.7

| 誰 | @noble/curves | @noble/hashes | @noble/ciphers | @scure/base |
|---|---|---|---|---|
| `packages/core` 自己（簽章、事件 id、at-rest、密碼鎖、配對） | **1.9.7** | **1.8.0** | 2.2.0 | **1.2.6** |
| nostr-tools 2.23.8（NIP-44、NIP-49、`getEventHash`） | 2.0.1 | 2.0.1 | 2.1.1 | 2.0.0 |
| @noble/post-quantum 0.7.1（ML-KEM，ADR-0365） | 2.4.0 | 2.4.0 | 2.4.0 | — |

實際打包（`vite build`）裡有**兩份** secp256k1、兩份 SHA-256、兩份 bech32（後量子只用到 hashes 的 SHA-3，沒帶進 curves）。

### 安全理由

- **@noble/curves 2.3.0**：常數時間由「盡力」改為**實測保證**（純量乘法以 CSPRNG 盲化、未預算的點改用常數時間
  固定視窗乘法、模運算強化；Trail of Bits 審查修正）。App 的身分簽章（`sign.ts`、`keys.ts`）一直跑在 1.9.7。
  來源：<https://github.com/paulmillr/noble-curves/releases/tag/2.3.0>
- **@noble/curves 2.4.0**：ECDH／ECDSA 拒收無窮遠點、DER 先限長再轉 bigint、安全相關參數先快照。
- **@noble/hashes 2.4.0**：Security and correctness——選項防竄改／防汙染、zeroization 改善、webcrypto 拒收會讓引擎崩潰
  的輸出長度。來源：<https://github.com/paulmillr/noble-hashes/releases/tag/2.4.0>
- **@noble/ciphers 2.3／2.4**、**@scure/base 2.4**：AEAD 對不支援 AAD 的密碼傳 AAD 改拋錯、bech32 拒收非可列印 ASCII 等。
  細節見 SDK ADR 0034 的表格（同一批版本）。

⚠ 這**不改變** `docs/SECURITY.md` 的「常數時間無法保證」：JS 引擎本身沒有保證（ADR-0307）。改變的是函式庫這一層從
「目標」變成「經實測」。

### 風險：升級密碼學函式庫最怕的是「綠燈但位元組變了」

- 密碼鎖（Argon2id）導出不同的 KEK ⇒ 使用者**再也打不開**自己的密碼鎖，而畫面只會顯示「密碼錯」。
  而 `@noble/hashes` 2.4 **改了 argon2 的預設值**（`t: 3`、`m: 1 GiB`、`maxmem: 1 GiB`）。
- at-rest（HKDF）導出不同的儲存金鑰 ⇒ 本機所有 `c1:` 資料讀不回來。
- 簽章、事件 id、NIP-44、Gift Wrap 位元組變了 ⇒ 新舊版 App 不互通，**必須所有裝置同時更新**。

這些錯誤各模組的既有單元測試都抓不到——每個模組自己跟自己來回，永遠對得上。

## 考量的選項

- A：維持現狀，等 nostr-tools 升級。✗ App 自己的簽章停在沒有常數時間保證的 1.9.7；三份函式庫。
- B：只升 core，不管 nostr-tools。nostr-tools 路徑（NIP-44、NIP-49）仍 2.0.1，打包仍兩份。
- **C：core 升 2.4.0，並在根目錄 `pnpm-workspace.yaml` 以 `overrides` 讓 nostr-tools 也用同一份**（SDK ADR 0034 的
  使用方指引）。整棵樹一份。

## 決策

採 **C**。

1. `packages/core` 相依：`@noble/curves`、`@noble/hashes`、`@noble/ciphers`、`@scure/base` 全部釘 **2.4.0**（確切版本，
   與 `@noble/post-quantum` 0.7.1 的釘版相同）；`@noble/post-quantum` 維持 `^0.7.1`（已依賴 2.4.0）。
2. 根目錄 `pnpm-workspace.yaml` 加 `overrides`，**六個一起**：`@noble/curves`、`@noble/hashes`、`@noble/ciphers`、
   `@scure/base`、`@scure/bip32`、`@scure/bip39` → 2.4.0。
   - 只導 `@scure/base` 會讓 `@scure/bip39` 2.0.1（import 已移除的內部 `utils`）在**載入時**就拋（SDK ADR 0034 Decision 2）。
   - 樹裡唯一另一個依賴 `@noble/hashes` 的是 jsdom 的 `@exodus/bytes`（僅開發），其 peer 宣告 `^1.8.0 || ^2.0.0`，
     頂層寫法安全，不需要改成只對 nostr-tools 的巢狀寫法。
   - pnpm 10.33 忽略 `package.json` 的 `pnpm.overrides`，必須寫在 `pnpm-workspace.yaml`。
   - `pnpm why`：六個套件各 **Found 1 version**（2.4.0）。
3. **1.x → 2.x API 改寫**（`packages/core/src`，只有這一層直接用 noble）：
   - 子路徑加 `.js`：`@noble/curves/secp256k1` → `secp256k1.js`、`@noble/hashes/utils` → `utils.js`、
     `@noble/hashes/sha256` → `sha2.js`（`keys`、`sign`、`event`、`pairing`、`datachannel`、`group`）。
   - `schnorr.utils.randomPrivateKey()` → `randomSecretKey()`（`keys.ts`；固定亂數下輸出相同，見黃金向量 `keys.generatedSk`）。
   - schnorr 只收 bytes：`sign(hexToBytes(id), sk)`、`verify(hexToBytes(sig), hexToBytes(id), hexToBytes(pubkey))`，
     轉換放在既有的 `try` 內 ⇒ 格式錯誤的 sig／pubkey 仍回 `false`（測試涵蓋奇數長度、非 hex、空字串）。
   - `hkdf` 的 `info` 只收 bytes：`at-rest.ts` 改傳 `utf8ToBytes(INFO)`（1.x 內部就是做這件事 ⇒ 同一把金鑰）。
   - `bytesToUtf8` 已移除：改 `new TextDecoder().decode()`（1.8.0 的實作就是這一行；`pairing.ts` 早已這樣寫）。
   - `@scure/base` 1 → 2：App 用到的 `base64`、`bech32.encode／decode(…, 1000)`、`toWords／fromWords` 簽名不變；
     2.4 的 90 字元上限只套用在 `decodeToBytes`，App 沒用。
4. **Argon2id 參數全部明確傳入**（`passlock-web.ts`）：原本已明確傳 `m`、`t`、`p`、`dkLen`，**依賴了預設值的是
   `version` 與 `maxmem`**：
   - `version`：兩版預設都是 0x13，輸出不受影響，但改為明寫 `0x13`（與桌面 `passlock.rs` 的 `Version::V0x13` 一致）。
   - `maxmem`：1.x 預設 2^32−1，2.4 改為 1 GiB。它**不影響輸出**，只決定「多大的 `m` 會被拒」。改為明寫
     `M_COST_MAX × 1024`（＝本檔自己的上限 1 GiB）⇒ `unwrapSecret` 會接受的每一個 blob，記憶體檢查都不會擋，
     與 1.x 可解開的範圍相同。
   - App 寫出的 blob 一律是 `m=19456、t=2、p=1`（blob 內記錄參數，解鎖時照 blob 的值導出）——黃金向量核對了這一點。
5. **不在啟動時 `secp256k1.Point.BASE.precompute(8)`**（理由見〈效能〉）。
6. **守門測試** `packages/core/src/golden/dependency-pins.test.ts`：lockfile 裡六個套件各只有一個版本且 ≥ 2.4.0、
   `pnpm-workspace.yaml` 有六條 overrides、core 宣告的版本 ≥ 2.4.0。拿掉 overrides 或降版會紅（升級前實測 13 則全紅）。

## 黃金向量策略

`packages/core/src/golden/`：

- `noble-golden.ts`：固定輸入（私鑰、密碼、鹽、明文、種子）＋**固定亂數**——`withFixedRandom` 暫時換掉
  `crypto.getRandomValues` 與 `Math.random`。noble 1.x／2.x、nostr-tools、@noble/post-quantum 的亂數都經過
  `getRandomValues` ⇒ nonce、auxRand、一次性 wrap 金鑰、ML-KEM 封裝亂數、NIP-59 時戳抖動全部確定 ⇒ **整則 Gift Wrap、
  整個密碼鎖 blob 都能逐位元比對**。填入的值只取決於「要幾個位元組」而非呼叫次數——2.3 起多出的純量盲化亂數不會把後面的值擠歪。
- `noble-1x-golden.json`：**升級前**（`_meta.versions` 記錄 curves 1.9.7／hashes 1.8.0／base 1.2.6，nostr-tools 底下 2.0.1）
  產生並先單獨 commit；連跑兩次輸出逐位元相同（確定性）。
- `write-golden.test.ts`：產生器。平常略過；`CINDER_WRITE_GOLDEN=1 pnpm --filter @cinderous/core exec vitest run src/golden/write-golden.test.ts`。
  ⚠ 在已升級的樹上重產會把新行為寫成標準答案，只有刻意接受格式變更（並另立 ADR 說明遷移）時才可以。
- `nip44.vectors.json`：NIP-44 官方向量（paulmillr/nip44，SHA-256 `269ed0f6…25040`，測試先驗雜湊）；
  `.gitattributes` 標 `-text`，避免 Windows `autocrlf` 改了換行讓雜湊對不上。
- `noble-golden.test.ts`（42 則）兩類斷言：
  1. **逐位元相同**：keys、event、nip44、hybridKem、nip59、atRest、pairing、datachannel、group、passlock＋backup 各區段與 fixture 深度相等。
  2. **舊產物新程式讀得回**（與亂數無關，是「使用者升級後資料還在」的直接證明）：

| 範圍 | 斷言 |
|---|---|
| keys | 固定私鑰→公鑰；npub／nsec 編解碼；前綴錯、校驗碼錯拒收 |
| event／sign | NIP-01 序列化、id；舊事件驗得過；竄改內容／sig／id／作者驗不過；格式錯誤的 sig／pubkey 回 false；真亂數新簽事件同 id 且驗得過 |
| NIP-44 | 對話金鑰雙向相同；舊密文可解；官方向量 get_conversation_key、encrypt_decrypt（固定 nonce 逐位元）、long_msg、calc_padded_len、invalid |
| NIP-59／17 | 舊古典 Gift Wrap（含 seal tags）、舊混合式（ML-KEM）Gift Wrap 可解；缺 ML-KEM 私鑰拒絕；竄改拒絕；`wrapMessage` 對方與自封副本可解、rumor id 相同 |
| hybrid-kem | 固定種子→同一對金鑰（pk／sk 雜湊）；舊 KEM 密文解出同一個共享祕密；混合 HKDF（seal／wrap）相同 |
| at-rest | HKDF 儲存金鑰相同；舊 `c1:` 密文解得回；錯鑰、竄改回 null；無前綴舊明文原樣回傳 |
| passlock | blob 參數＝App 參數；該參數的原始 Argon2id 輸出相同；**舊密碼鎖以正確密碼解開**；密碼錯、密文竄改、換鹽回 null |
| pairing | 舊 AES-GCM 捆包與信令可解；竄改拋錯；SAS 短碼、房間金鑰相同 |
| datachannel | 舊分塊框架可解；整檔與逐段 SHA-256 相同 |
| backup（NIP-49） | 舊備份碼以正確密碼還原；密碼錯拋錯 |
| NIP-06 | 助記詞導出同一把私鑰（與 SDK v0.28 產物相同）——守 bip32／bip39 的 overrides |

**結果：升級後 42 則全綠，所有區段逐位元相同。**

## 線上格式與相容性

- 事件、簽章、事件 id、NIP-44 密文、NIP-59 Gift Wrap（含後量子 `pqct`）、NIP-49 `ncryptsec`、配對捆包的位元組都不變
  ⇒ **新舊 App 版本可互通，不需要所有裝置同時更新**；既有密碼鎖、at-rest 資料、備份碼不需遷移。
- 已知的行為差異只在**惡意構造**的輸入：schnorr 驗章另拒 `s = 0`（誠實簽章不會出現）、ECDH 拒無窮遠點、bech32 拒非可列印
  ASCII。都是原本就該拒的東西。

## 打包大小

`vite build`（桌面 web／內嵌、行動 Capacitor web）、esbuild（CLI、內嵌中繼 worker），JS 合計；「份數」以 secp256k1 的
群階常數、SHA-256 常數、bech32 字母表在輸出中出現的次數計。

| 產物 | 升級前 | 升級後 | 差 | secp256k1 份數 |
|---|---|---|---|---|
| 桌面 web（`apps/desktop/dist`，內嵌 `resources/web` 相同） | 1,093.4 KB／gzip 357.3 | 1,053.3／343.6 | **−40.1／−13.7** | 2 → 1 |
| 行動（`apps/mobile/dist`，APK 內的網頁） | 990.7／319.6 | 950.7／305.6 | **−40.0／−14.0** | 2 → 1 |
| CLI（`apps/cli/dist`） | 746.9／210.4 | 662.9／188.3 | −84.0／−22.1 | 2 → 1 |
| 內嵌中繼 worker（`relay-worker.js`） | 208.8／59.9 | 199.5／58.2 | −9.3／−1.7 | 1 → 1 |

## 效能

桌面 Node 26（Windows，背景有其他工作），3 次交錯取中位，µs／次；以 core 實際解析到的 `@noble/curves` 與 nostr-tools 量測。

| | 1.9.7（NIP-44 為 nostr-tools 的 2.0.1） | 2.4.0 | 2.4.0＋`precompute(8)` |
|---|---|---|---|
| `schnorr.getPublicKey` | 192 | 319（+66%） | 235（+23%） |
| `schnorr.sign` | 1,658 | 1,635（−1%） | 1,492（−10%） |
| `schnorr.verify` | 1,285 | 973（−24%） | ≈1,000 |
| NIP-44 對話金鑰（ECDH＋HKDF） | 2,062 | 1,741（−16%） | ≈1,800 |
| 第一次 getPublicKey（含建表，冷啟動） | 18.0 ms | 19.8 ms | —（SDK 實測 45.6 ms） |

- 只有「固定基點」的 getPublicKey 變慢（視窗 W=8→6、常數時間強化），與 release notes 一致；驗章與 ECDH 變快。
- App 一則私訊（`wrapForBoth`：對方＋自封副本兩份 wrap）約 7 次 getPublicKey（+0.9 ms）、4 次 ECDH（−1.3 ms）、
  4 次簽章（持平）；收訊是驗章＋ECDH，全部變快。⇒ 淨效果持平或略快。
- **`precompute(8)` 不做**：它改的是 `@noble/curves` 的模組單例（整棵樹一份 ⇒ 連 nostr-tools 一起改），heap 多約 600 KB、
  第一次金鑰運算多約 25 ms（SDK ADR 0034 實測）——行動裝置的啟動時間與記憶體比每次省 80 µs 重要。App 的簽章是逐則觸發
  （送訊、每座中繼一次的 NIP-42 AUTH、presence／EK 公告），不是批次大量簽章；收件匣補抓走的是驗章＋ECDH（已變快），不構成理由。長時間大量簽章的程式（例如中繼）日後需要時再各自評估。
- ⚠ 行動裝置實機速度**未量測**（見後續待辦）。

## 理由

- 安全修正（常數時間保證、Trail of Bits 審查修正）直接落在 App 的身分簽章與 nostr-tools 的 NIP-44 路徑上；
  代價只有 getPublicKey 慢約 0.1 ms。
- 黃金向量讓「位元組不變」從推論變成測試：升級前釘住、升級後逐位元比對，並用新程式解舊產物。
- 整棵樹一份，打包反而小了約 40 KB（gzip 14 KB）。

## 後果

- 正面：App 自己的簽章、事件、at-rest、密碼鎖、配對，以及 nostr-tools 的 NIP-44／NIP-49 全部改用 2.4.0；
  打包 −40 KB；驗章與 ECDH 變快；密碼鎖不再依賴任何 argon2 預設值；有了能擋下「靜默換位元組」的黃金向量與守門測試。
- 負面 / 已知殘餘風險：
  - overrides 讓 nostr-tools 跑在它沒宣告支援的相依版本上；由 NIP-44 官方向量＋黃金向量把關，**nostr-tools 升級時要重跑**。
  - `@noble/post-quantum` 若之後的 0.7.x 改釘更新的 noble，overrides 會把它壓回 2.4.0（測試仍會跑過）；升級時要看
    `pnpm why` 與 release notes 決定下限是否一起升。
  - getPublicKey 慢約 0.1 ms（桌面）；行動裝置未量測。
  - `.pnpm` 裡的舊版目錄是 pnpm 未清的孤兒，不在解析路徑上（`pnpm why` 已確認）。
- **發版注意事項**：
  - 本 ADR **不發版**。要出貨必須走完整 App 發版流程（版號同步、release notes、桌面安裝檔、**Android APK 重建**
    ——APK 內的網頁打包換了函式庫，舊 APK 不會自動得到這些修正）。排入哪一版由使用者決定。
  - 線上格式不變 ⇒ 不需要要求所有裝置同時更新（這點與 v0.0.18 後量子開播不同），但只有更新後的裝置得到常數時間保證。
  - release notes 可寫「更新密碼學函式庫（常數時間強化）」；**不得**寫成「量子安全」或暗示已通過外部審計。
- 後續行動 / 待辦（實機）：
  1. 行動裝置實機量測 getPublicKey／sign（冷啟動與穩態），確認無可感延遲。
  2. 以真實既有裝置（v0.0.18 建立的密碼鎖）驗證解鎖成功。
  3. 以真實既有裝置驗證 at-rest `c1:` 資料（對話、便條、託管清單）升級後讀得回。
  4. 一台舊版、一台新版互傳私訊（含後量子開啟時）確認互通。
