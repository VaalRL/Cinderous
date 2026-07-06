// 企業佈建與組織通訊錄（ADR-0047）：管理者簽章的成員名冊。
//
// 複用 ADR-0039 簽章清單機制：管理者金鑰簽章（NIP-01 事件，kind ORG_ROSTER_KIND），
// 信任根＝管理者公鑰。採用前驗簽 + 防清空（成員數 ≥1）+ 較新才取代。名冊同時餵
// 客戶端通訊錄（diffRoster）與 relay allowlist（rosterAllowlist）。純函式、無 I/O。

import { ORG_ROSTER_KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { finalizeEvent, verifyEvent } from "./sign.js";

/** 組織成員。`relayUrl` 為該成員的 home relay hint（可選）。 */
export interface OrgMember {
  pubkey: PubkeyHex;
  name: string;
  relayUrl?: string;
}

/** 企業政策（ADR-0048）：管理者集中控管的功能停用/強制 TURN 旗標。 */
export interface OrgPolicy {
  disableFiles?: boolean;
  disableCalls?: boolean;
  disableStickers?: boolean;
  /** 強制 WebRTC 只走 TURN（iceTransportPolicy: "relay"），避免揭露內網 IP。 */
  forceTurn?: boolean;
}

/** 組織群組（ADR-0049）：管理者佈建的部門群／公告頻道。 */
export interface OrgGroup {
  id: string;
  name: string;
  members: PubkeyHex[];
  /** 公告頻道：僅管理者可發文、成員唯讀。 */
  announce?: boolean;
}

/** 組織名冊文件（簽章事件的 content JSON）。 */
export interface OrgRosterDoc {
  org: string;
  members: OrgMember[];
  /** 集中政策（可選，ADR-0048）。 */
  policy?: OrgPolicy;
  /** 組織群組（可選，ADR-0049）。 */
  groups?: OrgGroup[];
  /** 發佈時間（unix 秒）；用於「較新才取代」。 */
  updatedAt: number;
}

/** 從任意值解析組織群組（僅保留合法項）；無有效群組回傳 undefined。 */
function parseGroups(value: unknown): OrgGroup[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OrgGroup[] = [];
  for (const g of value) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string" || !Array.isArray(o.members)) continue;
    const members = o.members.filter((m): m is string => typeof m === "string");
    out.push({ id: o.id, name: o.name, members, ...(o.announce === true ? { announce: true } : {}) });
  }
  return out.length > 0 ? out : undefined;
}

/** 從任意值解析政策（僅保留布林旗標）；無有效旗標回傳 undefined。 */
function parsePolicy(value: unknown): OrgPolicy | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const p: OrgPolicy = {};
  if (v.disableFiles === true) p.disableFiles = true;
  if (v.disableCalls === true) p.disableCalls = true;
  if (v.disableStickers === true) p.disableStickers = true;
  if (v.forceTurn === true) p.forceTurn = true;
  return Object.keys(p).length > 0 ? p : undefined;
}

/** 採用名冊所需的最小成員數（防自動化腳本清空）。 */
export const MIN_ROSTER = 1;

/** 以 pubkey 去重成員（保留首次出現）。 */
function dedupeMembers(members: OrgMember[]): OrgMember[] {
  const seen = new Set<string>();
  const out: OrgMember[] = [];
  for (const m of members) {
    if (!seen.has(m.pubkey)) {
      seen.add(m.pubkey);
      out.push(m.relayUrl ? { pubkey: m.pubkey, name: m.name, relayUrl: m.relayUrl } : { pubkey: m.pubkey, name: m.name });
    }
  }
  return out;
}

/** 建立並簽章一份組織名冊事件（管理者金鑰）。 */
export function signOrgRoster(doc: OrgRosterDoc, adminSk: SecretKey): NostrEvent {
  const members = dedupeMembers(doc.members);
  const policy = parsePolicy(doc.policy);
  const groups = parseGroups(doc.groups);
  return finalizeEvent(
    {
      kind: ORG_ROSTER_KIND,
      created_at: doc.updatedAt,
      tags: [],
      content: JSON.stringify({
        org: doc.org,
        members,
        ...(policy ? { policy } : {}),
        ...(groups ? { groups } : {}),
        updatedAt: doc.updatedAt,
      }),
    },
    adminSk,
  );
}

/**
 * 驗證名冊事件並取出文件；任一條件不符回傳 null：
 * kind 不符、作者非指定管理者、簽章無效、內容非法、成員數不足。
 */
export function verifyOrgRoster(event: NostrEvent, adminPubkey: PubkeyHex): OrgRosterDoc | null {
  if (event.kind !== ORG_ROSTER_KIND) return null;
  if (event.pubkey !== adminPubkey) return null;
  if (!verifyEvent(event)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as Partial<OrgRosterDoc>;
  if (typeof doc.org !== "string" || typeof doc.updatedAt !== "number" || !Array.isArray(doc.members)) return null;
  const members = dedupeMembers(
    doc.members.filter(
      (m): m is OrgMember =>
        !!m &&
        typeof m === "object" &&
        typeof (m as OrgMember).pubkey === "string" &&
        typeof (m as OrgMember).name === "string" &&
        ((m as OrgMember).relayUrl === undefined || typeof (m as OrgMember).relayUrl === "string"),
    ),
  );
  if (members.length < MIN_ROSTER) return null;
  const policy = parsePolicy(doc.policy);
  const groups = parseGroups(doc.groups);
  return { org: doc.org, members, ...(policy ? { policy } : {}), ...(groups ? { groups } : {}), updatedAt: doc.updatedAt };
}

/** 僅當候選較新（updatedAt 更大）且成員數達標時取代目前 last-known-good。 */
export function shouldAdoptRoster(current: OrgRosterDoc | null, candidate: OrgRosterDoc): boolean {
  if (candidate.members.length < MIN_ROSTER) return false;
  if (!current) return true;
  return candidate.updatedAt > current.updatedAt;
}

/** 取出成員 pubkey 陣列，供 relay `allowedAuthors` 佈建（單一真實來源）。 */
export function rosterAllowlist(doc: OrgRosterDoc): PubkeyHex[] {
  return doc.members.map((m) => m.pubkey);
}

/**
 * 名冊變更差異（供客戶端同步聯絡人）：相對前一份名冊，`toAdd` 為新成員、
 * `toRemove` 為離職者的 pubkey；皆排除自己（self）。
 */
export function diffRoster(
  prev: OrgRosterDoc | null,
  next: OrgRosterDoc,
  self: PubkeyHex,
): { toAdd: OrgMember[]; toRemove: PubkeyHex[] } {
  const prevKeys = new Set((prev?.members ?? []).map((m) => m.pubkey));
  const nextKeys = new Set(next.members.map((m) => m.pubkey));
  const toAdd = next.members.filter((m) => m.pubkey !== self && !prevKeys.has(m.pubkey));
  const toRemove = [...prevKeys].filter((pk) => pk !== self && !nextKeys.has(pk));
  return { toAdd, toRemove };
}
