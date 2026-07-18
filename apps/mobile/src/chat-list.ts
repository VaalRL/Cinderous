// 行動端聊天清單邏輯（ADR-0085）：聯絡人＋群組合成單一清單、依最近互動排序、帶最後一則
// 訊息預覽與未讀數——LINE/Signal 風格清單所需。純函式、無 UI、可測。
// 概念同桌面 `deck-sidebar.ts`（最近互動排序），但這裡是「聊天列」超集（多帶 lastText/未讀），
// 且不含桌面的標籤/搜尋；日後若要單一化可把 lastInteraction/sort 抽到共用套件。
import type { ChatMessage, Contact, Group, Status } from "@cinderous/engine";
import { contactLabel } from "@cinderous/engine";

export interface ChatListEntry {
  id: string;
  name: string;
  isGroup: boolean;
  /** 群組成員數（群組才有）。 */
  memberCount?: number;
  /** 上線狀態（聯絡人才有）。 */
  status?: Status;
  /** 對方廣播的頭像 data URI（ADR-0154；聯絡人才有，未廣播＝undefined 用生成色圓）。 */
  avatar?: string;
  /** 最後一則訊息預覽（無訊息＝空字串）。 */
  lastText: string;
  /** 最後互動時間（ms epoch；無互動＝0）。 */
  lastAt: number;
  /** 最後一則是否為自己送出（供「你：」前綴）。 */
  lastOutgoing: boolean;
  /** 未讀數。 */
  unread: number;
}

/** 取某對話最後一則訊息（依時間戳最大）；無訊息回 undefined。 */
export function lastMessageOf(msgs: ChatMessage[] | undefined): ChatMessage | undefined {
  if (!msgs || msgs.length === 0) return undefined;
  let latest = msgs[0]!;
  for (const m of msgs) if (m.at > latest.at) latest = m;
  return latest;
}

/** 某訊息的清單預覽文字（檔案顯示 📎 檔名，否則內文）。 */
export function previewText(m: ChatMessage | undefined): string {
  if (!m) return "";
  return m.file ? `📎 ${m.file.name}` : m.text;
}

/** 聯絡人與群組合成聊天清單（帶最後訊息預覽與未讀）。 */
export function buildChatList(
  contacts: Contact[],
  groups: Group[],
  convos: Record<string, ChatMessage[]>,
  unread: Record<string, number>,
): ChatListEntry[] {
  const make = (id: string, name: string, isGroup: boolean, extra: Partial<ChatListEntry>): ChatListEntry => {
    const last = lastMessageOf(convos[id]);
    return {
      id,
      name,
      isGroup,
      lastText: previewText(last),
      lastAt: last?.at ?? 0,
      lastOutgoing: last?.outgoing ?? false,
      unread: unread[id] ?? 0,
      ...extra,
    };
  };
  return [
    ...contacts.map((c) => make(c.pubkey, contactLabel(c), false, { status: c.status, ...(c.avatar ? { avatar: c.avatar } : {}) })), // ADR-0148：暱稱優先；ADR-0154：廣播頭像
    ...groups.map((g) => make(g.id, g.name, true, { memberCount: g.members.length })),
  ];
}

/** 依最近互動排序（新→舊）；無互動者殿後、同分依名稱。不改動輸入。 */
export function sortByRecent(entries: ChatListEntry[]): ChatListEntry[] {
  return [...entries].sort((a, b) => b.lastAt - a.lastAt || a.name.localeCompare(b.name));
}

/** 聊天清單一步到位：合成＋依最近互動排序。 */
export function chatList(
  contacts: Contact[],
  groups: Group[],
  convos: Record<string, ChatMessage[]>,
  unread: Record<string, number>,
): ChatListEntry[] {
  return sortByRecent(buildChatList(contacts, groups, convos, unread));
}

/** 清單用的簡短時間標籤：今日＝HH:MM、昨日＝「昨天」、更早＝M/D；無互動（0）回空字串。 */
export function chatTimeLabel(at: number, now: number): string {
  if (!at) return "";
  const d = new Date(at);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const yesterday = new Date(now - 86_400_000);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return "昨天";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
