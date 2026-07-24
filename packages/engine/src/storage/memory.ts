import type { AssetBlob, AssetTombstone, CustomAsset, OrSetTombstone, SyncedPrefs } from "@cinderous/core";
import {
  advanceReceipt,
  type AppStorage,
  THUMB_MAX_BYTES,
  MESSAGE_STATUS_RANK,
  type MessageStatus,
  type OrSetName,
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
  /** 自己的廣播頭像（ADR-0154）：null＝從未設定；""＝已移除記號。 */
  private selfAvatar: string | null = null;
  /** 自己的企業頭銜（ADR-0158）：三態語意同 selfAvatar。 */
  private selfTitle: string | null = null;
  private contacts: StoredContact[] = [];
  private readonly convos = new Map<string, Convo>();
  private reactions: StoredReaction[] = [];
  private readonly deleted = new Set<string>();
  /** 無痕收回（ADR-0234）：UI 整行移除、不留佔位。 */
  private readonly purged = new Set<string>();
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

  /**
   * 每對話保留上限（ADR-0094→0126）：`0`＝無上限（沿用 HOT_CAP）。
   *
   * ADR-0126：上限**不再刪除**，而是成為封存的有效熱區門檻——溢出移進封存（歷史紀錄仍可讀）。
   * 變更後對所有對話 `schedule()` 一次封存搬移，讓調低上限**即刻**生效（不必等下一則訊息）。
   * 無封存（`writer` 未掛）時什麼都不做——絕不讓「封存不可用」變成「訊息被刪」（ADR-0111 紅線）。
   */
  setMaxPerConvo(max: number): void {
    this.maxPerConvo = Math.max(0, Math.floor(max));
    for (const convo of this.convos.keys()) this.writer?.schedule(convo);
  }

  /** 使用者設定的保留上限（ADR-0126）：`0`＝無上限。供 ArchiveWriter 決定有效熱區大小。 */
  retentionCap(): number {
    return this.maxPerConvo;
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

  loadIdentity(): StoredIdentity | null {
    return this.identity;
  }
  saveIdentity(identity: StoredIdentity): void {
    this.identity = identity;
  }
  loadSelfAvatar(): string | null {
    return this.selfAvatar;
  }
  saveSelfAvatar(avatar: string | undefined): void {
    this.selfAvatar = avatar ?? null;
  }
  loadSelfTitle(): string | null {
    return this.selfTitle;
  }
  saveSelfTitle(title: string | undefined): void {
    this.selfTitle = title ?? null;
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
  setContactAlias(pubkey: string, alias: string | undefined, at?: number): void {
    // ADR-0148：只動聯絡人的 alias，不碰 name（廣播名獨立保存）。空＝清除，退回廣播名。
    const trimmed = alias?.trim();
    this.contacts = this.contacts.map((c) => {
      if (c.pubkey !== pubkey) return c;
      const { alias: _drop, ...rest } = c;
      const next: StoredContact = trimmed ? { ...rest, alias: trimmed } : rest;
      // ADR-0242 階段②：帶編輯時間戳供 per-field LWW（清除也是一次編輯，須記時間才傳得出去）。
      if (at !== undefined) next.fieldsAt = { ...(c.fieldsAt ?? {}), alias: at };
      return next;
    });
  }
  setContactNotifySound(pubkey: string, soundId: string | undefined, at?: number): void {
    // ADR-0149：依聯絡人通知音效（預設集 id）。空＝清除，播放退回全域預設。
    const trimmed = soundId?.trim();
    this.contacts = this.contacts.map((c) => {
      if (c.pubkey !== pubkey) return c;
      const { notifySound: _drop, ...rest } = c;
      const next: StoredContact = trimmed ? { ...rest, notifySound: trimmed } : rest;
      if (at !== undefined) next.fieldsAt = { ...(c.fieldsAt ?? {}), notifySound: at }; // ADR-0242 階段②
      return next;
    });
  }
  updateContactAvatar(pubkey: string, avatar: string | undefined): void {
    // ADR-0154：對方廣播的頭像。請求區的人也要更新（同 updateContactName 的理由，ADR-0121）。
    const put = (c: StoredContact): StoredContact => {
      if (c.pubkey !== pubkey) return c;
      const { avatar: _drop, ...rest } = c;
      return avatar ? { ...rest, avatar } : rest;
    };
    this.contacts = this.contacts.map(put);
    this.requests = this.requests.map(put);
  }
  updateContactTitle(pubkey: string, title: string | undefined): void {
    // ADR-0158：對方廣播的企業頭銜（同 avatar 的更新語意）。
    const put = (c: StoredContact): StoredContact => {
      if (c.pubkey !== pubkey) return c;
      const { title: _drop, ...rest } = c;
      return title ? { ...rest, title } : rest;
    };
    this.contacts = this.contacts.map(put);
    this.requests = this.requests.map(put);
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
    for (const id of messageIds) {
      this.deleted.delete(id);
      this.purged.delete(id);
    }
  }
  remapContact(from: string, to: string): void {
    if (from === to) return;
    const moved = (this.convos.get(from)?.list ?? []).map((m) => ({ ...m, contact: to }));
    if (moved.length > 0) {
      const dest = this.convo(to);
      for (const m of moved) if (!dest.byId.has(m.id)) dest.list.push(m);
      dest.list.sort((a, b) => a.at - b.at);
      this.reindex(dest);
      this.writer?.schedule(to); // ADR-0126：合併後若溢出，封存（不再刪除）
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
    // ADR-0126：保留上限不再刪除——溢出（HOT_CAP 或使用者上限，取較嚴者由 ArchiveWriter 決定）
    // 一律封存。無封存時不裁切（ADR-0111 紅線）。
    this.writer?.schedule(message.contact);
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
  findMessage(messageId: string): StoredMessage | undefined {
    for (const c of this.convos.values()) {
      const hit = c.byId.get(messageId);
      if (hit) return hit;
    }
    return undefined;
  }
  markPurged(messageId: string): void {
    this.purged.add(messageId);
  }
  loadPurged(): string[] {
    return [...this.purged];
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
  private customAssets: CustomAsset[] = [];
  loadCustomAssets(): CustomAsset[] {
    return this.customAssets;
  }
  saveCustomAssets(list: CustomAsset[]): void {
    this.customAssets = list;
  }
  private assetBlobs: AssetBlob[] = [];
  loadAssetBlobs(): AssetBlob[] {
    return this.assetBlobs;
  }
  saveAssetBlobs(list: AssetBlob[]): void {
    this.assetBlobs = list;
  }
  private assetTombstones: AssetTombstone[] = [];
  loadAssetTombstones(): AssetTombstone[] {
    return this.assetTombstones;
  }
  saveAssetTombstones(list: AssetTombstone[]): void {
    this.assetTombstones = list;
  }
  // 多設備 OR-Set 墓碑（ADR-0242）：以 set 名為桶（contacts/groups/blocked）。
  private crdtTombstones: Record<string, OrSetTombstone[]> = {};
  loadCrdtTombstones(set: OrSetName): OrSetTombstone[] {
    return this.crdtTombstones[set] ?? [];
  }
  saveCrdtTombstones(set: OrSetName, list: OrSetTombstone[]): void {
    this.crdtTombstones[set] = list;
  }
  private syncedPrefs: SyncedPrefs = {}; // ADR-0242 階段③
  loadSyncedPrefs(): SyncedPrefs {
    return this.syncedPrefs;
  }
  saveSyncedPrefs(prefs: SyncedPrefs): void {
    this.syncedPrefs = prefs;
  }

  /** 匯出整包狀態快照（B2 加密儲存，ADR-0054）；深拷貝以免外部改動內部。 */
  exportSnapshot(): StorageSnapshot {
    const messages: Record<string, StoredMessage[]> = {};
    for (const [k, v] of this.convos) messages[k] = [...v.list];
    return {
      identity: this.identity,
      selfAvatar: this.selfAvatar, // ADR-0154
      selfTitle: this.selfTitle, // ADR-0158
      contacts: [...this.contacts],
      blocked: [...this.blocked],
      requests: [...this.requests],
      messages,
      reactions: [...this.reactions],
      deleted: [...this.deleted],
      purged: [...this.purged], // ADR-0234
      groups: this.groups.map((g) => ({ ...g, members: [...g.members] })),
      bootstrapList: this.bootstrapList,
      customAssets: [...this.customAssets], // ADR-0220
      assetBlobs: [...this.assetBlobs], // ADR-0223
      assetTombstones: [...this.assetTombstones], // ADR-0224
      crdtTombstones: { ...this.crdtTombstones }, // ADR-0242
      syncedPrefs: { ...this.syncedPrefs }, // ADR-0242 階段③
      readAt: Object.fromEntries(this.readAt), // ADR-0108
    };
  }

  /** 以快照覆蓋內部狀態（開機從加密 blob 灌入）。 */
  importSnapshot(s: StorageSnapshot): void {
    this.identity = s.identity;
    this.selfAvatar = s.selfAvatar ?? null; // 舊快照沒有這個欄位（ADR-0154）
    this.selfTitle = s.selfTitle ?? null; // ADR-0158
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
    this.purged.clear();
    for (const id of s.purged ?? []) this.purged.add(id); // 舊快照無此欄位（ADR-0234）
    this.groups = s.groups.map((g) => ({ ...g, members: [...g.members] }));
    this.bootstrapList = s.bootstrapList;
    this.customAssets = [...(s.customAssets ?? [])]; // 舊快照無此欄位（ADR-0220）
    this.assetBlobs = [...(s.assetBlobs ?? [])]; // 舊快照無此欄位（ADR-0223）
    this.assetTombstones = [...(s.assetTombstones ?? [])]; // 舊快照無此欄位（ADR-0224）
    this.crdtTombstones = { ...(s.crdtTombstones ?? {}) }; // 舊快照無此欄位（ADR-0242）
    this.syncedPrefs = { ...(s.syncedPrefs ?? {}) }; // 舊快照無此欄位（ADR-0242 階段③）
    this.readAt.clear();
    for (const [k, v] of Object.entries(s.readAt ?? {})) this.readAt.set(k, v); // 舊快照無此欄位
  }
}
