# 0376. 中繼拒收訊息加英文詞元、可尋址拒收依原因拆開、`duplicate` 改回 `OK true`

- 狀態：已接受 (Accepted)——2026-09-30 使用者核准 SDK ADR 0038 的 P0-R2（七項決策皆採建議）；**尚未部署**
- 日期：2026-09-30
- 相關文件：ADR-0375（P0-R1：離線留言存不下回 `OK false`）、0367（§決策 2：嚴格平面只拒收）、0373（CLOSED 不靜默）、0041（外送匣：OK 感知重試）、
  0058（送達分級）、0235 H1（重放去重）、0366（車道、第三方開發者文件）；0377（App 分片連線處理 OK）；
  SDK ADR 0038（P0-R2／P0-C）、SDK ADR 0040（詞元表）；Cinderous PR #9（錨點改用 SDK 中繼，暫緩合併）；
  `relay/src/reject-messages.ts`、`relay/src/relay-core.ts`、`relay/src/message-store.ts`、`relay/src/sql-message-store.ts`、`relay/src/worker.ts`

## 背景與問題

1. **拒收訊息沒有結構**。NIP-01 只保證一個前綴（`blocked`、`invalid`…），而「配額滿了」「DO 天花板滿了」「比現有的舊」「事件太大」全部都是 `blocked:`，
   後面是中文句子。客戶端要分辨只能比對中文，脆弱；ADR-0375 已經開了頭（`blocked: ceiling:`、`invalid: expired:`）。
2. **可尋址被拒只有一句**：`blocked: 取代事件遭拒（配額/大小/較舊）`——較舊（不是錯誤，別座也一樣）、配額（換座有用）、DO 天花板（主要的改用理由）混在一起。
3. **`duplicate` 回的是 `OK false`**，NIP-01 的範例是 `OK true "duplicate: …"`。第三方客戶端可能把它當拒收。
4. 重放快取還有一個洞：ADR-0375 讓所有**拒收**都把事件從快取拿掉，但 store **丟例外**（SQLite 滿、DO 被重設）時，外層圍籬回 `NOTICE error:`，
   事件卻留在快取裡——重送只拿到 `duplicate`，而客戶端把 `duplicate` 當成已送達。

SDK 中繼 v0.32.0 已經做了同一件事（SDK ADR 0040）；本 ADR 把它做在錨點自己的 `relay/`，**句子逐字相同**，PR #9 切換時客戶端看到的不變。

## 硬限制：已上線的 App（v0.0.18）必須照常運作

逐一盤點 App 對中繼訊息文字的依賴（`packages/`、`apps/`）：

| 位置 | 依賴什麼 | 本 ADR 之後 |
|---|---|---|
| `core/outbox.ts` `classifyOk` | `accepted` 或開頭是 `duplicate` → 確認；開頭是 `blocked`／`invalid`／`pow`／`restricted`／`mute` → 永久失敗；其他 → 重試 | 只看**前綴**，詞元加在前綴後面不影響。可尋址「已過期」從 `blocked:` 變成 `invalid:`——兩者都是永久失敗，判定相同 |
| `engine/backend/pairing-transport.ts` | `/auth-required/i` → 認證後重送 | `auth-required: nip42: …` 仍命中 |
| `engine/backend/relay-backend.ts` `onOk` | `accepted` → `markSent`、快照成功；`recordBackup` 把拒收原文存成 `lastFailReason` 顯示在設定頁 | 顯示文字多了詞元（例如 `blocked: quota: 這個作者…`），比原本那句更清楚；沒有邏輯依賴 |
| `core/relay-probe.ts` | 只看 `OK` 的事件 id，不看 true／false 與文字 | 不受影響 |
| `CLOSED`、`NOTICE` | App 的 `RelayClient` 不處理 `CLOSED`；`NOTICE` 只轉給 `onNotice`（沒有比對） | 不受影響 |

`relay/src/reject-messages.test.ts` 把「每一句新舊版在 `classifyOk` 的判定相同」寫成測試。

**`duplicate` 改 `OK true` 對 App 的影響**：`classifyOk` 兩種都判「已確認」，外送匣行為不變；差別只在 `relay-backend.ts` 的 `onOk`——
以前 `OK false "duplicate:"` 不會呼叫 `markSent`，現在是 `accepted`，會標成「已送中繼」，這才是正確的
（中繼確實有這顆）。重送同一顆只發生在外送匣重試或重連補送，所以這個改善只出現在那些情況。

## 考量的選項

- 詞元放在**哪裡**：(A) 前綴後面（`blocked: quota: …`）；(B) 換掉前綴（例如 `quota: …`）；(C) 放在說明文字裡（`blocked: 配額已滿 [quota]`）。
  B 會讓 v0.0.18 的 `classifyOk` 把它歸成「重試」（不認得的前綴），違反硬限制；C 不好解析。採 A（SDK ADR 0038 決策 2）。
- 車道升級被拒的 `NOTICE`（`unknown relay path`、`invalid app lane`、`rate-limited: too many new connections`）：
  開發者文件〈Error messages〉把它們**逐字**列成「NOTICE starts with …」，第三方應用可能照字比對 ⇒ **不改**；客戶端以關閉碼 1008＋原因分類。

## 決策

1. 拒收句子集中到 `relay/src/reject-messages.ts`，與 SDK `src/relay/reject-messages.ts` 逐字相同（只有檔頭註解不同）。詞元表見 SDK ADR 0040：
   `blocked:` 的 `too-many-tags`、`too-many-recipients`、`too-large`、`not-allowed`、`kind-disabled`、`files-disabled`（保留 `MAX_FILE_MB`）、`quota`、`ceiling`、`stale`；
   `invalid:` 的 `bad-signature`、`clock-skew`、`expired`、`too-large`、`relay-tag`、`malformed`；`rate-limited:` 的 `events`、`messages`、`subscriptions`；
   `restricted:` 的 `scope`、`self-only`；`auth-required: nip42:`；`auth-failed:` 的 `no-challenge`、`bad-auth`、`relay-tag`、`too-old`；`pow: difficulty:`；
   `duplicate: seen:`；`error:` 的 `internal`、`resubscribe`（`CLOSED`：訂閱遺失、存不住）。
2. 可尋址被拒依原因拆開：`OfflineStore` 加**選用**方法 `putAddressableResult()`（回 `{ ok }` 或 `{ ok: false, reason }`），
   `MessageStore`、`SqlMessageStore` 實作，`putAddressable()` 改成它的 `.ok`（行為不變）。原因：`stale`、`too-large`、`address-quota`／`byte-quota`（線上都是 `quota`）、
   `expired`（回 `invalid: expired:`）、`ceiling`。只實作 boolean 的 store 回舊句子。
3. 重放窗內重複改回 `OK true "duplicate: seen: 事件重複"`，不扇出、不寫庫。ADR-0375 的「被拒不記進重放快取」仍然成立（留在快取裡的都真的收下過），
   另補上 store **丟例外**時也拿掉（`RelayCore.admit` 包在 try/catch）。
4. 開發者文件〈Error messages〉（中英）更新：說明詞元、`duplicate` 是 `OK true`、`CLOSED` 的 `error: resubscribe:`／`invalid: too-large:`。

## 理由

- 詞元加在前綴**後面**是唯一同時滿足「NIP-01 相容」「v0.0.18 判定不變」「SDK 客戶端拿得到細類」的做法。
- 與 SDK 中繼逐字相同，PR #9 切換時是零差異；SDK 那邊有契約測試逐句驗證分類，這邊的測試釘住逐字相同與 App 相容。
- `duplicate` 回 `OK true` 是 NIP-01 的範例，也讓 App 把「中繼已經有」正確標成已送中繼。

## 後果

- 正面：寄件端（SDK v0.32 起）分得出配額、天花板、較舊、太大；可尋址的「較舊」不再被當成錯誤；`duplicate` 與 NIP-01 一致；store 例外不再造成「重送只拿到 duplicate」。
- 負面 / 已知殘餘風險：
  - 句子成為與 SDK 共用的契約：改字要兩個 repo 一起改。
  - 自架站（App 內建一鍵部署）要等 App 下一版重新打包 `relay-worker.js` 才帶詞元；舊站客戶端照樣以前綴分類。
  - 開發者文件先於部署更新的話，文件會描述尚未上線的行為——網站與中繼應同時上線。
- 後續行動 / 待辦：
  - **部署**兩座錨點（`npx wrangler@4 deploy`，換帳號記得 `CLOUDFLARE_ACCOUNT_ID`）——須使用者另行同意；可與 ADR-0375 一起部署。
  - PR #9 rebase 時，錨點的 `reject-messages.ts` 由 SDK 提供，逐字相同。
  - App 端依詞元分類（`ceiling`／`rate-limited` 稍後重試或換座）見 ADR-0377。
