// 群組聊天（M9，ADR-0027）：Gift-Wrap 成對扇出 + 帶內群組狀態。
//
// 群訊為既有 kind 14 聊天 rumor 附 `["g", groupId]` tag，對每位其他成員各包一個
// kind 1059 Gift Wrap 送出——對中繼完全不暴露群組與成員（沿用 NIP-17/59 隱私）。
// 成員管理（create/add/remove/leave）為帶內控制訊息（kind 40 rumor），同樣扇出。
// 無共用群組金鑰：移除成員＝下次扇出略過，即時且免 rekey。

import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { KIND } from "./constants.js";
import { getEventHash, type NostrEvent } from "./event.js";
import type { FileMeta, WrappedMessage } from "./giftwrap.js";
import { getPublicKey, type PubkeyHex, type SecretKey } from "./keys.js";
import { mentionTags } from "./mention.js";
import { EK_HINT_TAG } from "./subkey.js";
import type { Rumor, RumorInput } from "./nip59.js";
import { sealAndWrap } from "./nip59.js";
import { alsoMainTag, replyTag } from "./thread.js";

const DAY_SECONDS = 86_400;
const DEFAULT_TTL_SECONDS = 7 * DAY_SECONDS;

/** 一個私密群組。`members` 含所有參與者（包含管理者本人）。 */
export interface Group {
  id: string;
  name: string;
  /** 建立者/管理者公鑰（成員清單變更的權威）。 */
  admin: PubkeyHex;
  members: PubkeyHex[];
  /** 公告頻道（ADR-0049）：僅管理者可發文、成員唯讀。 */
  announce?: boolean;
  /** 組織名冊分發的群（ADR-0049）：由名冊對帳權威管理，客戶端不得手動增/移成員。 */
  org?: boolean;
}

/**
 * 發文授權（ADR-0049）：announce 群僅管理者可發、一般群任何成員可發（皆須為成員）。
 * 接收端與 UI 共用此判準。
 */
export function canPostToGroup(group: Group, sender: PubkeyHex): boolean {
  if (!group.members.includes(sender)) return false;
  return group.announce ? sender === group.admin : true;
}

/** 帶內群組控制訊息。`group-snapshot`（ADR-0068）＝管理員開機廣播的權威快照。 */
export type GroupControl =
  | { type: "group-create"; id: string; name: string; admin: PubkeyHex; members: PubkeyHex[] }
  | { type: "group-snapshot"; id: string; name: string; admin: PubkeyHex; members: PubkeyHex[] }
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

/**
 * 群組送達/已讀回條分級（ADR-0095）。回條是 fan-in 成本：一則群訊每位成員各回一則**儲存型**
 * 回條給發訊者（≈ 每則訊息的中繼事件數翻倍，且積在收件箱 7 天拖慢重連），總量隨 N² 成長；
 * 名單在大群也失去可讀性。故依成員數分級：
 *
 * - `list`（≤5）：名單制——記錄每位成員的送達/已讀，可顯示「誰已讀」。
 * - `count`（6–10）：計數制——同樣收回條，但只顯示「已讀 M/N」，不列名（降低噪音與觀感暴露）。
 * - `off`（>10）：**完全不記**——不送送達、也不送已讀回條，零額外流量。
 */
export type GroupReceiptMode = "list" | "count" | "off";
/** 名單制上限（含）：成員數 ≤ 此值可顯示「誰已讀」。 */
export const GROUP_RECEIPT_LIST_MAX = 5;
/** 計數制上限（含）：成員數 ≤ 此值仍收回條（只顯示數字）；超過即完全不記。 */
export const GROUP_RECEIPT_COUNT_MAX = 10;

/**
 * 群組成員數上限（含自己）——**ADR-0303 A3，2026-07-31 決定**。
 *
 * **為什麼要有**：per-device session 之後，一則群訊的扇出是 **O(N×D)**
 * （N=15、D=5 ⇒ 一則 75 顆 wrap）。而我們**沒有量過中繼的實際負載**
 * ⇒ 在沒有數據的情況下，**先緊後放寬是可逆的，先寬後收緊是拿走使用者已有的東西**。
 *
 * ⚠ **只擋新增，不動既有群。** 舊版沒有上限，既有群可能已超額；
 * 收訊端**不得**用這個上限去拒絕既有群的控制訊息（見 `groupSizeExceeded` 的用法約束）。
 *
 * ⚠ 放寬時請一併重估回條分級（`GROUP_RECEIPT_COUNT_MAX`）與 ADR-0109 的流量預算。
 */
export const GROUP_MEMBERS_MAX = 15;

/**
 * 單一身分的裝置數上限——**ADR-0303 A3，2026-07-31 決定**。
 *
 * ⚠ **目前沒有執行點**：per-device session 與裝置清單（ADR-0303）尚未實作。
 * 這裡先立常數是為了**把決定固定下來**，供日後實作依循——
 * 不是宣稱它已被強制執行。
 *
 * **為什麼是 5 而不是 4**：ADR-0303 §6.5 **刻意**把「移除裝置」設計得很貴
 * （要救援碼＋一台全新裝置）⇒ **緊的上限＋昂貴的移除＝使用者卡死**。
 * 上限必須高到很少撞到：手機＋筆電＋桌機＋平板已經 4 台。
 *
 * ⚠ 另記一個**被推翻的理由**：原以為「裝置越少越容易察覺多一台」是主要論據，
 * 但偵測性來自 **E-lite 的變動警示**（清單 3→4 會警示，11→12 也會），
 * **與數字大小幾乎無關** ⇒ 該論據不成立，真正的理由只剩扇出成本與移除成本的耦合。
 */
export const DEVICE_COUNT_MAX = 5;

/**
 * 群組成員數是否超過上限（`GROUP_MEMBERS_MAX`）。
 *
 * ⚠ **用法約束**：僅用於**擋下新增**（建群、加成員）。
 * **不得**用於拒絕既有群的控制訊息或裁切既有成員——那會是拿走使用者已有的東西。
 */
export function groupSizeExceeded(memberCount: number): boolean {
  return memberCount > GROUP_MEMBERS_MAX;
}

/** 依群組成員數（含自己）決定回條模式。 */
export function groupReceiptMode(memberCount: number): GroupReceiptMode {
  if (memberCount <= GROUP_RECEIPT_LIST_MAX) return "list";
  if (memberCount <= GROUP_RECEIPT_COUNT_MAX) return "count";
  return "off";
}

function others(members: PubkeyHex[], self: PubkeyHex): PubkeyHex[] {
  return members.filter((m) => m !== self);
}

function wrapFor(
  recipientPk: PubkeyHex,
  rumor: { kind: number; content: string; groupId: string; mentions?: PubkeyHex[]; replyTo?: string },
  senderSk: SecretKey,
  nowSec: number,
  relayHint?: string,
): NostrEvent {
  const tags: string[][] = [
    ["g", rumor.groupId],
    ...(relayHint ? [["relay", relayHint]] : []),
    ...(rumor.mentions && rumor.mentions.length > 0 ? mentionTags(rumor.mentions) : []),
    ...(rumor.replyTo ? [replyTag(rumor.replyTo)] : []),
  ];
  return sealAndWrap(
    { kind: rumor.kind, created_at: nowSec, tags, content: rumor.content },
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
 *
 * 回傳的 `id` 是**內層 rumor 的 id**——因為 rumor（kind/時間/tags/內容/作者）對每位收件人
 * 完全相同，其雜湊也相同，故是**跨成員一致**的群訊識別（外層 wrap id 每人不同，不可用）。
 * 收件端由 `openWrap` 取得同一個 rumor.id（並已核對雜湊），雙方才對得起來——送達/已讀回條
 * 與回應/引用都以此為鍵（ADR-0095）。
 *
 * `selfCopy` 是**定址給自己**的那一份（ADR-0107）：群訊原本只扇出給**其他**成員，
 * 於是自己在另一台裝置上看不到自己發的群訊。自封副本補上這個洞；它不計入送出狀態
 * （`events` 才是「送得出去」的判準）。
 */
/**
 * 把一則群組 rumor 扇給每位成員（各一個 Gift Wrap）＋一份自封副本。
 *
 * **群組沒有共用金鑰**（ADR-0027：NIP-17 的固有代價）——所以「送給群組」在協定層根本不存在，
 * 只有「分別送給每一位成員」。任何以 `convo` 為參數的送出路徑，都必須先問「這是群組嗎」。
 * （這個 bug 已經以同一個形狀出現過三次：ADR-0114 送訊、0119 回應/收回、0124 傳檔。）
 *
 * rumor **只建一次**（與收件人無關）→ `rumor.id` 跨成員一致 → 回條（ADR-0095）與自封副本
 * （ADR-0107）才對得回同一則訊息。
 */
function fanOutGroupRumor(
  input: RumorInput,
  senderSk: SecretKey,
  senderPk: PubkeyHex,
  group: Group,
  /** 外層過期（unix 秒；ADR-0160 組織保留政策可覆寫）；省略＝created_at＋7 天。 */
  expiration?: number,
  /**
   * FS retarget（ADR-0320）：身分 pk → 其 EK；**逐位成員各自決定**，不知道就退回身分。
   * 同一則群訊因此可能「部分成員有 FS、部分沒有」——那不是失敗，是盡力而為。
   *
   * ⚠ **`input` 不得因此改變**（同 ADR-0318）：`rumor.id` 是跨成員一致的群訊識別，
   * 回條與引用都以它為鍵（ADR-0095）。1:1 那套「在 rumor 內嵌 ek hint」在這裡會讓
   * 每次輪替都產生不同的 id。
   */
  encryptToFor?: (identityPk: PubkeyHex) => PubkeyHex,
  /**
   * 我的當前 EK（ADR-0326）：夾在 **seal 層** tags 裡，讓收件人學到我的 EK。
   *
   * 🔴 **為什麼是 seal 而不是 rumor**：`rumor.id` 是跨成員一致的群訊識別碼（回條與引用的鍵），
   * 而 EK 每 7 天輪替 ⇒ 放進 rumor 會讓同一則訊息在不同時間得到不同 id（ADR-0318 已否決）。
   * seal 是**逐收件人**的一層、加密在 wrap 內，改它既不動 id 也不對中繼多洩漏任何東西。
   */
  myEk?: PubkeyHex,
): WrappedMessage {
  const id = getEventHash({ ...input, pubkey: getPublicKey(senderSk) });
  const outerExpiration = expiration ?? input.created_at + DEFAULT_TTL_SECONDS;
  const encryptTo = encryptToFor ?? ((pk: PubkeyHex) => pk);
  const sealTags = myEk ? [[EK_HINT_TAG, myEk]] : [];
  const wrapFor = (pk: PubkeyHex): NostrEvent =>
    sealAndWrap(
      input,
      senderSk,
      encryptTo(pk),
      {
        kind: KIND.OFFLINE_DM_GIFT_WRAP,
        tags: [
          ["p", pk],
          ["expiration", String(outerExpiration)],
        ],
      },
      sealTags,
    );
  return { id, events: others(group.members, senderPk).map(wrapFor), selfCopy: wrapFor(senderPk) };
}

export function wrapGroupMessage(
  text: string,
  senderSk: SecretKey,
  senderPk: PubkeyHex,
  group: Group,
  opts: {
    now?: number;
    relayHint?: string;
    mentions?: PubkeyHex[];
    replyTo?: string;
    alsoMain?: boolean;
    expiration?: number;
    /** FS retarget（ADR-0320）：身分 pk → 其 EK；逐位成員決定，不知道就退回身分。 */
    encryptToFor?: (identityPk: PubkeyHex) => PubkeyHex;
    /** 我的當前 EK（ADR-0326）：夾在 seal 層讓收件人學到，不動 `rumor.id`。 */
    myEk?: PubkeyHex;
  } = {},
): WrappedMessage {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const input: RumorInput = {
    kind: KIND.CHAT,
    created_at: nowSec,
    tags: [
      ["g", group.id],
      ...(opts.relayHint ? [["relay", opts.relayHint]] : []),
      ...(opts.mentions && opts.mentions.length > 0 ? mentionTags(opts.mentions) : []),
      ...(opts.replyTo ? [replyTag(opts.replyTo)] : []),
      ...(opts.replyTo && opts.alsoMain ? [alsoMainTag()] : []),
    ],
    content: text,
  };
  return fanOutGroupRumor(input, senderSk, senderPk, group, opts.expiration, opts.encryptToFor, opts.myEk);
}

/**
 * 群組檔案訊息（ADR-0124）：只帶 **metadata**（名稱/大小/類型/tid），**位元組另走 P2P**
 * ——明文不上中繼（ADR-0093 的分工）。
 *
 * 與 1:1 的 `wrapFileMessage()` 差別只在：對話鍵是 `g` tag（群組）而不是 `to` tag（收件人）。
 */
export function wrapGroupFile(
  meta: FileMeta,
  senderSk: SecretKey,
  senderPk: PubkeyHex,
  group: Group,
  opts: {
    now?: number;
    relayHint?: string;
    expiration?: number;
    /** FS retarget（ADR-0320）：檔名/大小/類型與 1:1 同樣敏感（ADR-0318）。 */
    encryptToFor?: (identityPk: PubkeyHex) => PubkeyHex;
    /** 我的當前 EK（ADR-0326）：夾在 seal 層讓收件人學到，不動 `rumor.id`。 */
    myEk?: PubkeyHex;
  } = {},
): WrappedMessage {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const input: RumorInput = {
    kind: KIND.CHAT,
    created_at: nowSec,
    tags: [
      ["g", group.id],
      ["file", meta.tid, meta.name, String(meta.size), meta.mime],
      ...(opts.relayHint ? [["relay", opts.relayHint]] : []),
    ],
    content: "",
  };
  return fanOutGroupRumor(input, senderSk, senderPk, group, opts.expiration, opts.encryptToFor, opts.myEk);
}

/** 將群組控制訊息扇出給指定收件人（各一個 Gift Wrap）。 */
export function wrapGroupControl(
  control: GroupControl,
  senderSk: SecretKey,
  recipients: PubkeyHex[],
  opts: { now?: number; relayHint?: string } = {},
): NostrEvent[] {
  const nowSec = opts.now ?? Math.floor(Date.now() / 1000);
  const content = JSON.stringify(control);
  return recipients.map((pk) =>
    wrapFor(pk, { kind: KIND.GROUP_CONTROL, content, groupId: control.id }, senderSk, nowSec, opts.relayHint),
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
    case "group-create":
    case "group-snapshot": {
      if (typeof s.name !== "string" || typeof s.admin !== "string") return null;
      if (!Array.isArray(s.members) || !s.members.every((m) => typeof m === "string")) return null;
      return { type: s.type, id, name: s.name, admin: s.admin, members: s.members as PubkeyHex[] };
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
      // 僅管理者可新增成員（維護成員清單完整性）。
      if (from !== group.admin) return group;
      if (group.members.includes(control.member)) return group;
      return { ...group, members: [...group.members, control.member] };
    case "group-remove":
      // 僅管理者可移除他人（離開自己則走 group-leave）。
      if (from !== group.admin) return group;
      return { ...group, members: group.members.filter((m) => m !== control.member) };
    case "group-leave":
      return { ...group, members: group.members.filter((m) => m !== from) };
    case "group-snapshot":
      // 管理員權威快照（ADR-0068）：名稱/成員以快照為準；非管理者偽造與組織群（名冊權威）不動。
      if (from !== group.admin || group.org) return group;
      return { ...group, name: control.name, members: [...control.members] };
    case "group-create":
      return group;
  }
}
