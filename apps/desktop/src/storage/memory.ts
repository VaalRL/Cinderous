import type {
  AppStorage,
  StoredContact,
  StoredIdentity,
  StoredMessage,
  StoredReaction,
} from "./types.js";

/** 記憶體儲存（測試用；不持久）。 */
export class MemoryStorage implements AppStorage {
  private identity: StoredIdentity | null = null;
  private contacts: StoredContact[] = [];
  private readonly messages = new Map<string, StoredMessage[]>();
  private reactions: StoredReaction[] = [];
  private readonly deleted = new Set<string>();
  private blocked: StoredContact[] = [];

  loadIdentity(): StoredIdentity | null {
    return this.identity;
  }
  saveIdentity(identity: StoredIdentity): void {
    this.identity = identity;
  }
  loadContacts(): StoredContact[] {
    return [...this.contacts];
  }
  addContact(contact: StoredContact): void {
    if (this.contacts.some((c) => c.pubkey === contact.pubkey)) return;
    this.contacts.push(contact);
  }
  removeContact(pubkey: string): void {
    this.contacts = this.contacts.filter((c) => c.pubkey !== pubkey);
    this.messages.delete(pubkey);
  }
  blockContact(contact: StoredContact): void {
    this.removeContact(contact.pubkey);
    if (!this.blocked.some((b) => b.pubkey === contact.pubkey)) this.blocked.push(contact);
  }
  unblockContact(pubkey: string): void {
    this.blocked = this.blocked.filter((b) => b.pubkey !== pubkey);
  }
  loadBlocked(): StoredContact[] {
    return [...this.blocked];
  }
  loadMessages(contactPubkey: string): StoredMessage[] {
    return [...(this.messages.get(contactPubkey) ?? [])];
  }
  appendMessage(message: StoredMessage): void {
    const list = this.messages.get(message.contact) ?? [];
    if (list.some((m) => m.id === message.id)) return;
    list.push(message);
    this.messages.set(message.contact, list);
  }
  loadReactions(): StoredReaction[] {
    return [...this.reactions];
  }
  addReaction(reaction: StoredReaction): void {
    if (this.reactions.some((r) => r.id === reaction.id)) return;
    this.reactions.push(reaction);
  }
  markDeleted(messageId: string): void {
    this.deleted.add(messageId);
  }
  loadDeleted(): string[] {
    return [...this.deleted];
  }
}
