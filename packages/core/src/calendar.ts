// 共享行程（ADR-0259）：私密的群組/1:1 約時間，**不是** NIP-52 相容實作。
//
// ## 借形狀，不借傳輸
//
// NIP-52 的欄位（`title`／`start`／`end`／`location`）直接沿用——照抄一個想清楚過的資料形狀
// 沒有壞處。但**傳輸完全不同**：NIP-52 是可尋址的公開事件，`p` tag 是參與者、`location`／
// geohash 是地點，而它的 RSVP（kind 31925）帶 `a`＋`p`＝**一條公開的社交圖譜邊**。那正是本專案
// 用 Gift Wrap 承擔全部複雜度去藏的東西。
//
// 故行程是 **app 內部 rumor kind，包進既有的 kind 1059 管線**（同 `GROUP_CONTROL`／`RECEIPT`）：
// 中繼看不出這是行事曆、讀不到任何欄位，外層與一則聊天訊息完全一樣。
//
// ## 主揪權威（ADR-0259 §1.7）
//
// **只有建立者能改時間/地點/取消**；其他人手上的是複本。編輯＝一個帶 `["e", 原行程 id]` 的新
// rumor（沿用 ADR-0012 收回/編輯的模式），**不是**多人共同編輯。
//
// 否決「任何人可編輯」的理由值得記住：ADR-0242 雖有現成的 CRDT 機具（per-field LWW＋墓碑），
// 但它是為**同一身分的多裝置**設計的。推到多使用者會帶出它從不必解的問題——**多使用者的 LWW
// ＝時鐘最快的人贏，而 `created_at` 是自報的**。對多裝置良性（都是你自己），對多使用者是真的
// 攻擊面。
//
// ## 行程 id ＝ rumor.id
//
// 群組扇出時每位成員各收到一份 wrap，但 **rumor 對每位收件人完全相同 → 雜湊相同**，故
// `rumor.id` 是跨成員一致且可驗證的行程識別（ADR-0095 為群訊回條釘死的同一性質）。
// **RSVP 必須指向一個所有人都同意的 id，這個前提已經由 ADR-0095 提供。**

import { KIND } from "./constants.js";
import { getEventHash, type NostrEvent } from "./event.js";
import type { WrappedMessage } from "./giftwrap.js";
import type { Group } from "./group.js";
import { getPublicKey, type PubkeyHex, type SecretKey } from "./keys.js";
import type { Rumor, RumorInput } from "./nip59.js";
import { sealAndWrap } from "./nip59.js";

const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/** 行程的生命週期動作。`create` 不帶 `e` tag（它自己的 id 就是行程 id）。 */
export type CalendarAction = "create" | "update" | "cancel";

/** RSVP 狀態（沿用 NIP-52 的三值）。 */
export type RsvpStatus = "accepted" | "declined" | "tentative";

/** 一個行程的內容欄位（形狀借自 NIP-52）。 */
export interface CalendarEventInput {
  title: string;
  /** 開始時間（unix 秒）。 */
  start: number;
  /** 結束時間（unix 秒）；省略＝無明確結束。 */
  end?: number;
  /** 地點（自由文字；**永遠在密文內層**）。 */
  location?: string;
  /** 補充說明（進 rumor content）。 */
  description?: string;
}

/** 解析出的行程（含身分與歸屬）。 */
export interface CalendarEvent extends CalendarEventInput {
  /** 行程 id：`create` ＝該 rumor 自己的 id；`update`／`cancel` ＝它指向的原 id。 */
  id: string;
  action: CalendarAction;
  /** 所屬群組；1:1 行程為 undefined。 */
  groupId?: string;
  /** 建立/修改者（＝rumor 作者；權威判定用）。 */
  organizer: PubkeyHex;
  /** 這一則的時間（unix 秒）——同一行程的多則修改以此排序。 */
  updatedAt: number;
}

/** 解析出的 RSVP。 */
export interface CalendarRsvp {
  /** 目標行程 id。 */
  eventId: string;
  status: RsvpStatus;
  groupId?: string;
  /** 回覆者（＝rumor 作者）。 */
  by: PubkeyHex;
  updatedAt: number;
}

/**
 * RSVP 廣播上限（含）：成員數 ≤ 此值時 RSVP 送給**全體參與者**（大家看得到誰要來）；
 * 超過就**只送主揪**。
 *
 * ## 為什麼需要這個閘
 *
 * RSVP 的形狀不是群訊，是**群組回條**——每位成員都回應同一則事件。ADR-0095 量測過這個形狀：
 * 「全網回條 **≈ r·N²**、每裝置收件 ≈ r·N」，並因此把群組回條依成員數分級，理由是
 * 「N² 成本與收件箱膨脹在大群失控」。
 *
 * RSVP 與之結構完全相同，只是語意從「已讀」換成「參加/不參加」。差別在**「不送」不是選項**
 * ——邀請本來就是要人回覆的。所以這裡調的是**送給誰**（fan-out 寬度），不是送不送：
 *
 * - ≤10 人：RSVP 給全體 → 每輪 O(N²)，但 N 小，絕對量可接受（10 人 ≈ 100 顆事件）。
 * - \>10 人：只送主揪 → 每輪降回 **O(N)**。其他人看不到即時名單（由主揪自行轉達）。
 *
 * 取 10 與 ADR-0095 的 `GROUP_RECEIPT_COUNT_MAX` 同值並非巧合：那份分析的三條 knee
 * （名單可讀性、收件箱膨脹、N² 全網量）都落在 ~10–15，此處沿用其保守值。
 */
export const CALENDAR_RSVP_BROADCAST_MAX = 10;

/**
 * 這則 RSVP 該送給誰（ADR-0259 §1.4）。
 *
 * `members` 為群組全體（含自己與主揪）；1:1 請直接傳 `[對方, 自己]`。回傳**不含自己**
 * ——自己那份由 `selfCopy` 負責（ADR-0107 多裝置），不從這裡重複。
 */
export function rsvpAudience(members: PubkeyHex[], organizer: PubkeyHex, self: PubkeyHex): PubkeyHex[] {
  const audience = members.length <= CALENDAR_RSVP_BROADCAST_MAX ? members : [organizer];
  // 去重＋排除自己：主揪自己回覆時 `[organizer]` 會等於自己，結果為空（只留 selfCopy）。
  return [...new Set(audience)].filter((pk) => pk !== self);
}

/** 組出行程 rumor 的 tags（形狀借自 NIP-52）。 */
function eventTags(
  input: CalendarEventInput,
  action: CalendarAction,
  opts: { eventId?: string; groupId?: string; to?: PubkeyHex },
): string[][] {
  return [
    // `create` 沒有 `e`——它自己的 rumor.id 就是行程 id。
    ...(action !== "create" && opts.eventId ? [["e", opts.eventId]] : []),
    ["action", action],
    ["title", input.title],
    ["start", String(input.start)],
    ...(input.end !== undefined ? [["end", String(input.end)]] : []),
    ...(input.location ? [["location", input.location]] : []),
    ...(opts.groupId ? [["g", opts.groupId]] : []),
    // 1:1 的對話歸屬鍵（與訊息一致，供自封副本判斷這是「我發給誰的」）。
    ...(opts.to ? [["to", opts.to]] : []),
  ];
}

/** 對一組收件人扇出同一個 rumor；回傳跨成員一致的 `id`、各收件人的 wrap 與自封副本。 */
function fanOut(
  input: RumorInput,
  senderSk: SecretKey,
  senderPk: PubkeyHex,
  recipients: PubkeyHex[],
  expiration?: number,
): WrappedMessage {
  const id = getEventHash({ ...input, pubkey: senderPk });
  const outerExpiration = expiration ?? input.created_at + DEFAULT_TTL_SECONDS;
  const wrapFor = (pk: PubkeyHex): NostrEvent =>
    sealAndWrap(input, senderSk, pk, {
      kind: KIND.OFFLINE_DM_GIFT_WRAP,
      tags: [
        ["p", pk],
        ["expiration", String(outerExpiration)],
      ],
    });
  return {
    id,
    events: [...new Set(recipients)].filter((pk) => pk !== senderPk).map(wrapFor),
    selfCopy: wrapFor(senderPk),
  };
}

/**
 * 1:1 行程邀請。回傳的 `id` 即**行程 id**（`create` 時），後續的更新/取消/RSVP 都指向它。
 */
export function wrapCalendarEvent(
  input: CalendarEventInput,
  senderSk: SecretKey,
  recipientPk: PubkeyHex,
  opts: {
    now?: number;
    action?: CalendarAction;
    eventId?: string;
    expiration?: number;
    /**
     * **補送群組行程給單一成員時必填**（ADR-0260 §9）。
     *
     * 行程 id ＝ rumor 的雜湊，而 rumor 的 tags 含 `g`（群組）或 `to`（1:1）——**形狀不同就是
     * 不同的雜湊**。補送時若用 1:1 的形狀重包一份群組行程，收件人會得到一個**新 id 的重複行程**，
     * 而且原本的 RSVP 全對不回去。給了 `groupId` 就照群組形狀重建，id 與原件一致。
     */
    groupId?: string;
  } = {},
): WrappedMessage {
  const senderPk = getPublicKey(senderSk);
  const action = opts.action ?? "create";
  const rumor: RumorInput = {
    kind: KIND.CALENDAR_EVENT,
    created_at: opts.now ?? Math.floor(Date.now() / 1000),
    tags: eventTags(input, action, {
      // 群組形狀不帶 `to`；1:1 才帶（與 `wrapGroupCalendarEvent` 產出的 rumor 逐位元組相同）。
      ...(opts.groupId ? { groupId: opts.groupId } : { to: recipientPk }),
      ...(opts.eventId ? { eventId: opts.eventId } : {}),
    }),
    content: input.description ?? "",
  };
  return fanOut(rumor, senderSk, senderPk, [recipientPk], opts.expiration);
}

/** 群組行程邀請：對每位其他成員各一份 wrap，`id` 跨成員一致（ADR-0095）。 */
export function wrapGroupCalendarEvent(
  input: CalendarEventInput,
  senderSk: SecretKey,
  group: Group,
  opts: { now?: number; action?: CalendarAction; eventId?: string; expiration?: number } = {},
): WrappedMessage {
  const senderPk = getPublicKey(senderSk);
  const action = opts.action ?? "create";
  const rumor: RumorInput = {
    kind: KIND.CALENDAR_EVENT,
    created_at: opts.now ?? Math.floor(Date.now() / 1000),
    tags: eventTags(input, action, { groupId: group.id, ...(opts.eventId ? { eventId: opts.eventId } : {}) }),
    content: input.description ?? "",
  };
  return fanOut(rumor, senderSk, senderPk, group.members, opts.expiration);
}

/**
 * RSVP：對某行程的回覆，由**本人**簽章。
 *
 * `audience` 請以 {@link rsvpAudience} 算出（大群只送主揪，見該函式的說明）。
 */
export function wrapCalendarRsvp(
  eventId: string,
  status: RsvpStatus,
  senderSk: SecretKey,
  audience: PubkeyHex[],
  opts: { now?: number; groupId?: string; expiration?: number } = {},
): WrappedMessage {
  const senderPk = getPublicKey(senderSk);
  const rumor: RumorInput = {
    kind: KIND.CALENDAR_RSVP,
    created_at: opts.now ?? Math.floor(Date.now() / 1000),
    tags: [
      ["e", eventId],
      ["status", status],
      ...(opts.groupId ? [["g", opts.groupId]] : []),
    ],
    content: "",
  };
  return fanOut(rumor, senderSk, senderPk, audience, opts.expiration);
}

/** 取一個 tag 值。 */
const tagOf = (rumor: Rumor, name: string): string | undefined => rumor.tags.find((t) => t[0] === name)?.[1];

/**
 * 解析行程 rumor；非行程或欄位不合法回 undefined。
 *
 * **`create` 的行程 id ＝ `rumor.id` 本身**；`update`／`cancel` 取其 `e` tag 指向的原 id。
 */
export function calendarEventOf(rumor: Rumor): CalendarEvent | undefined {
  if (rumor.kind !== KIND.CALENDAR_EVENT) return undefined;
  const action = tagOf(rumor, "action");
  if (action !== "create" && action !== "update" && action !== "cancel") return undefined;
  const title = tagOf(rumor, "title");
  const start = Number(tagOf(rumor, "start"));
  if (title === undefined || !Number.isFinite(start)) return undefined;
  // create 用自己的 id；update/cancel 必須指名目標，指不出來就不是合法的修改。
  const id = action === "create" ? rumor.id : tagOf(rumor, "e");
  if (!id) return undefined;
  const end = Number(tagOf(rumor, "end"));
  const location = tagOf(rumor, "location");
  const groupId = tagOf(rumor, "g");
  return {
    id,
    action,
    title,
    start,
    ...(Number.isFinite(end) ? { end } : {}),
    ...(location ? { location } : {}),
    ...(rumor.content ? { description: rumor.content } : {}),
    ...(groupId ? { groupId } : {}),
    organizer: rumor.pubkey,
    updatedAt: rumor.created_at,
  };
}

/** 解析 RSVP rumor；非 RSVP 或欄位不合法回 undefined。 */
export function calendarRsvpOf(rumor: Rumor): CalendarRsvp | undefined {
  if (rumor.kind !== KIND.CALENDAR_RSVP) return undefined;
  const eventId = tagOf(rumor, "e");
  const status = tagOf(rumor, "status");
  if (!eventId || (status !== "accepted" && status !== "declined" && status !== "tentative")) return undefined;
  const groupId = tagOf(rumor, "g");
  return {
    eventId,
    status,
    ...(groupId ? { groupId } : {}),
    by: rumor.pubkey,
    updatedAt: rumor.created_at,
  };
}

/**
 * 套用一則行程變更到既有狀態（主揪權威 ＋ 較新才取代）。
 *
 * 回傳新的狀態；`null` ＝此行程已取消（呼叫端據此移除）。**不是主揪發的變更一律忽略**
 * ——這是權威模型的執行點，不是提示。
 */
export function applyCalendarChange(
  existing: CalendarEvent | undefined,
  incoming: CalendarEvent,
): CalendarEvent | null | undefined {
  if (incoming.action === "create") {
    // 重複收到（多裝置/重送）：以較新者為準，但 create 的 id 就是內容雜湊，內容不會變。
    return existing && existing.updatedAt >= incoming.updatedAt ? existing : incoming;
  }
  if (!existing) return undefined; // 沒有原行程可改（尚未收到或已清掉）——不憑空生出一個
  if (incoming.organizer !== existing.organizer) return existing; // 非主揪：忽略（權威）
  if (incoming.updatedAt < existing.updatedAt) return existing; // 較舊：忽略
  if (incoming.action === "cancel") return null;
  return { ...existing, ...incoming, id: existing.id, action: "update" };
}
