// 行動端登入（ADR-0081）：以「同一把 Nostr 私鑰」在手機登入桌面既有帳號的兩條路——
//   A. nsec 匯入：貼上桌面「設定 → 身分備份」的 nsec，本機解碼還原同帳號。
//   B. 配對匯入：沿用桌面 D4a 配對克隆（ADR-0072）——舊機顯示配對碼，新機貼上、比對 SAS，
//      收到全量捆包後由 `snapshot.identity.nsec` 得到同帳號。
//
// 本檔為純邏輯（無 UI、無 DOM）：金鑰解碼/公鑰導出重用 @cinder/core，配對載荷解析用 core
// `parsePairing`，捆包身分萃取用 @cinder/engine `PairBundle`。錯誤以 i18n MessageKey 回報，
// 交由畫面翻譯。傳輸層（WebRTC＋relay）不在此——由呼叫端注入（產線需原生/EAS，見 ADR-0063）。
import { getPublicKey, npubEncode, nsecDecode, nsecEncode, parsePairing, type PubkeyHex, type SecretKey } from "@cinder/core";
import type { PairBundle } from "@cinder/engine";
import type { MessageKey } from "@cinder/i18n";

/** 登入後的本機身分（同桌面帳號＝同一把 sk）。 */
export interface MobileIdentity {
  sk: SecretKey;
  pubkey: PubkeyHex;
  npub: string;
  /** 正規化後的 nsec（供本機安全儲存；絕不外流）。 */
  nsec: string;
  name: string;
}

export type SignInResult = { ok: true; identity: MobileIdentity } | { ok: false; error: MessageKey };

/** 只由 nsec 導出 npub（供畫面即時預覽身分）；非法回 null。 */
export function npubFromNsec(nsec: string): string | null {
  try {
    return npubEncode(getPublicKey(nsecDecode(nsec.trim())));
  } catch {
    return null;
  }
}

/** A：由 nsec＋顯示名稱組出身分。名稱空白或 nsec 非法皆回錯誤鍵。 */
export function identityFromNsec(nsec: string, name: string): SignInResult {
  const nm = name.trim();
  if (!nm) return { ok: false, error: "mobileSignIn_errName" };
  let sk: SecretKey;
  let pubkey: PubkeyHex;
  try {
    sk = nsecDecode(nsec.trim());
    pubkey = getPublicKey(sk);
  } catch {
    return { ok: false, error: "mobileSignIn_errNsec" };
  }
  return { ok: true, identity: { sk, pubkey, npub: npubEncode(pubkey), nsec: nsecEncode(sk), name: nm } };
}

/** B：由配對捆包萃取身分（同帳號）；捆包無身分回錯誤鍵。名稱優先用覆寫，其次捆包內名稱。 */
export function identityFromPairBundle(bundle: PairBundle, overrideName?: string): SignInResult {
  const id = bundle?.snapshot?.identity; // 防禦：捆包形狀異常時遵守回傳型別，不丟未捕捉 TypeError。
  if (!id || typeof id.nsec !== "string" || !id.nsec) return { ok: false, error: "mobilePair_errNoIdentity" };
  // 捆包沒帶名稱不是「使用者忘了填」——給預設名，避免卡在 errName 死路（配對畫面無名稱欄可修正）。
  const name = overrideName?.trim() || id.name?.trim() || "我";
  return identityFromNsec(id.nsec, name);
}

/** 取 relay 網址主機名（去 wss:// 與路徑）；空或解析失敗回原字串。 */
function hostOf(url: string): string {
  const u = url.trim();
  if (!u) return "";
  try {
    return new URL(u).host;
  } catch {
    return u.replace(/^wss?:\/\//i, "").replace(/\/.*$/, "");
  }
}

export type PairPreview = { ok: true; relayHost: string } | { ok: false; error: MessageKey };

/** B：驗證配對碼並取會合中繼站主機名（供畫面在連線前顯示）；非法/過期回錯誤鍵。 */
export function previewPairing(code: string): PairPreview {
  try {
    const { payload } = parsePairing(code.trim());
    return { ok: true, relayHost: hostOf(payload.relay ?? "") };
  } catch {
    return { ok: false, error: "mobilePair_errCode" };
  }
}
