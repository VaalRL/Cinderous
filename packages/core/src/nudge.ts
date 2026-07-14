// 「敲一下」（kind 20100，Ephemeral、**NIP-59 封裝**）。
//
// 過去 `NUDGE_KIND = 20100` 在 `relay-backend.ts`、`browser-backend.ts`、`demo/main.ts`
// **各定義一次**，事件也在各自的檔案裡用 `finalizeEvent` 現組——而其他所有 kind 都在 core。
// 收斂到這裡（SSOT）。
//
// 封裝的理由與 typing 完全相同（ADR-0120）：明文的 nudge 是一條**用真名簽署、指名對方、
// 帶時間戳**的社交圖譜邊。見 `typing.ts` 的說明。

import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { openWrap, sealAndWrap } from "./nip59.js";

/** 建立一筆封裝的「敲一下」事件。內容為空——nudge 沒有酬載，訊號本身就是全部。 */
export function createNudge(sk: SecretKey, recipientPk: PubkeyHex, opts: { created_at?: number } = {}): NostrEvent {
  const nowSec = opts.created_at ?? Math.floor(Date.now() / 1000);
  return sealAndWrap({ kind: KIND.NUDGE, created_at: nowSec, tags: [], content: "" }, sk, recipientPk, {
    kind: KIND.NUDGE,
    tags: [["p", recipientPk]],
  });
}

/** 解開一筆封裝的 nudge，回傳**經身分驗證的**寄件人；解不開時拋錯。 */
export function readNudge(event: NostrEvent, recipientSk: SecretKey): PubkeyHex {
  return openWrap(event, recipientSk).sender;
}
