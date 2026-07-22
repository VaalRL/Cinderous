// 加密儲存基質（B2，ADR-0054）：同步 AppStorage 介面，內層包一個 MemoryStorage 作
// 即時讀寫層；開機 async `hydrate()` 從 Rust 加密 blob（store_load）灌入，寫入即更新
// 記憶體 + **防抖**持久化（store_save）。同步介面不變＝後端零改（解 async/sync 摩擦）。

import { invoke } from "@tauri-apps/api/core";
import type { AssetBlob, AssetTombstone, CustomAsset } from "@cinderous/core";
import { ArchiveWriter, MemoryStorage, type MessageArchive } from "@cinderous/engine";
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
} from "@cinderous/engine";

/** 加密儲存的載入/儲存管道（可注入以利測試）。 */
export interface StoreIo {
  /** 舊格式：整包快照。**僅供一次性遷移**（ADR-0110）。 */
  load(namespace: string): Promise<string | null>;
  save(namespace: string, json: string): Promise<void>;
  /** 分部位（ADR-0110）：part → JSON。 */
  loadParts(namespace: string): Promise<Record<string, string>>;
  savePart(namespace: string, part: string, json: string): Promise<void>;
  removePart(namespace: string, part: string): Promise<void>;
}

/** 產線 IO：走 Rust IPC（AES-256-GCM 加密落地）。 */
export const tauriStoreIo: StoreIo = {
  load: (namespace) => invoke<string | null>("store_load", { namespace }),
  save: (namespace, json) => invoke("store_save", { namespace, json }),
  loadParts: (namespace) => invoke<Record<string, string>>("store_load_parts", { namespace }),
  savePart: (namespace, part, json) => invoke("store_save_part", { namespace, part, json }),
  removePart: (namespace, part) => invoke("store_remove_part", { namespace, part }),
};

const SAVE_DEBOUNCE_MS = 250;
/** 寫入失敗後的重試間隔（ADR-0119）。 */
const RETRY_DELAY_MS = 3_000;

/**
 * 持久化失敗的回呼（ADR-0119）：讓 UI 能提醒使用者「資料沒存進去」。
 * 比照 `local.ts` 的 `onStorageQuota`——磁碟滿/權限錯誤不該是靜默的。
 */
let storeFailureHandler: (() => void) | undefined;
export function onStoreFailure(fn: (() => void) | undefined): void {
  storeFailureHandler = fn;
}

/** 非訊息狀態（身分/聯絡人/群組/回應…）合為一個部位——它們都很小。 */
const META = "meta";
const MSGS = "msgs.";

/** 快照中「非訊息」的部分（都很小，合為一個 meta 部位）。 */
function metaOf(snap: StorageSnapshot): Omit<StorageSnapshot, "messages"> {
  const { messages: _drop, ...meta } = snap;
  return meta;
}

/** 由分部位還原完整快照（缺任何部位都以空值補上，單一部位毀損不影響其餘）。 */
function snapshotFromParts(parts: Record<string, string>): StorageSnapshot {
  const empty: StorageSnapshot = {
    identity: null,
    contacts: [],
    blocked: [],
    messages: {},
    reactions: [],
    deleted: [],
    groups: [],
    bootstrapList: null,
  };
  let snap = empty;
  const metaJson = parts[META];
  if (metaJson) {
    try {
      snap = { ...empty, ...(JSON.parse(metaJson) as Omit<StorageSnapshot, "messages">), messages: {} };
    } catch {
      /* meta 毀損：其餘部位仍載入 */
    }
  }
  for (const [part, json] of Object.entries(parts)) {
    if (!part.startsWith(MSGS)) continue;
    try {
      snap.messages[part.slice(MSGS.length)] = JSON.parse(json) as StoredMessage[];
    } catch {
      /* 單一對話毀損：略過，不拖垮其他對話 */
    }
  }
  return snap;
}

export class TauriStorage implements AppStorage {
  private readonly mem: MemoryStorage;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** 待寫入的部位（ADR-0110）：只重寫變動的那些。 */
  private readonly dirty = new Set<string>();
  /** 封存（ADR-0111）：超出熱區的舊訊息移入，而非刪除。未掛＝不裁切熱區。 */
  private writer: ArchiveWriter | undefined;
  private archive: MessageArchive | undefined;

  constructor(
    private readonly namespace: string,
    private readonly io: StoreIo = tauriStoreIo,
    /** 每對話保留上限（ADR-0094）；`0`＝無上限（預設）。 */
    maxPerConvo = 0,
  ) {
    this.mem = new MemoryStorage(maxPerConvo);
  }

  /**
   * 掛上封存（ADR-0111）。**只有掛上後熱區才會被裁切**——沒有封存就不裁切，
   * 絕不讓「封存不可用」變成「訊息被刪掉」。
   */
  attachArchive(archive: MessageArchive): void {
    this.archive = archive;
    this.writer = new ArchiveWriter(this.mem, archive, (convo) => this.persist(MSGS + convo));
  }
  archiveOf(): MessageArchive | undefined {
    return this.archive;
  }
  /** 等待在途的封存搬移完成（關閉前／測試）。 */
  async flushArchive(): Promise<void> {
    await this.writer?.flush();
  }

  /** 每對話保留上限（ADR-0094）：委派記憶體層並持久化（逐出後的結果需寫回）。 */
  setMaxPerConvo(max: number): void {
    this.mem.setMaxPerConvo(max);
    // ADR-0126：上限＝封存門檻（不再刪除）。調整後即刻重新封存溢出（透過本層 writer；裁切落地
    // 由 onTrim＝persist 完成）。無封存 → 不裁切（ADR-0111 紅線）。
    for (const convo of Object.keys(this.mem.exportSnapshot().messages)) this.writer?.schedule(convo);
  }

  /**
   * 開機一次：載入既有狀態（建後端前呼叫）。
   *
   * 優先讀分部位（ADR-0110）；沒有部位時退回**舊的整包快照**並就地遷移
   * ——舊版使用者的資料不能因為換格式而消失。
   */
  async hydrate(): Promise<void> {
    const parts = await this.io.loadParts(this.namespace);
    if (Object.keys(parts).length > 0) {
      this.mem.importSnapshot(snapshotFromParts(parts));
      return;
    }
    const legacy = await this.io.load(this.namespace);
    if (!legacy) return;
    try {
      this.mem.importSnapshot(JSON.parse(legacy) as StorageSnapshot);
    } catch {
      return; // 快照毀損：視為空，避免整個載入失敗
    }
    await this.writeAllParts(); // 遷移：把舊整包拆成部位落地（舊檔留著當備份）
  }

  /** 立即持久化（取消防抖、馬上寫），供關閉前 flush 減少末段資料遺失。 */
  /** 立即持久化。回傳是否全部成功（失敗的部位仍在 `dirty`，會被重試）。 */
  async flush(): Promise<boolean> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.writeDirty();
    return this.dirty.size === 0;
  }

  /**
   * 標記某部位待寫並排程防抖寫入（ADR-0110）。
   *
   * 舊做法每次都把**整個**儲存序列化＋加密＋寫檔——O(總量)，只因為改了一則訊息的狀態。
   * 實測 10 萬則＝每次 35ms 序列化 ＋ ~10MB 加密 ＋ ~10MB 寫檔，每 250ms 一次。
   * 現在只重寫**變動的**部位，成本與總歷史長度無關。
   */
  private persist(part: string): void {
    this.dirty.add(part);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.writeDirty();
    }, SAVE_DEBOUNCE_MS);
  }

  /** 影響面跨對話（身分輪替）→ 全部重寫。極少發生。 */
  private persistAll(): void {
    this.dirty.add(META);
    for (const convo of Object.keys(this.mem.exportSnapshot().messages)) this.dirty.add(MSGS + convo);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.writeDirty();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * 寫出待寫部位。
   *
   * **寫入失敗不得靜默遺失**（ADR-0119）。舊版在寫入**之前**就 `dirty.clear()`，而呼叫端是
   * `void this.writeDirty()`（無 catch）——磁碟滿／IPC 失敗時：待寫集合已清空、迴圈在第一個
   * 失敗處中斷（連帶丟掉後面所有部位）、無重試、無通知。**使用者以為訊息存了，重開就沒了。**
   *
   * 現在：逐部位 try/catch；失敗的**放回 dirty**、排程重試、並通知 UI（比照 `local.ts` 對
   * `QuotaExceededError` 的處理）。一個部位失敗不影響其他部位。
   */
  private async writeDirty(): Promise<void> {
    const parts = [...this.dirty];
    this.dirty.clear();
    const snap = this.mem.exportSnapshot();
    let failed = false;
    for (const part of parts) {
      try {
        if (part === META) {
          await this.io.savePart(this.namespace, META, JSON.stringify(metaOf(snap)));
          continue;
        }
        const convo = part.slice(MSGS.length);
        const msgs = snap.messages[convo];
        // 對話已被移除（封鎖/刪好友/退群）→ 刪掉它的部位檔，別留下孤兒。
        if (!msgs) await this.io.removePart(this.namespace, part);
        else await this.io.savePart(this.namespace, part, JSON.stringify(msgs));
      } catch (e) {
        // 放回待寫集合：資料仍在記憶體，下一次 flush 會再試。**絕不當作已寫入。**
        this.dirty.add(part);
        failed = true;
        console.warn(`[storage] 部位 ${part} 寫入失敗（將重試）：`, e);
      }
    }
    if (failed) {
      storeFailureHandler?.();
      // 重排一次重試（指數退避交給呼叫端的下一次 persist；這裡只保證不會就此遺忘）。
      if (!this.saveTimer) {
        this.saveTimer = setTimeout(() => {
          this.saveTimer = undefined;
          void this.writeDirty();
        }, RETRY_DELAY_MS);
      }
    }
  }

  private async writeAllParts(): Promise<void> {
    const snap = this.mem.exportSnapshot();
    await this.io.savePart(this.namespace, META, JSON.stringify(metaOf(snap)));
    for (const [convo, msgs] of Object.entries(snap.messages)) {
      await this.io.savePart(this.namespace, MSGS + convo, JSON.stringify(msgs));
    }
  }

  // ── 讀：委派記憶體層（同步、不持久化）──
  loadIdentity(): StoredIdentity | null {
    return this.mem.loadIdentity();
  }
  loadSelfAvatar(): string | null {
    return this.mem.loadSelfAvatar(); // ADR-0154：自己的廣播頭像（隨 META 部位落地）
  }
  loadSelfTitle(): string | null {
    return this.mem.loadSelfTitle(); // ADR-0158
  }
  loadContacts(): StoredContact[] {
    return this.mem.loadContacts();
  }
  loadBlocked(): StoredContact[] {
    return this.mem.loadBlocked();
  }
  loadMessages(contactPubkey: string): StoredMessage[] {
    return this.mem.loadMessages(contactPubkey);
  }
  loadReactions(): StoredReaction[] {
    return this.mem.loadReactions();
  }
  loadDeleted(): string[] {
    return this.mem.loadDeleted();
  }
  loadGroups(): StoredGroup[] {
    return this.mem.loadGroups();
  }
  loadBootstrapList(): StoredBootstrapList | null {
    return this.mem.loadBootstrapList();
  }

  // ── 寫：委派 + 防抖持久化 ──
  saveIdentity(identity: StoredIdentity): void {
    this.mem.saveIdentity(identity);
    this.persist(META);
  }
  addContact(contact: StoredContact): void {
    this.mem.addContact(contact);
    this.persist(META);
  }
  updateContactRelay(pubkey: string, relayUrl: string | undefined): void {
    this.mem.updateContactRelay(pubkey, relayUrl);
    this.persist(META);
  }
  updateContactName(pubkey: string, name: string): void {
    this.mem.updateContactName(pubkey, name);
    this.persist(META);
  }
  setContactAlias(pubkey: string, alias: string | undefined): void {
    this.mem.setContactAlias(pubkey, alias); // ADR-0148：本地暱稱，隨加密 blob 落地
    this.persist(META);
  }
  setContactNotifySound(pubkey: string, soundId: string | undefined): void {
    this.mem.setContactNotifySound(pubkey, soundId); // ADR-0149：依聯絡人通知音效
    this.persist(META);
  }
  updateContactAvatar(pubkey: string, avatar: string | undefined): void {
    this.mem.updateContactAvatar(pubkey, avatar); // ADR-0154：對方廣播的頭像
    this.persist(META);
  }
  updateContactTitle(pubkey: string, title: string | undefined): void {
    this.mem.updateContactTitle(pubkey, title); // ADR-0158：對方廣播的企業頭銜
    this.persist(META);
  }
  saveSelfAvatar(avatar: string | undefined): void {
    this.mem.saveSelfAvatar(avatar); // ADR-0154
    this.persist(META);
  }
  saveSelfTitle(title: string | undefined): void {
    this.mem.saveSelfTitle(title); // ADR-0158
    this.persist(META);
  }
  removeContact(pubkey: string): void {
    this.mem.removeContact(pubkey);
    this.persist(META);
    this.persist(MSGS + pubkey);
    void this.archive?.remove(pubkey); // 封存也要清（ADR-0111）
  }
  remapContact(from: string, to: string): void {
    this.mem.remapContact(from, to);
    this.persistAll();
  }
  blockContact(contact: StoredContact): void {
    this.mem.blockContact(contact);
    this.persist(META);
    this.persist(MSGS + contact.pubkey);
    void this.archive?.remove(contact.pubkey);
  }
  unblockContact(pubkey: string): void {
    this.mem.unblockContact(pubkey);
    this.persist(META);
  }

  // 訊息請求（ADR-0121）。`metaOf()` ＝ 快照扣掉 messages → requests 自動落在 meta 部位。
  addRequest(contact: StoredContact): void {
    this.mem.addRequest(contact);
    this.persist(META);
  }
  removeRequest(pubkey: string): void {
    this.mem.removeRequest(pubkey);
    this.persist(META);
  }
  loadRequests(): StoredContact[] {
    return this.mem.loadRequests();
  }
  appendMessage(message: StoredMessage): void {
    this.mem.appendMessage(message);
    this.persist(MSGS + message.contact);
    this.writer?.schedule(message.contact); // 溢出滿一塊才搬（ADR-0111）
  }
  setMessageStatus(contactPubkey: string, messageId: string, status: MessageStatus): void {
    this.mem.setMessageStatus(contactPubkey, messageId, status);
    this.persist(MSGS + contactPubkey);
  }
  setFileSavedPath(contactPubkey: string, messageId: string, savedPath: string): void {
    this.mem.setFileSavedPath(contactPubkey, messageId, savedPath);
    this.persist(MSGS + contactPubkey);
  }
  setFileThumb(contactPubkey: string, messageId: string, thumb: string): void {
    this.mem.setFileThumb(contactPubkey, messageId, thumb);
    this.persist(MSGS + contactPubkey);
  }
  /** ADR-0110：整個已讀水位一次改完、**一次寫回**。 */
  setMessageStatusBulk(contactPubkey: string, messageIds: string[], status: MessageStatus): string[] {
    const changed = this.mem.setMessageStatusBulk(contactPubkey, messageIds, status);
    if (changed.length > 0) this.persist(MSGS + contactPubkey);
    return changed;
  }
  /** ADR-0110：群組已讀水位一次改完、**一次寫回**。 */
  setMessageReceiptBulk(
    convoKey: string,
    messageIds: string[],
    member: string,
    type: "delivered" | "read",
  ): Map<string, Record<string, "delivered" | "read">> {
    const out = this.mem.setMessageReceiptBulk(convoKey, messageIds, member, type);
    if (out.size > 0) this.persist(MSGS + convoKey);
    return out;
  }
  setMessageReceipt(
    convoKey: string,
    messageId: string,
    member: string,
    type: "delivered" | "read",
  ): Record<string, "delivered" | "read"> | undefined {
    const next = this.mem.setMessageReceipt(convoKey, messageId, member, type);
    this.persist(MSGS + convoKey);
    return next;
  }
  addReaction(reaction: StoredReaction): void {
    this.mem.addReaction(reaction);
    this.persist(META);
  }
  markDeleted(messageId: string): void {
    this.mem.markDeleted(messageId);
    this.persist(META);
  }
  findMessage(messageId: string): StoredMessage | undefined {
    return this.mem.findMessage(messageId);
  }
  loadReadAt(): Record<string, number> {
    return this.mem.loadReadAt();
  }
  /** 已讀水位（ADR-0108）：必須落地——否則重啟後未讀又全部冒出來，等於沒做。 */
  setReadAt(convoKey: string, at: number): void {
    this.mem.setReadAt(convoKey, at);
    this.persist(META);
  }
  saveGroup(group: StoredGroup): void {
    this.mem.saveGroup(group);
    this.persist(META);
  }
  removeGroup(id: string): void {
    this.mem.removeGroup(id);
    this.persist(META);
    this.persist(MSGS + id);
    void this.archive?.remove(id);
  }
  saveBootstrapList(doc: StoredBootstrapList): void {
    this.mem.saveBootstrapList(doc);
    this.persist(META);
  }
  loadCustomAssets(): CustomAsset[] {
    return this.mem.loadCustomAssets();
  }
  saveCustomAssets(list: CustomAsset[]): void {
    // ADR-0220：customAssets 屬快照非 messages → 隨 metaOf 落在 META 部位（Rust AES-256-GCM 加密）。
    this.mem.saveCustomAssets(list);
    this.persist(META);
  }
  loadAssetBlobs(): AssetBlob[] {
    return this.mem.loadAssetBlobs();
  }
  saveAssetBlobs(list: AssetBlob[]): void {
    // ADR-0223：assetBlobs 同屬快照非 messages → 隨 META 部位加密落地。
    this.mem.saveAssetBlobs(list);
    this.persist(META);
  }
  loadAssetTombstones(): AssetTombstone[] {
    return this.mem.loadAssetTombstones();
  }
  saveAssetTombstones(list: AssetTombstone[]): void {
    // ADR-0224：資產墓碑同屬快照非 messages → 隨 META 部位加密落地。
    this.mem.saveAssetTombstones(list);
    this.persist(META);
  }
}
