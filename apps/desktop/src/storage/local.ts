import type {
  AppStorage,
  StoredContact,
  StoredIdentity,
  StoredMessage,
  StoredReaction,
} from "./types.js";

const K_IDENTITY = "nb.identity";
const K_CONTACTS = "nb.contacts";
const K_MSG_PREFIX = "nb.msgs.";
const K_REACTIONS = "nb.reactions";
const K_DELETED = "nb.deleted";

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
  } catch {
    /* 配額或不可用時忽略 */
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
  loadMessages(contactPubkey: string): StoredMessage[] {
    return read<StoredMessage[]>(K_MSG_PREFIX + contactPubkey, []);
  }
  appendMessage(message: StoredMessage): void {
    const list = this.loadMessages(message.contact);
    if (list.some((m) => m.id === message.id)) return;
    list.push(message);
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
}
