// 群組聊天（M9，ADR-0027）：Gift-Wrap 成對扇出 + 帶內群組狀態。
//
// 群訊為既有 kind 14 聊天 rumor 附 `["g", groupId]` tag，對每位其他成員各包一個
// kind 1059 Gift Wrap 送出——對中繼完全不暴露群組與成員（沿用 NIP-17/59 隱私）。
// 成員管理（create/add/remove/leave）為帶內控制訊息（kind 40 rumor），同樣扇出。
// 無共用群組金鑰：移除成員＝下次扇出略過，即時且免 rekey。

import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { KIND } from "./constants.js";
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import type { Rumor } from "./nip59.js";
import { sealAndWrap } from "./nip59.js";

const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/** 一個私密群組。`members` 含所有參與者（包含管理者本人）。 */
export interface Group {
  id: string;
  name: string;
  /** 建立者/管理者公鑰（成員清單變更的權威）。 */
  admin: PubkeyHex;
  members: PubkeyHex[];
}

/** 帶內群組控制訊息。 */
export type GroupControl =
  | { type: "group-create"; id: string; name: string; admin: PubkeyHex; members: PubkeyHex[] }
  | { type: "group-add"; id: string; member: PubkeyHex }
  | { type: "group-remove"; id: string; member: PubkeyHex }
  | { type: "group-leave"; id: string };

/** 產生高熵一次性 groupId（32 hex，僅成員得知）。 */
export function newGroupId(): string {
  return bytesToHex(randomBytes(16));
}

/** 讀出 rumor 的群組 id（`g` tag）；非群組訊息回傳 undefined。 */
export function groupTarget(rumor: Rumor): string | undefined {
  return rumor.tags.find((t) => t[0] === "g")?.[1];
}

function others(members: PubkeyHex[], self: PubkeyHex): PubkeyHex[] {
  return members.filter((m) => m !== self);
}

function wrapFor(
  recipientPk: PubkeyHex,
  rumor: { kind: number; content: string; groupId: string },
  senderSk: SecretKey,
  nowSec: number,
): NostrEvent {
  return sealAndWrap(
    { kind: rumor.kind, created_at: nowSec, tags: [["g", rumor.groupId]], content: rumor.content },
    senderSk,
    recipientPk,
    {
      kind: KIND.OFFLINE_DM_GIFT_WRAP,
      tags: [
        ["p", recipientPk],
        ["expiration", String(nowSec + DEFAULT_TTL_SECONDS)],
      ],
    },
  );
}

/**
 * 將一則群訊扇出為多個 Gift Wrap（每位其他成員一個）。rumor 為 kind 14 + `g` tag。
 * `expiresAt`（unix 秒）設定時為限時群訊（寫入 rumor 內層 NIP-40）。
 */
export function wrapGroupMessage(
  text: string,
  senderSk: SecretKey,
  senderPk: PubkeyHex,
  group: Group,
  opts: { now?: number } = {},
): NostrEvent[] {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  return others(group.members, senderPk).map((pk) =>
    wrapFor(pk, { kind: KIND.CHAT, content: text, groupId: group.id }, senderSk, nowSec),
  );
}

/** 將群組控制訊息扇出給指定收件人（各一個 Gift Wrap）。 */
export function wrapGroupControl(
  control: GroupControl,
  senderSk: SecretKey,
  recipients: PubkeyHex[],
  opts: { now?: number } = {},
): NostrEvent[] {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const content = JSON.stringify(control);
  return recipients.map((pk) =>
    wrapFor(pk, { kind: KIND.GROUP_CONTROL, content, groupId: control.id }, senderSk, nowSec),
  );
}

/** 解析並驗證群組控制訊息（信任邊界檢查）。非法回傳 null。 */
export function parseGroupControl(rumor: Rumor): GroupControl | null {
  if (rumor.kind !== KIND.GROUP_CONTROL) return null;
  let value: unknown;
  try {
    value = JSON.parse(rumor.content);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string" || s.id.length === 0) return null;
  const id = s.id;
  switch (s.type) {
    case "group-create": {
      if (typeof s.name !== "string" || typeof s.admin !== "string") return null;
      if (!Array.isArray(s.members) || !s.members.every((m) => typeof m === "string")) return null;
      return { type: "group-create", id, name: s.name, admin: s.admin, members: s.members as PubkeyHex[] };
    }
    case "group-add":
      if (typeof s.member !== "string") return null;
      return { type: "group-add", id, member: s.member };
    case "group-remove":
      if (typeof s.member !== "string") return null;
      return { type: "group-remove", id, member: s.member };
    case "group-leave":
      return { type: "group-leave", id };
    default:
      return null;
  }
}

/** 依控制訊息更新本機群組狀態（回傳新 Group；`group-leave` 由呼叫端決定是否移除）。 */
export function applyGroupControl(group: Group, control: GroupControl, from: PubkeyHex): Group {
  switch (control.type) {
    case "group-add":
      if (group.members.includes(control.member)) return group;
      return { ...group, members: [...group.members, control.member] };
    case "group-remove":
      // 僅管理者可移除他人（離開自己則走 group-leave）。
      if (from !== group.admin) return group;
      return { ...group, members: group.members.filter((m) => m !== control.member) };
    case "group-leave":
      return { ...group, members: group.members.filter((m) => m !== from) };
    case "group-create":
      return group;
  }
}
