import {
  advanceReceipt,
  type AppStorage,
  THUMB_MAX_BYTES,
  MESSAGE_STATUS_RANK,
  type MessageStatus,
  type StoredBootstrapList,
  type StoredContact,
  type StoredGroup,
  type StoredIdentity,
  type StoredMessage,
  type StoredReaction,
} from "./types.js";

/** localStorage 配額已滿的回呼（ADR-0094）：讓 UI 能在無上限保留撞到配額時提醒使用者。 */
let quotaHandler: ((key: string) => void) | undefined;
export function onStorageQuota(fn: ((key: string) => void) | undefined): void {
  quotaHandler = fn;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 配額爆掉不再靜默：至少回報（審查 P0-1）。無上限保留（ADR-0094）下更可能發生 → 另通知 UI。
    const quota = e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
    console.warn(quota ? `[storage] localStorage 配額已滿，寫入 ${key} 失敗（資料可能未保存）` : e);
    if (quota) quotaHandler?.(key);
  }
}

/**
 * localStorage 儲存。身分/聯絡人/訊息以 JSON 存放。
 *
 * 多身分（ADR-0045）：以 `namespace`（通常為 pubkey）隔離各身分資料。
 * 空 namespace＝既有單一身分的舊鍵（`nb.<suffix>`，向後相容）；
 * 具名 namespace＝`nb.<namespace>.<suffix>`，各身分互不交雜。
 * 之後 Tauri 版以相同 {@link AppStorage} 介面換成原生 SQLite。
 */
export class LocalStorage implements AppStorage {
  private readonly prefix: string;
  /** 每對話持久化上限（ADR-0094）；`0`＝無上限（預設，不逐出）。 */
  private maxPerConvo: number;
  constructor(namespace = "", maxPerConvo = 0) {
    this.prefix = namespace ? `nb.${namespace}.` : "nb.";
    this.maxPerConvo = Math.max(0, Math.floor(maxPerConvo));
  }
  private k(suffix: string): string {
    return this.prefix + suffix;
  }

  /** 每對話保留上限（ADR-0094）：`0`＝無上限。變更後即時對所有對話套用逐出。 */
  setMaxPerConvo(max: number): void {
    this.maxPerConvo = Math.max(0, Math.floor(max));
    if (this.maxPerConvo <= 0) return;
    for (const c of this.loadContacts()) this.capKey("msgs." + c.pubkey);
    for (const g of this.loadGroups()) this.capKey("msgs." + g.id);
  }
  /** 依上限逐出某對話最舊並寫回（僅在有限模式且確實超量時寫）。 */
  private capKey(suffix: string): void {
    const list = read<StoredMessage[]>(this.k(suffix), []);
    if (this.maxPerConvo > 0 && list.length > this.maxPerConvo) {
      list.splice(0, list.length - this.maxPerConvo);
      write(this.k(suffix), list);
    }
  }
  /** 依上限逐出最舊（`0`＝無上限、不動）。 */
  private cap(list: StoredMessage[]): void {
    if (this.maxPerConvo > 0 && list.length > this.maxPerConvo) {
      list.splice(0, list.length - this.maxPerConvo);
    }
  }

  loadIdentity(): StoredIdentity | null {
    return read<StoredIdentity | null>(this.k("identity"), null);
  }
  saveIdentity(identity: StoredIdentity): void {
    write(this.k("identity"), identity);
  }
  loadContacts(): StoredContact[] {
    return read<StoredContact[]>(this.k("contacts"), []);
  }
  addContact(contact: StoredContact): void {
    const contacts = this.loadContacts();
    if (contacts.some((c) => c.pubkey === contact.pubkey)) return;
    contacts.push(contact);
    write(this.k("contacts"), contacts);
  }
  updateContactRelay(pubkey: string, relayUrl: string | undefined): void {
    write(
      this.k("contacts"),
      this.loadContacts().map((c) => {
        if (c.pubkey !== pubkey) return c;
        const { relayUrl: _drop, ...rest } = c;
        return relayUrl ? { ...rest, relayUrl } : rest;
      }),
    );
  }
  updateContactName(pubkey: string, name: string): void {
    write(this.k("contacts"), this.loadContacts().map((c) => (c.pubkey === pubkey ? { ...c, name } : c)));
  }
  removeContact(pubkey: string): void {
    const ids = new Set(this.loadMessages(pubkey).map((m) => m.id));
    write(this.k("contacts"), this.loadContacts().filter((c) => c.pubkey !== pubkey));
    try {
      localStorage.removeItem(this.k("msgs." + pubkey));
    } catch {
      /* 忽略 */
    }
    this.pruneOrphans(ids); // 清理該對話訊息的孤兒 reactions/deleted（審查 P1-5）
  }
  /** 移除一組 messageId 對應的孤兒回應與已收回標記（避免全域清單無限累積）。 */
  private pruneOrphans(messageIds: Set<string>): void {
    if (messageIds.size === 0) return;
    write(this.k("reactions"), this.loadReactions().filter((r) => !messageIds.has(r.messageId)));
    write(this.k("deleted"), this.loadDeleted().filter((id) => !messageIds.has(id)));
  }
  remapContact(from: string, to: string): void {
    if (from === to) return;
    const moved = this.loadMessages(from).map((m) => ({ ...m, contact: to }));
    if (moved.length > 0) {
      const dest = this.loadMessages(to);
      const seen = new Set(dest.map((m) => m.id));
      for (const m of moved) if (!seen.has(m.id)) dest.push(m);
      dest.sort((a, b) => a.at - b.at);
      this.cap(dest); // ADR-0094：有限模式逐出；預設無上限不動
      write(this.k("msgs." + to), dest);
    }
    try {
      localStorage.removeItem(this.k("msgs." + from));
    } catch {
      /* 忽略 */
    }
    const groups = this.loadGroups().map((g) =>
      g.members.includes(from) ? { ...g, members: [...new Set(g.members.map((p) => (p === from ? to : p)))] } : g,
    );
    write(this.k("groups"), groups);
    // 群訊發送者標籤 remap（ADR-0052）：群組歷史中舊 npub 的 sender 改寫為新 npub。
    for (const g of groups) {
      const list = this.loadMessages(g.id);
      let changed = false;
      const rewritten = list.map((m) => {
        if (m.sender !== from) return m;
        changed = true;
        return { ...m, sender: to };
      });
      if (changed) write(this.k("msgs." + g.id), rewritten);
    }
    write(this.k("contacts"), this.loadContacts().filter((c) => c.pubkey !== from));
  }
  blockContact(contact: StoredContact): void {
    this.removeContact(contact.pubkey);
    const blocked = this.loadBlocked();
    if (blocked.some((b) => b.pubkey === contact.pubkey)) return;
    blocked.push(contact);
    write(this.k("blocked"), blocked);
  }
  unblockContact(pubkey: string): void {
    write(this.k("blocked"), this.loadBlocked().filter((b) => b.pubkey !== pubkey));
  }
  loadBlocked(): StoredContact[] {
    return read<StoredContact[]>(this.k("blocked"), []);
  }
  loadMessages(contactPubkey: string): StoredMessage[] {
    return read<StoredMessage[]>(this.k("msgs." + contactPubkey), []);
  }
  appendMessage(message: StoredMessage): void {
    const list = this.loadMessages(message.contact);
    if (list.some((m) => m.id === message.id)) return;
    list.push(message);
    this.cap(list); // ADR-0094：有限模式逐出最舊；預設無上限不動
    write(this.k("msgs." + message.contact), list);
  }
  setMessageStatus(contactPubkey: string, messageId: string, status: MessageStatus): void {
    const list = this.loadMessages(contactPubkey);
    const msg = list.find((m) => m.id === messageId);
    if (!msg) return;
    if (MESSAGE_STATUS_RANK[status] <= MESSAGE_STATUS_RANK[msg.status ?? "sending"]) return; // 只前進
    msg.status = status;
    write(this.k("msgs." + contactPubkey), list);
  }
  setFileSavedPath(contactPubkey: string, messageId: string, savedPath: string): void {
    const list = this.loadMessages(contactPubkey);
    const msg = list.find((m) => m.id === messageId);
    if (!msg?.file) return;
    msg.file = { ...msg.file, savedPath };
    write(this.k("msgs." + contactPubkey), list);
  }
  setFileThumb(contactPubkey: string, messageId: string, thumb: string): void {
    if (thumb.length > THUMB_MAX_BYTES) return; // 超上限寧可不存
    const list = this.loadMessages(contactPubkey);
    const msg = list.find((m) => m.id === messageId);
    if (!msg?.file) return;
    msg.file = { ...msg.file, thumb };
    write(this.k("msgs." + contactPubkey), list);
  }
  setMessageReceipt(
    convoKey: string,
    messageId: string,
    member: string,
    type: "delivered" | "read",
  ): Record<string, "delivered" | "read"> | undefined {
    const list = this.loadMessages(convoKey);
    const msg = list.find((m) => m.id === messageId);
    if (!msg) return undefined;
    const next = advanceReceipt(msg.receipts, member, type);
    if (!next) return undefined;
    msg.receipts = next;
    write(this.k("msgs." + convoKey), list);
    return { ...next };
  }
  loadReactions(): StoredReaction[] {
    return read<StoredReaction[]>(this.k("reactions"), []);
  }
  addReaction(reaction: StoredReaction): void {
    const list = this.loadReactions();
    if (list.some((r) => r.id === reaction.id)) return;
    list.push(reaction);
    write(this.k("reactions"), list);
  }
  markDeleted(messageId: string): void {
    const list = this.loadDeleted();
    if (list.includes(messageId)) return;
    list.push(messageId);
    write(this.k("deleted"), list);
  }
  loadDeleted(): string[] {
    return read<string[]>(this.k("deleted"), []);
  }
  loadReadAt(): Record<string, number> {
    return read<Record<string, number>>(this.k("readAt"), {});
  }
  /** 推進已讀水位（ADR-0108）：單調遞增，倒退忽略。 */
  setReadAt(convoKey: string, at: number): void {
    const all = this.loadReadAt();
    if (at <= (all[convoKey] ?? 0)) return;
    all[convoKey] = at;
    write(this.k("readAt"), all);
  }
  loadGroups(): StoredGroup[] {
    return read<StoredGroup[]>(this.k("groups"), []);
  }
  saveGroup(group: StoredGroup): void {
    const list = this.loadGroups().filter((g) => g.id !== group.id);
    list.push(group);
    write(this.k("groups"), list);
  }
  removeGroup(id: string): void {
    const ids = new Set(this.loadMessages(id).map((m) => m.id));
    write(this.k("groups"), this.loadGroups().filter((g) => g.id !== id));
    try {
      localStorage.removeItem(this.k("msgs." + id));
    } catch {
      /* 忽略 */
    }
    this.pruneOrphans(ids); // 審查 P1-5
  }
  loadBootstrapList(): StoredBootstrapList | null {
    return read<StoredBootstrapList | null>(this.k("bootstrapList"), null);
  }
  saveBootstrapList(doc: StoredBootstrapList): void {
    write(this.k("bootstrapList"), doc);
  }
}
