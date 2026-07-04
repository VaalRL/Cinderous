import {
  type AppStorage,
  MESSAGES_PER_CONVO,
  type StoredBootstrapList,
  type StoredContact,
  type StoredGroup,
  type StoredIdentity,
  type StoredMessage,
  type StoredReaction,
} from "./types.js";

const K_IDENTITY = "nb.identity";
const K_CONTACTS = "nb.contacts";
const K_MSG_PREFIX = "nb.msgs.";
const K_REACTIONS = "nb.reactions";
const K_DELETED = "nb.deleted";
const K_BLOCKED = "nb.blocked";
const K_GROUPS = "nb.groups";
const K_BOOTSTRAP = "nb.bootstrapList";

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
    // 配額爆掉不再靜默：至少回報（審查 P0-1）。每對話上限已先做逐出以降低發生機率。
    const quota = e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
    console.warn(quota ? `[storage] localStorage 配額已滿，寫入 ${key} 失敗（資料可能未保存）` : e);
  }
}

/**
 * localStorage 儲存（A2 首版）。身分/聯絡人/訊息以 JSON 存放。
 * 之後 Tauri 版以相同 {@link AppStorage} 介面換成原生 SQLite。
 */
export class LocalStorage implements AppStorage {
  loadIdentity(): StoredIdentity | null {
    return read<StoredIdentity | null>(K_IDENTITY, null);
  }
  saveIdentity(identity: StoredIdentity): void {
    write(K_IDENTITY, identity);
  }
  loadContacts(): StoredContact[] {
    return read<StoredContact[]>(K_CONTACTS, []);
  }
  addContact(contact: StoredContact): void {
    const contacts = this.loadContacts();
    if (contacts.some((c) => c.pubkey === contact.pubkey)) return;
    contacts.push(contact);
    write(K_CONTACTS, contacts);
  }
  updateContactRelay(pubkey: string, relayUrl: string | undefined): void {
    write(
      K_CONTACTS,
      this.loadContacts().map((c) => {
        if (c.pubkey !== pubkey) return c;
        const { relayUrl: _drop, ...rest } = c;
        return relayUrl ? { ...rest, relayUrl } : rest;
      }),
    );
  }
  removeContact(pubkey: string): void {
    const ids = new Set(this.loadMessages(pubkey).map((m) => m.id));
    write(K_CONTACTS, this.loadContacts().filter((c) => c.pubkey !== pubkey));
    try {
      localStorage.removeItem(K_MSG_PREFIX + pubkey);
    } catch {
      /* 忽略 */
    }
    this.pruneOrphans(ids); // 清理該對話訊息的孤兒 reactions/deleted（審查 P1-5）
  }
  /** 移除一組 messageId 對應的孤兒回應與已收回標記（避免全域清單無限累積）。 */
  private pruneOrphans(messageIds: Set<string>): void {
    if (messageIds.size === 0) return;
    write(K_REACTIONS, this.loadReactions().filter((r) => !messageIds.has(r.messageId)));
    write(K_DELETED, this.loadDeleted().filter((id) => !messageIds.has(id)));
  }
  blockContact(contact: StoredContact): void {
    this.removeContact(contact.pubkey);
    const blocked = this.loadBlocked();
    if (blocked.some((b) => b.pubkey === contact.pubkey)) return;
    blocked.push(contact);
    write(K_BLOCKED, blocked);
  }
  unblockContact(pubkey: string): void {
    write(K_BLOCKED, this.loadBlocked().filter((b) => b.pubkey !== pubkey));
  }
  loadBlocked(): StoredContact[] {
    return read<StoredContact[]>(K_BLOCKED, []);
  }
  loadMessages(contactPubkey: string): StoredMessage[] {
    return read<StoredMessage[]>(K_MSG_PREFIX + contactPubkey, []);
  }
  appendMessage(message: StoredMessage): void {
    const list = this.loadMessages(message.contact);
    if (list.some((m) => m.id === message.id)) return;
    list.push(message);
    if (list.length > MESSAGES_PER_CONVO) list.splice(0, list.length - MESSAGES_PER_CONVO); // 逐出最舊（P0-1）
    write(K_MSG_PREFIX + message.contact, list);
  }
  loadReactions(): StoredReaction[] {
    return read<StoredReaction[]>(K_REACTIONS, []);
  }
  addReaction(reaction: StoredReaction): void {
    const list = this.loadReactions();
    if (list.some((r) => r.id === reaction.id)) return;
    list.push(reaction);
    write(K_REACTIONS, list);
  }
  markDeleted(messageId: string): void {
    const list = this.loadDeleted();
    if (list.includes(messageId)) return;
    list.push(messageId);
    write(K_DELETED, list);
  }
  loadDeleted(): string[] {
    return read<string[]>(K_DELETED, []);
  }
  loadGroups(): StoredGroup[] {
    return read<StoredGroup[]>(K_GROUPS, []);
  }
  saveGroup(group: StoredGroup): void {
    const list = this.loadGroups().filter((g) => g.id !== group.id);
    list.push(group);
    write(K_GROUPS, list);
  }
  removeGroup(id: string): void {
    const ids = new Set(this.loadMessages(id).map((m) => m.id));
    write(K_GROUPS, this.loadGroups().filter((g) => g.id !== id));
    try {
      localStorage.removeItem(K_MSG_PREFIX + id);
    } catch {
      /* 忽略 */
    }
    this.pruneOrphans(ids); // 審查 P1-5
  }
  loadBootstrapList(): StoredBootstrapList | null {
    return read<StoredBootstrapList | null>(K_BOOTSTRAP, null);
  }
  saveBootstrapList(doc: StoredBootstrapList): void {
    write(K_BOOTSTRAP, doc);
  }
}
