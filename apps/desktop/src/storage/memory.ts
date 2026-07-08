import {
  type AppStorage,
  MESSAGE_STATUS_RANK,
  type MessageStatus,
  MESSAGES_PER_CONVO,
  type StorageSnapshot,
  type StoredBootstrapList,
  type StoredContact,
  type StoredGroup,
  type StoredIdentity,
  type StoredMessage,
  type StoredReaction,
} from "./types.js";

/** 記憶體儲存（測試用；不持久）。 */
export class MemoryStorage implements AppStorage {
  private identity: StoredIdentity | null = null;
  private contacts: StoredContact[] = [];
  private readonly messages = new Map<string, StoredMessage[]>();
  private reactions: StoredReaction[] = [];
  private readonly deleted = new Set<string>();
  private blocked: StoredContact[] = [];
  private groups: StoredGroup[] = [];

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
  updateContactRelay(pubkey: string, relayUrl: string | undefined): void {
    this.contacts = this.contacts.map((c) => {
      if (c.pubkey !== pubkey) return c;
      const { relayUrl: _drop, ...rest } = c;
      return relayUrl ? { ...rest, relayUrl } : rest;
    });
  }
  removeContact(pubkey: string): void {
    const ids = new Set((this.messages.get(pubkey) ?? []).map((m) => m.id));
    this.contacts = this.contacts.filter((c) => c.pubkey !== pubkey);
    this.messages.delete(pubkey);
    this.pruneOrphans(ids); // 審查 P1-5
  }
  private pruneOrphans(messageIds: Set<string>): void {
    if (messageIds.size === 0) return;
    this.reactions = this.reactions.filter((r) => !messageIds.has(r.messageId));
    for (const id of messageIds) this.deleted.delete(id);
  }
  remapContact(from: string, to: string): void {
    if (from === to) return;
    const moved = (this.messages.get(from) ?? []).map((m) => ({ ...m, contact: to }));
    if (moved.length > 0) {
      const dest = this.messages.get(to) ?? [];
      const seen = new Set(dest.map((m) => m.id));
      for (const m of moved) if (!seen.has(m.id)) dest.push(m);
      dest.sort((a, b) => a.at - b.at);
      if (dest.length > MESSAGES_PER_CONVO) dest.splice(0, dest.length - MESSAGES_PER_CONVO);
      this.messages.set(to, dest);
    }
    this.messages.delete(from);
    this.groups = this.groups.map((g) =>
      g.members.includes(from) ? { ...g, members: [...new Set(g.members.map((p) => (p === from ? to : p)))] } : g,
    );
    // 群訊發送者標籤 remap（ADR-0052）：群組歷史中舊 npub 的 sender 改寫為新 npub。
    for (const g of this.groups) {
      const list = this.messages.get(g.id);
      if (!list) continue;
      let changed = false;
      const rewritten = list.map((m) => {
        if (m.sender !== from) return m;
        changed = true;
        return { ...m, sender: to };
      });
      if (changed) this.messages.set(g.id, rewritten);
    }
    this.contacts = this.contacts.filter((c) => c.pubkey !== from);
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
    if (list.length > MESSAGES_PER_CONVO) list.splice(0, list.length - MESSAGES_PER_CONVO); // 逐出最舊（P0-1）
    this.messages.set(message.contact, list);
  }
  setMessageStatus(contactPubkey: string, messageId: string, status: MessageStatus): void {
    const msg = this.messages.get(contactPubkey)?.find((m) => m.id === messageId);
    if (!msg) return;
    if (MESSAGE_STATUS_RANK[status] <= MESSAGE_STATUS_RANK[msg.status ?? "sending"]) return; // 只前進
    msg.status = status;
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
  loadGroups(): StoredGroup[] {
    return this.groups.map((g) => ({ ...g, members: [...g.members] }));
  }
  saveGroup(group: StoredGroup): void {
    const i = this.groups.findIndex((g) => g.id === group.id);
    if (i >= 0) this.groups[i] = group;
    else this.groups.push(group);
  }
  removeGroup(id: string): void {
    const ids = new Set((this.messages.get(id) ?? []).map((m) => m.id));
    this.groups = this.groups.filter((g) => g.id !== id);
    this.messages.delete(id);
    this.pruneOrphans(ids); // 審查 P1-5
  }
  private bootstrapList: StoredBootstrapList | null = null;
  loadBootstrapList(): StoredBootstrapList | null {
    return this.bootstrapList;
  }
  saveBootstrapList(doc: StoredBootstrapList): void {
    this.bootstrapList = doc;
  }

  /** 匯出整包狀態快照（B2 加密儲存，ADR-0054）；深拷貝以免外部改動內部。 */
  exportSnapshot(): StorageSnapshot {
    const messages: Record<string, StoredMessage[]> = {};
    for (const [k, v] of this.messages) messages[k] = [...v];
    return {
      identity: this.identity,
      contacts: [...this.contacts],
      blocked: [...this.blocked],
      messages,
      reactions: [...this.reactions],
      deleted: [...this.deleted],
      groups: this.groups.map((g) => ({ ...g, members: [...g.members] })),
      bootstrapList: this.bootstrapList,
    };
  }

  /** 以快照覆蓋內部狀態（開機從加密 blob 灌入）。 */
  importSnapshot(s: StorageSnapshot): void {
    this.identity = s.identity;
    this.contacts = [...s.contacts];
    this.blocked = [...s.blocked];
    this.messages.clear();
    for (const [k, v] of Object.entries(s.messages)) this.messages.set(k, [...v]);
    this.reactions = [...s.reactions];
    this.deleted.clear();
    for (const id of s.deleted) this.deleted.add(id);
    this.groups = s.groups.map((g) => ({ ...g, members: [...g.members] }));
    this.bootstrapList = s.bootstrapList;
  }
}
