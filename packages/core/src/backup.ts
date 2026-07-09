// 加密備份碼（ADR-0070）：使用者自持的密碼加密身分備份——混合式格式。
//
// 內層：nsec 以 NIP-49（ncryptsec，scrypt＋XChaCha20-Poly1305）加密，
//       採 nostr-tools 現成實作（ADR-0004/0007：不自行實作加密原語）——
//       其他 Nostr 客戶端也能匯入這把金鑰（生態互通）。
// 外層：`{ v, ncryptsec, relayUrl }` 信封，序列化為單一字串（可貼上/印 QR）。
//       relayUrl 為明文欄位：與分享字串（`npub…@wss://…`）同級的低敏感路由提示，
//       在使用者自持的備份物裡明文存放可接受；密碼保護的是金鑰本體。
//
// 密文不上雲、不發佈、不進 repo——沒有可公開查詢的密文就沒有密碼猜測神諭。

import { decrypt as nip49Decrypt, encrypt as nip49Encrypt } from "nostr-tools/nip49";
import { nsecDecode, nsecEncode } from "./keys.js";

/** 備份碼外層信封。 */
export interface BackupPayload {
  v: 1;
  /** NIP-49 標準密文（內含鹽/scrypt 參數/nonce）。 */
  ncryptsec: string;
  /** 此身分的 home relay（還原後直接連回自己的收件匣）。 */
  relayUrl: string;
}

/** NIP-49 標準預設 scrypt 成本（N=2^16）；測試可傳低值加速。 */
const DEFAULT_LOGN = 16;

/** 產生加密備份碼：以備份密碼包裹 nsec、附上 home relay，輸出單一 JSON 字串。 */
export function makeBackupCode(
  nsec: string,
  relayUrl: string,
  password: string,
  opts: { logn?: number } = {},
): string {
  const ncryptsec = nip49Encrypt(nsecDecode(nsec), password, opts.logn ?? DEFAULT_LOGN);
  const payload: BackupPayload = { v: 1, ncryptsec, relayUrl };
  return JSON.stringify(payload);
}

/** 解析備份碼並以密碼還原；密碼錯誤或格式不符拋錯。 */
export function parseBackupCode(code: string, password: string): { nsec: string; relayUrl: string } {
  const payload = JSON.parse(code) as Partial<BackupPayload>;
  if (payload.v !== 1 || typeof payload.ncryptsec !== "string" || typeof payload.relayUrl !== "string") {
    throw new Error("備份碼格式不符");
  }
  const sk = nip49Decrypt(payload.ncryptsec, password);
  return { nsec: nsecEncode(sk), relayUrl: payload.relayUrl };
}

/** 是否「看起來」是備份碼（不驗密碼）；供匯入欄位自動判別 nsec／備份碼。 */
export function isBackupCode(input: string): boolean {
  try {
    const p = JSON.parse(input) as Partial<BackupPayload>;
    return p.v === 1 && typeof p.ncryptsec === "string";
  } catch {
    return false;
  }
}

/** 讀出信封的 relayUrl（明文欄位，不需密碼）；非備份碼回 undefined。供匯入 UI 預填。 */
export function peekBackupRelay(input: string): string | undefined {
  try {
    const p = JSON.parse(input) as Partial<BackupPayload>;
    return p.v === 1 && typeof p.relayUrl === "string" && p.relayUrl ? p.relayUrl : undefined;
  } catch {
    return undefined;
  }
}
