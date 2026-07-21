import {
  deriveStorageKey,
  openValue,
  sealValue,
  type AssetBlob,
  type AssetTombstone,
  type CustomAsset,
} from "@cinderous/core";

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

/**
 * 讀一個值。`dek` 存在時解密（ADR-0112）。
 *
 * **舊的明文值仍讀得出來**（`openValue` 對無前綴者原樣回傳）——否則升級等於把所有人的資料
 * 變成亂碼。下次寫入時會自動轉成密文。
 */
function read<T>(key: string, fallback: T, dek?: Uint8Array): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const plain = dek ? openValue(dek, raw) : raw;
    if (plain === null) return fallback; // 密文解不開（錯鑰/竄改）→ 不可當明文用
    return JSON.parse(plain) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown, dek?: Uint8Array): void {
  try {
    const json = JSON.stringify(value);
    localStorage.setItem(key, dek ? sealValue(dek, json) : json);
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

  /**
   * 靜態加密金鑰（ADR-0112）：由 nsec 導出。**未提供＝明文**（舊行為）。
   *
   * 注意：這個加密只有在 **nsec 不明文落盤**時才是真的——見 `at-rest.ts` 與 `passlock-web.ts`。
   */
  private readonly dek: Uint8Array | undefined;

  constructor(
    private readonly namespace = "",
    /** 每對話保留上限（ADR-0094）；`0`＝無上限（預設）。 */
    maxPerConvo = 0,
    /** 使用者私鑰（ADR-0112）：提供則靜態加密；省略則沿用明文（相容既有呼叫）。 */
    secretKey?: Uint8Array,
  ) {
    this.dek = secretKey ? deriveStorageKey(secretKey) : undefined;
    this.mem = new MemoryStorage(maxPerConvo);
    this.mem.importSnapshot(this.readSnapshot());
  }

  /** 已導出的儲存金鑰（供 OPFS 封存共用同一把，ADR-0112）。 */
  storageKey(): Uint8Array | undefined {
    return this.dek;
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
    const contacts = read<StoredContact[]>(this.k("contacts"), [], this.dek);
    const groups = read<StoredGroup[]>(this.k("groups"), [], this.dek);
    const messages: Record<string, StoredMessage[]> = {};
    for (const convo of this.convoKeys(contacts, groups)) {
      messages[convo] = read<StoredMessage[]>(this.k(MSGS + convo), [], this.dek);
    }
    return {
      identity: read<StoredIdentity | null>(this.k("identity"), null, this.dek),
      selfAvatar: read<string | null>(this.k("selfAvatar"), null, this.dek), // ADR-0154
      selfTitle: read<string | null>(this.k("selfTitle"), null, this.dek), // ADR-0158
      contacts,
      blocked: read<StoredContact[]>(this.k("blocked"), [], this.dek),
      requests: read<StoredContact[]>(this.k("requests"), [], this.dek), // ADR-0121
      messages,
      reactions: read<StoredReaction[]>(this.k("reactions"), [], this.dek),
      deleted: read<string[]>(this.k("deleted"), [], this.dek),
      groups,
      bootstrapList: read<StoredBootstrapList | null>(this.k("bootstrapList"), null, this.dek),
      customAssets: read<CustomAsset[]>(this.k("customAssets"), [], this.dek), // ADR-0220
      assetBlobs: read<AssetBlob[]>(this.k("assetBlobs"), [], this.dek), // ADR-0223
      assetTombstones: read<AssetTombstone[]>(this.k("assetTombstones"), [], this.dek), // ADR-0224
      readAt: read<Record<string, number>>(this.k("readAt"), {}, this.dek),
    };
  }

  /** 把某對話寫回（唯一會隨歷史長度成長的寫入；只碰被改動的那一個對話）。 */
  private writeConvo(convo: string): void {
    write(this.k(MSGS + convo), this.mem.loadMessages(convo), this.dek);
  }
  private writeContacts(): void {
    write(this.k("contacts"), this.mem.loadContacts(), this.dek);
  }
  private writeGroups(): void {
    write(this.k("groups"), this.mem.loadGroups(), this.dek);
  }
  /** 移除聯絡人/群組會連帶清掉其訊息的孤兒 reactions/deleted（見 MemoryStorage.pruneOrphans）。 */
  private writeOrphanSweep(): void {
    write(this.k("reactions"), this.mem.loadReactions(), this.dek);
    write(this.k("deleted"), this.mem.loadDeleted(), this.dek);
  }

  loadIdentity(): StoredIdentity | null {
    return this.mem.loadIdentity();
  }
  saveIdentity(identity: StoredIdentity): void {
    this.mem.saveIdentity(identity);
    write(this.k("identity"), identity, this.dek);
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
    this.writeRequests(); // 請求區也記 hint（ADR-0121）
  }
  updateContactName(pubkey: string, name: string): void {
    this.mem.updateContactName(pubkey, name);
    this.writeContacts();
    this.writeRequests(); // 請求區的顯示名也會被更新（ADR-0121）
  }
  setContactAlias(pubkey: string, alias: string | undefined): void {
    this.mem.setContactAlias(pubkey, alias); // ADR-0148：本地暱稱，僅寫聯絡人區
    this.writeContacts();
  }
  setContactNotifySound(pubkey: string, soundId: string | undefined): void {
    this.mem.setContactNotifySound(pubkey, soundId); // ADR-0149：依聯絡人通知音效
    this.writeContacts();
  }
  updateContactAvatar(pubkey: string, avatar: string | undefined): void {
    this.mem.updateContactAvatar(pubkey, avatar); // ADR-0154：對方廣播的頭像
    this.writeContacts();
    this.writeRequests(); // 請求區的人也認得出臉（同名稱，ADR-0121）
  }
  updateContactTitle(pubkey: string, title: string | undefined): void {
    this.mem.updateContactTitle(pubkey, title); // ADR-0158：對方廣播的企業頭銜
    this.writeContacts();
    this.writeRequests();
  }
  loadSelfAvatar(): string | null {
    return this.mem.loadSelfAvatar();
  }
  saveSelfAvatar(avatar: string | undefined): void {
    this.mem.saveSelfAvatar(avatar);
    write(this.k("selfAvatar"), avatar ?? null, this.dek); // ADR-0154
  }
  loadSelfTitle(): string | null {
    return this.mem.loadSelfTitle();
  }
  saveSelfTitle(title: string | undefined): void {
    this.mem.saveSelfTitle(title);
    write(this.k("selfTitle"), title ?? null, this.dek); // ADR-0158
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
    write(this.k("blocked"), this.mem.loadBlocked(), this.dek);
    this.writeRequests(); // 封鎖請求者＝連請求一起清（ADR-0121）
    void this.archive?.remove(contact.pubkey);
  }

  // ── 訊息請求（ADR-0121）────────────────────────────────────────────────
  private writeRequests(): void {
    write(this.k("requests"), this.mem.loadRequests(), this.dek);
  }
  addRequest(contact: StoredContact): void {
    this.mem.addRequest(contact);
    this.writeRequests();
  }
  removeRequest(pubkey: string): void {
    this.mem.removeRequest(pubkey);
    this.writeRequests();
  }
  loadRequests(): StoredContact[] {
    return this.mem.loadRequests();
  }
  unblockContact(pubkey: string): void {
    this.mem.unblockContact(pubkey);
    write(this.k("blocked"), this.mem.loadBlocked(), this.dek);
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
    // ADR-0126：上限＝封存門檻（不再刪除）。調整後即刻對所有對話重新封存溢出——**透過本層的
    // writer**（`this.mem` 的 writer 未掛，見 attachArchive 註解）。裁切後的落地由 writer 的
    // onTrim＝writeConvo 完成。無封存（writer 未掛）→ 不裁切（ADR-0111 紅線）。
    for (const convo of Object.keys(this.mem.exportSnapshot().messages)) this.writer?.schedule(convo);
  }
  loadReadAt(): Record<string, number> {
    return this.mem.loadReadAt();
  }
  setReadAt(convoKey: string, at: number): void {
    this.mem.setReadAt(convoKey, at);
    write(this.k("readAt"), this.mem.loadReadAt(), this.dek);
  }
  loadReactions(): StoredReaction[] {
    return this.mem.loadReactions();
  }
  addReaction(reaction: StoredReaction): void {
    this.mem.addReaction(reaction);
    write(this.k("reactions"), this.mem.loadReactions(), this.dek);
  }
  markDeleted(messageId: string): void {
    this.mem.markDeleted(messageId);
    write(this.k("deleted"), this.mem.loadDeleted(), this.dek);
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
    write(this.k("bootstrapList"), list, this.dek);
  }
  loadCustomAssets(): CustomAsset[] {
    return this.mem.loadCustomAssets();
  }
  saveCustomAssets(list: CustomAsset[]): void {
    this.mem.saveCustomAssets(list);
    write(this.k("customAssets"), list, this.dek); // ADR-0220：以 dek 加密落地
  }
  loadAssetBlobs(): AssetBlob[] {
    return this.mem.loadAssetBlobs();
  }
  saveAssetBlobs(list: AssetBlob[]): void {
    this.mem.saveAssetBlobs(list);
    write(this.k("assetBlobs"), list, this.dek); // ADR-0223：以 dek 加密落地
  }
  loadAssetTombstones(): AssetTombstone[] {
    return this.mem.loadAssetTombstones();
  }
  saveAssetTombstones(list: AssetTombstone[]): void {
    this.mem.saveAssetTombstones(list);
    write(this.k("assetTombstones"), list, this.dek); // ADR-0224：以 dek 加密落地
  }
  exportSnapshot(): StorageSnapshot {
    return this.mem.exportSnapshot();
  }
  importSnapshot(s: StorageSnapshot): void {
    this.mem.importSnapshot(s);
    for (const [key, value] of Object.entries(this.mem.exportSnapshot())) {
      if (key === "messages") continue;
      write(this.k(key), value, this.dek);
    }
    for (const convo of Object.keys(s.messages)) this.writeConvo(convo);
  }
}
