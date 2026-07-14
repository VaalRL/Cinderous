// 行動端登入（ADR-0081）：以「同一把 Nostr 私鑰」在手機登入桌面既有帳號的兩條路——
//   A. nsec 匯入：貼上桌面「設定 → 身分備份」的 nsec，本機解碼還原同帳號。
//   B. 配對匯入：沿用桌面 D4a 配對克隆（ADR-0072）——舊機顯示配對碼，新機貼上、比對 SAS，
//      收到全量捆包後由 `snapshot.identity.nsec` 得到同帳號。
//
// 本檔為純邏輯（無 UI、無 DOM）：金鑰解碼/公鑰導出重用 @cinder/core，配對載荷解析用 core
// `parsePairing`，捆包身分萃取用 @cinder/engine `PairBundle`。錯誤以 i18n MessageKey 回報，
// 交由畫面翻譯。傳輸層（WebRTC＋relay）不在此——由呼叫端注入（產線需原生/EAS，見 ADR-0063）。
import {
  getPublicKey,
  isWrapped,
  npubEncode,
  nsecDecode,
  nsecEncode,
  parsePairing,
  type PubkeyHex,
  type SecretKey,
  unwrapSecret,
  wrapSecret,
} from "@cinder/core";
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

// ── 「記住我」（ADR-0117）：以本地密碼記住身分 ──────────────────────────────
//
// 行動端**從不明文儲存 nsec**（ADR-0112 的紅線）——所以過去每次開 App 都要重貼一次 nsec。
// 那很難用，也讓人有把 nsec 貼到不安全地方的動機。
//
// 解法與桌面同一套（ADR-0067/0112）：**Argon2id 以密碼導出 KEK，包裹 nsec**。
// 磁碟上只有密文；沒有密碼就打不開。KEK **從不落盤**。
//
// 這不是「假安全感」——它擋不住頁面內的惡意 JS（桌面的 webview 同樣擋不住），
// 但它擋住「有人拿到這台裝置／複製了 localStorage」。而**不做的後果不是誠實，是每次重貼 nsec**。

/** 記住的身分：nsec 已被密碼包裹（絕不明文）。 */
export interface RememberedIdentity {
  pubkey: PubkeyHex;
  npub: string;
  name: string;
  /** Argon2id 包裹的 nsec（`wrapSecret`）。 */
  wrapped: string;
}

/** 以密碼記住某身分。密碼空白回 null（不接受無密碼的「記住」——那等於明文）。 */
export function rememberIdentity(identity: MobileIdentity, password: string): RememberedIdentity | null {
  if (!password) return null;
  return {
    pubkey: identity.pubkey,
    npub: identity.npub,
    name: identity.name,
    wrapped: wrapSecret(password, identity.nsec),
  };
}

/** 這個值是不是合法的「記住的身分」（用來決定要不要顯示解鎖畫面）。 */
export function isRemembered(v: unknown): v is RememberedIdentity {
  const r = v as Partial<RememberedIdentity> | null;
  return (
    !!r &&
    typeof r.pubkey === "string" &&
    typeof r.npub === "string" &&
    typeof r.name === "string" &&
    typeof r.wrapped === "string" &&
    isWrapped(r.wrapped) // 只認密碼包裹的 blob——明文 nsec 一律不收（ADR-0112 紅線）
  );
}

/** 以密碼解開記住的身分。密碼錯誤／遭竄改皆回錯誤鍵（不區分——不給攻擊者可用的訊號）。 */
export function unlockRemembered(remembered: RememberedIdentity, password: string): SignInResult {
  const nsec = unwrapSecret(password, remembered.wrapped);
  if (!nsec) return { ok: false, error: "unlock_error" };
  return identityFromNsec(nsec, remembered.name);
}
