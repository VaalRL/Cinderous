// 加密儲存基質（B2，ADR-0054）：同步 AppStorage 介面，內層包一個 MemoryStorage 作
// 即時讀寫層；開機 async `hydrate()` 從 Rust 加密 blob（store_load）灌入，寫入即更新
// 記憶體 + **防抖**持久化（store_save）。同步介面不變＝後端零改（解 async/sync 摩擦）。

import { invoke } from "@tauri-apps/api/core";
import { MemoryStorage } from "@cinder/engine";
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
} from "@cinder/engine";

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

  constructor(
    private readonly namespace: string,
    private readonly io: StoreIo = tauriStoreIo,
    /** 每對話保留上限（ADR-0094）；`0`＝無上限（預設）。 */
    maxPerConvo = 0,
  ) {
    this.mem = new MemoryStorage(maxPerConvo);
  }

  /** 每對話保留上限（ADR-0094）：委派記憶體層並持久化（逐出後的結果需寫回）。 */
  setMaxPerConvo(max: number): void {
    this.mem.setMaxPerConvo(max);
    for (const convo of Object.keys(this.mem.exportSnapshot().messages)) this.persist(MSGS + convo);
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
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.writeDirty();
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

  private async writeDirty(): Promise<void> {
    const parts = [...this.dirty];
    this.dirty.clear();
    const snap = this.mem.exportSnapshot();
    for (const part of parts) {
      if (part === META) {
        await this.io.savePart(this.namespace, META, JSON.stringify(metaOf(snap)));
        continue;
      }
      const convo = part.slice(MSGS.length);
      const msgs = snap.messages[convo];
      // 對話已被移除（封鎖/刪好友/退群）→ 刪掉它的部位檔，別留下孤兒。
      if (!msgs) await this.io.removePart(this.namespace, part);
      else await this.io.savePart(this.namespace, part, JSON.stringify(msgs));
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
  removeContact(pubkey: string): void {
    this.mem.removeContact(pubkey);
    this.persist(META);
    this.persist(MSGS + pubkey);
  }
  remapContact(from: string, to: string): void {
    this.mem.remapContact(from, to);
    this.persistAll();
  }
  blockContact(contact: StoredContact): void {
    this.mem.blockContact(contact);
    this.persist(META);
    this.persist(MSGS + contact.pubkey);
  }
  unblockContact(pubkey: string): void {
    this.mem.unblockContact(pubkey);
    this.persist(META);
  }
  appendMessage(message: StoredMessage): void {
    this.mem.appendMessage(message);
    this.persist(MSGS + message.contact);
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
  }
  saveBootstrapList(doc: StoredBootstrapList): void {
    this.mem.saveBootstrapList(doc);
    this.persist(META);
  }
}
