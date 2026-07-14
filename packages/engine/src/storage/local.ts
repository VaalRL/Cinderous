import { ArchiveWriter, type MessageArchive } from "./archive.js";
import { MemoryStorage } from "./memory.js";
import type {
  AppStorage,
  MessageStatus,
  StorageSnapshot,
  StoredBootstrapList,
  StoredContact,
  StoredGroup,
  StoredIdentity,
  StoredMessage,
  StoredReaction,
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

const MSGS = "msgs.";

/**
 * localStorage 儲存。身分/聯絡人/訊息以 JSON 存放。
 *
 * 多身分（ADR-0045）：以 `namespace`（通常為 pubkey）隔離各身分資料。
 * 空 namespace＝既有單一身分的舊鍵（`nb.<suffix>`，向後相容）；
 * 具名 namespace＝`nb.<namespace>.<suffix>`，各身分互不交雜。
 *
 * **狀態常駐記憶體（ADR-0110）**：委派 {@link MemoryStorage}（其每對話持有 id 索引），
 * 變更後只把**受影響的鍵**寫回 localStorage。
 *
 * 過去每個方法都「`JSON.parse` 整個對話 → 改一則 → `JSON.stringify` 寫回」：
 * 實測 5 萬則的對話下，**收一則訊息要 47ms**、單則狀態更新 53ms，全部同步阻塞主執行緒。
 * 現在讀取零解析、查找 O(1)，只剩寫回時的一次序列化。
 */
export class LocalStorage implements AppStorage {
  private readonly mem: MemoryStorage;
  /** 封存（ADR-0111）：超出熱區的舊訊息移入，而非刪除。未掛＝熱區無上限（不裁切）。 */
  private writer: ArchiveWriter | undefined;
  private archive: MessageArchive | undefined;

  constructor(
    private readonly namespace = "",
    /** 每對話保留上限（ADR-0094）；`0`＝無上限（預設）。 */
    maxPerConvo = 0,
  ) {
    this.mem = new MemoryStorage(maxPerConvo);
    this.mem.importSnapshot(this.readSnapshot());
  }

  /**
   * 掛上封存（ADR-0111）。**只有掛上後熱區才會被裁切**——沒有封存就不裁切，
   * 絕不讓「封存不可用」變成「訊息被刪掉」。
   */
  attachArchive(archive: MessageArchive): void {
    this.archive = archive;
    this.writer = new ArchiveWriter(this.mem, archive, (convo) => this.writeConvo(convo));
  }
  archiveOf(): MessageArchive | undefined {
    return this.archive;
  }
  /** 等待在途的封存搬移完成（關閉前／測試）。 */
  async flushArchive(): Promise<void> {
    await this.writer?.flush();
  }

  private k(suffix: string): string {
    return this.namespace ? `nb.${this.namespace}.${suffix}` : `nb.${suffix}`;
  }

  /** 本命名空間下所有已存在的對話鍵（掃 localStorage；不可靠時退回聯絡人＋群組）。 */
  private convoKeys(contacts: StoredContact[], groups: StoredGroup[]): string[] {
    const prefix = this.k(MSGS);
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length));
      }
      return keys;
    } catch {
      return [...contacts.map((c) => c.pubkey), ...groups.map((g) => g.id)];
    }
  }

  /** 開機一次：把 localStorage 的全部狀態讀進記憶體（索引在 importSnapshot 內一次建好）。 */
  private readSnapshot(): StorageSnapshot {
    const contacts = read<StoredContact[]>(this.k("contacts"), []);
    const groups = read<StoredGroup[]>(this.k("groups"), []);
    const messages: Record<string, StoredMessage[]> = {};
    for (const convo of this.convoKeys(contacts, groups)) {
      messages[convo] = read<StoredMessage[]>(this.k(MSGS + convo), []);
    }
    return {
      identity: read<StoredIdentity | null>(this.k("identity"), null),
      contacts,
      blocked: read<StoredContact[]>(this.k("blocked"), []),
      messages,
      reactions: read<StoredReaction[]>(this.k("reactions"), []),
      deleted: read<string[]>(this.k("deleted"), []),
      groups,
      bootstrapList: read<StoredBootstrapList | null>(this.k("bootstrapList"), null),
      readAt: read<Record<string, number>>(this.k("readAt"), {}),
    };
  }

  /** 把某對話寫回（唯一會隨歷史長度成長的寫入；只碰被改動的那一個對話）。 */
  private writeConvo(convo: string): void {
    write(this.k(MSGS + convo), this.mem.loadMessages(convo));
  }
  private writeContacts(): void {
    write(this.k("contacts"), this.mem.loadContacts());
  }
  private writeGroups(): void {
    write(this.k("groups"), this.mem.loadGroups());
  }
  /** 移除聯絡人/群組會連帶清掉其訊息的孤兒 reactions/deleted（見 MemoryStorage.pruneOrphans）。 */
  private writeOrphanSweep(): void {
    write(this.k("reactions"), this.mem.loadReactions());
    write(this.k("deleted"), this.mem.loadDeleted());
  }

  loadIdentity(): StoredIdentity | null {
    return this.mem.loadIdentity();
  }
  saveIdentity(identity: StoredIdentity): void {
    this.mem.saveIdentity(identity);
    write(this.k("identity"), identity);
  }
  loadContacts(): StoredContact[] {
    return this.mem.loadContacts();
  }
  addContact(contact: StoredContact): void {
    this.mem.addContact(contact);
    this.writeContacts();
  }
  updateContactRelay(pubkey: string, relayUrl: string | undefined): void {
    this.mem.updateContactRelay(pubkey, relayUrl);
    this.writeContacts();
  }
  updateContactName(pubkey: string, name: string): void {
    this.mem.updateContactName(pubkey, name);
    this.writeContacts();
  }
  removeContact(pubkey: string): void {
    this.mem.removeContact(pubkey);
    this.writeContacts();
    localStorage.removeItem(this.k(MSGS + pubkey));
    this.writeOrphanSweep();
    void this.archive?.remove(pubkey); // 封存也要清（ADR-0111），否則刪好友卻留下歷史
  }
  remapContact(from: string, to: string): void {
    this.mem.remapContact(from, to);
    // 身分輪替會重寫對話歸屬與群訊 sender（ADR-0052）→ 影響面廣，整批寫回（極少發生）。
    this.writeContacts();
    this.writeGroups();
    localStorage.removeItem(this.k(MSGS + from));
    this.writeConvo(to);
    for (const g of this.mem.loadGroups()) this.writeConvo(g.id);
  }
  blockContact(contact: StoredContact): void {
    this.mem.blockContact(contact);
    this.writeContacts();
    localStorage.removeItem(this.k(MSGS + contact.pubkey));
    this.writeOrphanSweep();
    write(this.k("blocked"), this.mem.loadBlocked());
    void this.archive?.remove(contact.pubkey);
  }
  unblockContact(pubkey: string): void {
    this.mem.unblockContact(pubkey);
    write(this.k("blocked"), this.mem.loadBlocked());
  }
  loadBlocked(): StoredContact[] {
    return this.mem.loadBlocked();
  }
  loadMessages(contactPubkey: string): StoredMessage[] {
    return this.mem.loadMessages(contactPubkey);
  }
  appendMessage(message: StoredMessage): void {
    this.mem.appendMessage(message);
    this.writeConvo(message.contact);
    this.writer?.schedule(message.contact); // 溢出滿一塊才搬（ADR-0111）
  }
  setMessageStatus(contactPubkey: string, messageId: string, status: MessageStatus): void {
    this.mem.setMessageStatus(contactPubkey, messageId, status);
    this.writeConvo(contactPubkey);
  }
  /** ADR-0110：整個已讀水位一次改完、**一次寫回**（原本每則各寫一次 → O(k×n)）。 */
  setMessageStatusBulk(contactPubkey: string, messageIds: string[], status: MessageStatus): string[] {
    const changed = this.mem.setMessageStatusBulk(contactPubkey, messageIds, status);
    if (changed.length > 0) this.writeConvo(contactPubkey);
    return changed;
  }
  setFileSavedPath(contactPubkey: string, messageId: string, savedPath: string): void {
    this.mem.setFileSavedPath(contactPubkey, messageId, savedPath);
    this.writeConvo(contactPubkey);
  }
  setFileThumb(contactPubkey: string, messageId: string, thumb: string): void {
    this.mem.setFileThumb(contactPubkey, messageId, thumb);
    this.writeConvo(contactPubkey);
  }
  setMessageReceipt(
    convoKey: string,
    messageId: string,
    member: string,
    type: "delivered" | "read",
  ): Record<string, "delivered" | "read"> | undefined {
    const next = this.mem.setMessageReceipt(convoKey, messageId, member, type);
    if (next) this.writeConvo(convoKey);
    return next;
  }
  /** ADR-0110：群組已讀水位一次改完、**一次寫回**。 */
  setMessageReceiptBulk(
    convoKey: string,
    messageIds: string[],
    member: string,
    type: "delivered" | "read",
  ): Map<string, Record<string, "delivered" | "read">> {
    const out = this.mem.setMessageReceiptBulk(convoKey, messageIds, member, type);
    if (out.size > 0) this.writeConvo(convoKey);
    return out;
  }
  setMaxPerConvo(max: number): void {
    this.mem.setMaxPerConvo(max);
    // 逐出結果需落地，否則重載後又冒出來。
    for (const convo of Object.keys(this.mem.exportSnapshot().messages)) this.writeConvo(convo);
  }
  loadReadAt(): Record<string, number> {
    return this.mem.loadReadAt();
  }
  setReadAt(convoKey: string, at: number): void {
    this.mem.setReadAt(convoKey, at);
    write(this.k("readAt"), this.mem.loadReadAt());
  }
  loadReactions(): StoredReaction[] {
    return this.mem.loadReactions();
  }
  addReaction(reaction: StoredReaction): void {
    this.mem.addReaction(reaction);
    write(this.k("reactions"), this.mem.loadReactions());
  }
  markDeleted(messageId: string): void {
    this.mem.markDeleted(messageId);
    write(this.k("deleted"), this.mem.loadDeleted());
  }
  loadDeleted(): string[] {
    return this.mem.loadDeleted();
  }
  loadGroups(): StoredGroup[] {
    return this.mem.loadGroups();
  }
  saveGroup(group: StoredGroup): void {
    this.mem.saveGroup(group);
    this.writeGroups();
  }
  removeGroup(id: string): void {
    this.mem.removeGroup(id);
    this.writeGroups();
    localStorage.removeItem(this.k(MSGS + id));
    this.writeOrphanSweep();
    void this.archive?.remove(id);
  }
  loadBootstrapList(): StoredBootstrapList | null {
    return this.mem.loadBootstrapList();
  }
  saveBootstrapList(list: StoredBootstrapList): void {
    this.mem.saveBootstrapList(list);
    write(this.k("bootstrapList"), list);
  }
  exportSnapshot(): StorageSnapshot {
    return this.mem.exportSnapshot();
  }
  importSnapshot(s: StorageSnapshot): void {
    this.mem.importSnapshot(s);
    for (const [key, value] of Object.entries(this.mem.exportSnapshot())) {
      if (key === "messages") continue;
      write(this.k(key), value);
    }
    for (const convo of Object.keys(s.messages)) this.writeConvo(convo);
  }
}
