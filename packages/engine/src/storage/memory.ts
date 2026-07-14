import {
  advanceReceipt,
  type AppStorage,
  THUMB_MAX_BYTES,
  MESSAGE_STATUS_RANK,
  type MessageStatus,
  type StorageSnapshot,
  type StoredBootstrapList,
  type StoredContact,
  type StoredGroup,
  type StoredIdentity,
  type StoredMessage,
  type StoredReaction,
} from "./types.js";

import { ArchiveWriter, type MessageArchive } from "./archive.js";

/**
 * 一個對話的訊息（ADR-0110）：陣列（保序）＋ id→訊息的索引。
 *
 * 索引不是最佳化裝飾，是**必要**的：沒有它，`appendMessage` 的去重與
 * `setMessageStatus`／`setFileThumb`／`setMessageReceipt` 的查找全都是 O(n) 線性掃描
 * ——而它們都在收訊/回條的熱路徑上。實測 5 萬則的對話下，光是建置歷史就會退化成 O(n²)
 * （跑到逾時）。兩者共用同一個訊息物件參考，就地改狀態即可，不需同步兩份資料。
 */
interface Convo {
  list: StoredMessage[];
  byId: Map<string, StoredMessage>;
}

/** 記憶體儲存（測試用；不持久）。 */
export class MemoryStorage implements AppStorage {
  private identity: StoredIdentity | null = null;
  private contacts: StoredContact[] = [];
  private readonly convos = new Map<string, Convo>();
  private reactions: StoredReaction[] = [];
  private readonly deleted = new Set<string>();
  private blocked: StoredContact[] = [];
  /** 訊息請求（ADR-0121）：陌生人傳來的訊息，等使用者裁示。 */
  private requests: StoredContact[] = [];
  private groups: StoredGroup[] = [];
  /** 已讀水位（ADR-0108）：對話 → 已讀到的最新訊息時間（毫秒）。 */
  private readonly readAt = new Map<string, number>();
  /**
   * 封存（ADR-0111）。**只有掛上後熱區才會被裁切**——沒有封存就不裁切。
   *
   * 註：`LocalStorage`／`TauriStorage` 委派本類別，但它們**各自持有自己的 writer**
   * （因為裁切後還要落地）。它們不會呼叫這裡的 `attachArchive`，故不會重複搬移。
   */
  private writer: ArchiveWriter | undefined;
  private archive: MessageArchive | undefined;
  /** 每對話持久化上限（ADR-0094）；`0`＝無上限（預設，不逐出）。 */
  private maxPerConvo: number;

  constructor(maxPerConvo = 0) {
    this.maxPerConvo = Math.max(0, Math.floor(maxPerConvo));
  }

  /** 每對話保留上限（ADR-0094）：`0`＝無上限。變更後即時對所有對話套用逐出。 */
  setMaxPerConvo(max: number): void {
    this.maxPerConvo = Math.max(0, Math.floor(max));
    if (this.maxPerConvo > 0) for (const convo of this.convos.values()) this.cap(convo);
  }

  /** 取得（或建立）某對話的訊息容器。 */
  private convo(key: string): Convo {
    let c = this.convos.get(key);
    if (!c) {
      c = { list: [], byId: new Map() };
      this.convos.set(key, c);
    }
    return c;
  }

  /** 由 list 重建 byId（僅在整批替換 list 後呼叫）。 */
  private reindex(convo: Convo): void {
    convo.byId.clear();
    for (const m of convo.list) convo.byId.set(m.id, m);
  }

  attachArchive(archive: MessageArchive): void {
    this.archive = archive;
    this.writer = new ArchiveWriter(this, archive, () => {}); // 純記憶體：裁切後無需落地
  }
  archiveOf(): MessageArchive | undefined {
    return this.archive;
  }
  async flushArchive(): Promise<void> {
    await this.writer?.flush();
  }

  loadReadAt(): Record<string, number> {
    return Object.fromEntries(this.readAt);
  }

  /** 推進已讀水位（ADR-0108）：單調遞增，倒退忽略。 */
  setReadAt(convoKey: string, at: number): void {
    if (at > (this.readAt.get(convoKey) ?? 0)) this.readAt.set(convoKey, at);
  }

  /**
   * 依**使用者設定的保留上限**（ADR-0094）逐出最舊；`0`＝無上限（預設）。索引同步移除。
   *
   * **這裡的刪除是刻意的**——保留上限的語意就是「我只要留 N 則」（使用者為了省空間而設）。
   * 它與 ADR-0111 的**熱區上限**（`HOT_CAP`，內部、恆開、超出者**封存**而非刪除）是**兩回事**。
   *
   * ⚠️ 已知不一致（ADR-0119 記錄）：ADR-0111 的敘述「修好 ADR-0094 的資料遺失」**說過頭了**
   * ——它只讓**熱區溢出**改走封存，使用者設的保留上限仍然是**真的刪除**（如其所願），
   * 而且**不會連帶清理封存**，所以它其實**沒有真的限制住總儲存量**。
   * 這個語意衝突（「省空間」vs「別刪我的歷史」）需要另立 ADR 釐清，本次不改行為。
   */
  private cap(convo: Convo): void {
    if (this.maxPerConvo > 0 && convo.list.length > this.maxPerConvo) {
      const evicted = convo.list.splice(0, convo.list.length - this.maxPerConvo);
      for (const m of evicted) convo.byId.delete(m.id);
    }
  }

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
    // 請求區的人也要記 hint（ADR-0121）——否則你「接受」他之後，回信只能走 home relay，
    // 而他可能在別座中繼上（ADR-0035 的自動學習就白學了）。
    const put = (c: StoredContact): StoredContact => {
      if (c.pubkey !== pubkey) return c;
      const { relayUrl: _drop, ...rest } = c;
      return relayUrl ? { ...rest, relayUrl } : rest;
    };
    this.requests = this.requests.map(put);
    this.contacts = this.contacts.map((c) => {
      if (c.pubkey !== pubkey) return c;
      const { relayUrl: _drop, ...rest } = c;
      return relayUrl ? { ...rest, relayUrl } : rest;
    });
  }
  updateContactName(pubkey: string, name: string): void {
    this.contacts = this.contacts.map((c) => (c.pubkey === pubkey ? { ...c, name } : c));
    // 請求區的人也要更新（ADR-0121）——否則請求清單裡只看得到 `npub1abc…`，
    // 使用者無從判斷要不要接受。
    this.requests = this.requests.map((r) => (r.pubkey === pubkey ? { ...r, name } : r));
  }
  removeContact(pubkey: string): void {
    const ids = new Set(this.convos.get(pubkey)?.byId.keys() ?? []);
    this.contacts = this.contacts.filter((c) => c.pubkey !== pubkey);
    this.convos.delete(pubkey);
    this.pruneOrphans(ids); // 審查 P1-5
    void this.archive?.remove(pubkey); // 封存也要清（ADR-0111）
  }
  private pruneOrphans(messageIds: Set<string>): void {
    if (messageIds.size === 0) return;
    this.reactions = this.reactions.filter((r) => !messageIds.has(r.messageId));
    for (const id of messageIds) this.deleted.delete(id);
  }
  remapContact(from: string, to: string): void {
    if (from === to) return;
    const moved = (this.convos.get(from)?.list ?? []).map((m) => ({ ...m, contact: to }));
    if (moved.length > 0) {
      const dest = this.convo(to);
      for (const m of moved) if (!dest.byId.has(m.id)) dest.list.push(m);
      dest.list.sort((a, b) => a.at - b.at);
      this.reindex(dest);
      this.cap(dest);
    }
    this.convos.delete(from);
    this.groups = this.groups.map((g) =>
      g.members.includes(from) ? { ...g, members: [...new Set(g.members.map((p) => (p === from ? to : p)))] } : g,
    );
    // 群訊發送者標籤 remap（ADR-0052）：群組歷史中舊 npub 的 sender 改寫為新 npub。
    // 就地改寫（同一份物件也在 byId 裡），索引無須重建。
    for (const g of this.groups) {
      for (const m of this.convos.get(g.id)?.list ?? []) if (m.sender === from) m.sender = to;
    }
    this.contacts = this.contacts.filter((c) => c.pubkey !== from);
  }
  blockContact(contact: StoredContact): void {
    this.removeContact(contact.pubkey);
    this.removeRequest(contact.pubkey); // 封鎖一個請求者＝連請求一起消失（ADR-0121）
    if (!this.blocked.some((b) => b.pubkey === contact.pubkey)) this.blocked.push(contact);
  }
  addRequest(contact: StoredContact): void {
    if (!this.requests.some((r) => r.pubkey === contact.pubkey)) this.requests.push(contact);
  }
  removeRequest(pubkey: string): void {
    this.requests = this.requests.filter((r) => r.pubkey !== pubkey);
  }
  loadRequests(): StoredContact[] {
    return [...this.requests];
  }
  unblockContact(pubkey: string): void {
    this.blocked = this.blocked.filter((b) => b.pubkey !== pubkey);
  }
  loadBlocked(): StoredContact[] {
    return [...this.blocked];
  }
  loadMessages(contactPubkey: string): StoredMessage[] {
    return [...(this.convos.get(contactPubkey)?.list ?? [])];
  }
  /** 最舊的 n 則（不移除）——供封存搬移「先寫後裁」的第一步（ADR-0111）。 */
  oldest(contactPubkey: string, n: number): StoredMessage[] {
    return (this.convos.get(contactPubkey)?.list ?? []).slice(0, n);
  }
  /** 裁掉最舊的 n 則（**封存寫入成功後**才呼叫，ADR-0111）；索引同步移除。 */
  trimOldest(contactPubkey: string, n: number): void {
    const convo = this.convos.get(contactPubkey);
    if (!convo || n <= 0) return;
    for (const m of convo.list.splice(0, n)) convo.byId.delete(m.id);
  }
  appendMessage(message: StoredMessage): void {
    const convo = this.convo(message.contact);
    if (convo.byId.has(message.id)) return; // O(1) 去重（ADR-0110；原為 O(n) 線性掃描）
    convo.list.push(message);
    convo.byId.set(message.id, message);
    this.cap(convo); // ADR-0094：有限模式逐出最舊；預設無上限不動
    this.writer?.schedule(message.contact); // ADR-0111：溢出滿一塊才搬進封存
  }
  setMessageStatus(contactPubkey: string, messageId: string, status: MessageStatus): void {
    const msg = this.convos.get(contactPubkey)?.byId.get(messageId); // O(1)（ADR-0110）
    if (!msg) return;
    if (MESSAGE_STATUS_RANK[status] <= MESSAGE_STATUS_RANK[msg.status ?? "sending"]) return; // 只前進
    msg.status = status;
  }
  /**
   * 批次推進多則訊息的狀態（ADR-0110）：**一次**呼叫涵蓋整個已讀水位。
   *
   * 過去已讀回條會對每一則未讀訊息各呼叫一次 `setMessageStatus`，而在持久化的儲存層裡
   * 每一次都是「載入整個對話 → 改一則 → 寫回整個對話」→ **O(k×n)**。
   * 實測 5 萬則歷史、50 則水位 = **3.5 秒主執行緒凍結**。回傳實際有前進的 id。
   */
  setMessageStatusBulk(contactPubkey: string, messageIds: string[], status: MessageStatus): string[] {
    const convo = this.convos.get(contactPubkey);
    if (!convo) return [];
    const changed: string[] = [];
    for (const id of messageIds) {
      const msg = convo.byId.get(id);
      if (!msg) continue;
      if (MESSAGE_STATUS_RANK[status] <= MESSAGE_STATUS_RANK[msg.status ?? "sending"]) continue;
      msg.status = status;
      changed.push(id);
    }
    return changed;
  }
  setFileSavedPath(contactPubkey: string, messageId: string, savedPath: string): void {
    const msg = this.convos.get(contactPubkey)?.byId.get(messageId);
    if (!msg?.file) return;
    msg.file = { ...msg.file, savedPath };
  }
  setFileThumb(contactPubkey: string, messageId: string, thumb: string): void {
    if (thumb.length > THUMB_MAX_BYTES) return; // 超上限寧可不存（不讓儲存膨脹）
    const msg = this.convos.get(contactPubkey)?.byId.get(messageId);
    if (!msg?.file) return;
    msg.file = { ...msg.file, thumb };
  }
  setMessageReceipt(
    convoKey: string,
    messageId: string,
    member: string,
    type: "delivered" | "read",
  ): Record<string, "delivered" | "read"> | undefined {
    const msg = this.convos.get(convoKey)?.byId.get(messageId);
    if (!msg) return undefined;
    const next = advanceReceipt(msg.receipts, member, type);
    if (!next) return undefined;
    msg.receipts = next;
    return { ...next };
  }
  setMessageReceiptBulk(
    convoKey: string,
    messageIds: string[],
    member: string,
    type: "delivered" | "read",
  ): Map<string, Record<string, "delivered" | "read">> {
    const convo = this.convos.get(convoKey);
    const out = new Map<string, Record<string, "delivered" | "read">>();
    if (!convo) return out;
    for (const id of messageIds) {
      const msg = convo.byId.get(id);
      if (!msg) continue;
      const next = advanceReceipt(msg.receipts, member, type);
      if (!next) continue;
      msg.receipts = next;
      out.set(id, { ...next });
    }
    return out;
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
    const ids = new Set(this.convos.get(id)?.byId.keys() ?? []);
    this.groups = this.groups.filter((g) => g.id !== id);
    this.convos.delete(id);
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
    for (const [k, v] of this.convos) messages[k] = [...v.list];
    return {
      identity: this.identity,
      contacts: [...this.contacts],
      blocked: [...this.blocked],
      requests: [...this.requests],
      messages,
      reactions: [...this.reactions],
      deleted: [...this.deleted],
      groups: this.groups.map((g) => ({ ...g, members: [...g.members] })),
      bootstrapList: this.bootstrapList,
      readAt: Object.fromEntries(this.readAt), // ADR-0108
    };
  }

  /** 以快照覆蓋內部狀態（開機從加密 blob 灌入）。 */
  importSnapshot(s: StorageSnapshot): void {
    this.identity = s.identity;
    this.contacts = [...s.contacts];
    this.blocked = [...s.blocked];
    this.requests = [...(s.requests ?? [])]; // 舊快照沒有 requests（ADR-0121）
    this.convos.clear();
    for (const [k, v] of Object.entries(s.messages)) {
      // 匯入即建索引（ADR-0110）：一次 O(n) 建好，之後所有查找 O(1)。
      // 過去是逐則 appendMessage（每則 O(n) 去重）→ 整批匯入退化成 **O(n²)**：
      // 實測 10 萬則跑到逾時（>2 分鐘）。配對搬家還原/快照合併都走這條路。
      const convo: Convo = { list: [...v], byId: new Map() };
      for (const m of convo.list) convo.byId.set(m.id, m);
      this.convos.set(k, convo);
    }
    this.reactions = [...s.reactions];
    this.deleted.clear();
    for (const id of s.deleted) this.deleted.add(id);
    this.groups = s.groups.map((g) => ({ ...g, members: [...g.members] }));
    this.bootstrapList = s.bootstrapList;
    this.readAt.clear();
    for (const [k, v] of Object.entries(s.readAt ?? {})) this.readAt.set(k, v); // 舊快照無此欄位
  }
}
