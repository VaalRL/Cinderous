// 加密雲端快照的內容組裝與合併（ADR-0071）。
//
// 三檔模式：關（不發佈）／基本（聯絡人/群組/封鎖）／完整（＋近期訊息，上限內最新者）。
// 合併採交換律語意（同 ADR-0009）：聯絡人/群組補缺不覆蓋（本機活資料優先）、
// 封鎖聯集（安全優先，封鎖者同時移出聯絡人）、訊息以 id 去重補回——
// 多台裝置的快照以任意順序合併，結果一致。

import type { AppStorage, StoredContact, StoredGroup, StoredMessage } from "./types.js";

/** 雲端同步模式（ADR-0071 三檔）。 */
export type CloudSyncMode = "off" | "basic" | "full";

/** 完整模式的訊息上限（近期優先；受 relay 端單顆 256KB 約束的粗預算）。 */
export const SNAPSHOT_MESSAGE_CAP = 500;

/** 快照明文內容（NIP-44 加密前）。 */
export interface CloudSnapshotContent {
  v: 1;
  /** 產生時間（ms）。 */
  at: number;
  /** 產生端的模式（隨快照傳播；合併端於還原時採用）。 */
  mode: Exclude<CloudSyncMode, "off">;
  contacts: StoredContact[];
  groups: StoredGroup[];
  blocked: StoredContact[];
  /** 完整模式才有：近期訊息（跨對話、以 at 新到舊取前 N 則）。 */
  messages?: StoredMessage[];
}

/** 組裝快照內容：基本＝聯絡人/群組/封鎖；完整＝＋近期訊息。 */
export function buildSnapshotContent(
  storage: AppStorage,
  mode: Exclude<CloudSyncMode, "off">,
  opts: { now?: number } = {},
): CloudSnapshotContent {
  const contacts = storage.loadContacts();
  const groups = storage.loadGroups();
  const blocked = storage.loadBlocked();
  const base: CloudSnapshotContent = { v: 1, at: opts.now ?? Date.now(), mode, contacts, groups, blocked };
  if (mode !== "full") return base;
  const all: StoredMessage[] = [];
  for (const key of [...contacts.map((c) => c.pubkey), ...groups.map((g) => g.id)]) {
    all.push(...storage.loadMessages(key));
  }
  all.sort((a, b) => b.at - a.at);
  return { ...base, messages: all.slice(0, SNAPSHOT_MESSAGE_CAP) };
}

/** 解析並驗證快照明文；格式不符回 null。 */
export function parseSnapshotContent(json: string): CloudSnapshotContent | null {
  try {
    const s = JSON.parse(json) as Partial<CloudSnapshotContent>;
    if (s.v !== 1 || (s.mode !== "basic" && s.mode !== "full")) return null;
    if (!Array.isArray(s.contacts) || !Array.isArray(s.groups) || !Array.isArray(s.blocked)) return null;
    if (s.messages !== undefined && !Array.isArray(s.messages)) return null;
    return s as CloudSnapshotContent;
  } catch {
    return null;
  }
}

/**
 * 合併快照進本機儲存（交換律）。回傳有訊息補回的對話鍵（供 UI 重放歷史）；
 * 無任何變更時 `changed` 為 false。
 */
export function mergeSnapshotContent(
  storage: AppStorage,
  content: CloudSnapshotContent,
): { changed: boolean; convos: string[] } {
  let changed = false;
  // 封鎖先行（安全優先）：聯集，且封鎖者不得經快照重新入列聯絡人。
  const blockedSet = new Set(storage.loadBlocked().map((b) => b.pubkey));
  for (const b of content.blocked) {
    if (blockedSet.has(b.pubkey)) continue;
    storage.blockContact(b);
    blockedSet.add(b.pubkey);
    changed = true;
  }
  const have = new Set(storage.loadContacts().map((c) => c.pubkey));
  for (const c of content.contacts) {
    if (have.has(c.pubkey) || blockedSet.has(c.pubkey)) continue;
    storage.addContact(c);
    have.add(c.pubkey);
    changed = true;
  }
  const gids = new Set(storage.loadGroups().map((g) => g.id));
  for (const g of content.groups) {
    if (gids.has(g.id)) continue; // 既有群組不覆蓋（admin 快照/名冊才是對帳權威）
    storage.saveGroup(g);
    gids.add(g.id);
    changed = true;
  }
  const convos: string[] = [];
  if (content.messages) {
    const idsByConvo = new Map<string, Set<string>>();
    const knownIds = (convo: string): Set<string> => {
      let ids = idsByConvo.get(convo);
      if (!ids) {
        ids = new Set(storage.loadMessages(convo).map((m) => m.id));
        idsByConvo.set(convo, ids);
      }
      return ids;
    };
    // 由舊到新補回：還原情境（空機）下寫入順序＝時間順序。
    const sorted = [...content.messages].sort((a, b) => a.at - b.at);
    for (const m of sorted) {
      const ids = knownIds(m.contact);
      if (ids.has(m.id)) continue;
      storage.appendMessage(m);
      ids.add(m.id);
      if (!convos.includes(m.contact)) convos.push(m.contact);
      changed = true;
    }
  }
  return { changed, convos };
}
