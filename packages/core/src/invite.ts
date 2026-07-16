// 入職邀請碼與入職請求（ADR-0156）。
//
// 邀請碼：`cinderinvite1<base64url(JSON)>` 單一 token——**不是機密**（relay 與管理者
// npub 本來就要交付），但內含的 `token` 是核准權杖（capability）：企業主只自動核准
// 帶正確權杖的入職請求，撿到管理者 npub 的人不能憑空入冊。
// 入職請求：rumor kind ORG_JOIN 經 Gift Wrap 給管理者（密文、走離線信箱、7 天過期）。

import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import type { Rumor } from "./nip59.js";
import { sealAndWrap } from "./nip59.js";

const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/** 入職邀請碼內容。 */
export interface OrgInvite {
  v: 1;
  /** 公司中繼站（成員身分鎖定於此）。 */
  relayUrl: string;
  /** 管理者（企業主）hex pubkey——成員的名冊信任根（ADR-0047）。 */
  adminPubkey: PubkeyHex;
  /** 核准權杖：入職請求帶上它，企業主端比對相符才自動核准。 */
  token: string;
}

const PREFIX = "cinderinvite1";
/** 在整段文字中抽出邀請碼 token（員工貼整封邀請信也能解析）。 */
const CODE_RE = /cinderinvite1([0-9A-Za-z_-]+)/;

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** 產生核准權杖：128-bit 隨機 hex（建立企業主身分時呼叫一次，存 Profile）。 */
export function newInviteToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 組出邀請碼（單一 token，可貼可印 QR）。 */
export function makeOrgInvite(invite: { relayUrl: string; adminPubkey: PubkeyHex; token: string }): string {
  const payload: OrgInvite = { v: 1, relayUrl: invite.relayUrl, adminPubkey: invite.adminPubkey, token: invite.token };
  return PREFIX + b64urlEncode(JSON.stringify(payload));
}

/**
 * 從任意文字中抽出並驗證邀請碼；找不到或欄位不符（非 ws(s)://、非 64 hex、空權杖）回 null。
 */
export function parseOrgInvite(input: string): OrgInvite | null {
  const m = CODE_RE.exec(input);
  if (!m?.[1]) return null;
  const json = b64urlDecode(m[1]);
  if (!json) return null;
  try {
    const p = JSON.parse(json) as Partial<OrgInvite>;
    if (p.v !== 1) return null;
    if (typeof p.relayUrl !== "string" || !/^wss?:\/\/.+/.test(p.relayUrl)) return null;
    if (typeof p.adminPubkey !== "string" || !/^[0-9a-f]{64}$/.test(p.adminPubkey)) return null;
    if (typeof p.token !== "string" || !p.token || p.token.length > 128) return null;
    return { v: 1, relayUrl: p.relayUrl, adminPubkey: p.adminPubkey, token: p.token };
  } catch {
    return null;
  }
}

/** 是否「看起來」含邀請碼（供登入畫面顯示名稱欄自動判別）。 */
export function isOrgInvite(input: string): boolean {
  return parseOrgInvite(input) !== null;
}

/**
 * 入職請求（ADR-0156）：成員把 `{name, token}` 以 Gift Wrap 加密送給管理者。
 * 中繼站只見密文；管理者離線也收得到（離線信箱、7 天過期）。
 */
export function wrapOrgJoin(
  join: { name: string; token: string },
  senderSk: SecretKey,
  adminPk: PubkeyHex,
  opts: { now?: number; relayHint?: string } = {},
): NostrEvent {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const tags = opts.relayHint ? [["relay", opts.relayHint]] : [];
  return sealAndWrap(
    { kind: KIND.ORG_JOIN, created_at: nowSec, tags, content: JSON.stringify({ name: join.name, token: join.token }) },
    senderSk,
    adminPk,
    {
      kind: KIND.OFFLINE_DM_GIFT_WRAP,
      tags: [
        ["p", adminPk],
        ["expiration", String(nowSec + DEFAULT_TTL_SECONDS)],
      ],
    },
  );
}

/** 解析入職請求 rumor；非入職 kind、壞 JSON、空名或空權杖回 null。名稱去空白。 */
export function parseOrgJoin(rumor: Rumor): { name: string; token: string } | null {
  if (rumor.kind !== KIND.ORG_JOIN) return null;
  try {
    const p = JSON.parse(rumor.content) as { name?: unknown; token?: unknown };
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const token = typeof p.token === "string" ? p.token : "";
    if (!name || !token || name.length > 100 || token.length > 128) return null;
    return { name, token };
  } catch {
    return null;
  }
}
