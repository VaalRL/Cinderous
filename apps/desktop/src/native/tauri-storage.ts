// 加密儲存基質（B2，ADR-0054）：同步 AppStorage 介面，內層包一個 MemoryStorage 作
// 即時讀寫層；開機 async `hydrate()` 從 Rust 加密 blob（store_load）灌入，寫入即更新
// 記憶體 + **防抖**持久化（store_save）。同步介面不變＝後端零改（解 async/sync 摩擦）。

import { invoke } from "@tauri-apps/api/core";
import { MemoryStorage } from "../storage/memory.js";
import type {
  AppStorage,
  StoredBootstrapList,
  StoredContact,
  StoredGroup,
  StoredIdentity,
  StoredMessage,
  StoredReaction,
} from "../storage/types.js";

/** 加密 blob 的載入/儲存管道（可注入以利測試）。 */
export interface StoreIo {
  load(namespace: string): Promise<string | null>;
  save(namespace: string, json: string): Promise<void>;
}

/** 產線 IO：走 Rust `store_load`/`store_save` IPC（AES-256-GCM 加密落地）。 */
export const tauriStoreIo: StoreIo = {
  load: (namespace) => invoke<string | null>("store_load", { namespace }),
  save: (namespace, json) => invoke("store_save", { namespace, json }),
};

const SAVE_DEBOUNCE_MS = 250;

export class TauriStorage implements AppStorage {
  private readonly mem = new MemoryStorage();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;

  constructor(
    private readonly namespace: string,
    private readonly io: StoreIo = tauriStoreIo,
  ) {}

  /** 開機一次：從加密 blob 載入既有狀態（建後端前呼叫）。 */
  async hydrate(): Promise<void> {
    const json = await this.io.load(this.namespace);
    if (json) {
      try {
        this.mem.importSnapshot(JSON.parse(json));
      } catch {
        /* 快照毀損：視為空，避免整個載入失敗 */
      }
    }
  }

  /** 立即持久化（取消防抖、馬上寫），供關閉前 flush 減少末段資料遺失。 */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (!this.pending) return;
    this.pending = false;
    await this.io.save(this.namespace, JSON.stringify(this.mem.exportSnapshot()));
  }

  private persist(): void {
    this.pending = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.pending = false;
      void this.io.save(this.namespace, JSON.stringify(this.mem.exportSnapshot()));
    }, SAVE_DEBOUNCE_MS);
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
    this.persist();
  }
  addContact(contact: StoredContact): void {
    this.mem.addContact(contact);
    this.persist();
  }
  updateContactRelay(pubkey: string, relayUrl: string | undefined): void {
    this.mem.updateContactRelay(pubkey, relayUrl);
    this.persist();
  }
  removeContact(pubkey: string): void {
    this.mem.removeContact(pubkey);
    this.persist();
  }
  remapContact(from: string, to: string): void {
    this.mem.remapContact(from, to);
    this.persist();
  }
  blockContact(contact: StoredContact): void {
    this.mem.blockContact(contact);
    this.persist();
  }
  unblockContact(pubkey: string): void {
    this.mem.unblockContact(pubkey);
    this.persist();
  }
  appendMessage(message: StoredMessage): void {
    this.mem.appendMessage(message);
    this.persist();
  }
  addReaction(reaction: StoredReaction): void {
    this.mem.addReaction(reaction);
    this.persist();
  }
  markDeleted(messageId: string): void {
    this.mem.markDeleted(messageId);
    this.persist();
  }
  saveGroup(group: StoredGroup): void {
    this.mem.saveGroup(group);
    this.persist();
  }
  removeGroup(id: string): void {
    this.mem.removeGroup(id);
    this.persist();
  }
  saveBootstrapList(doc: StoredBootstrapList): void {
    this.mem.saveBootstrapList(doc);
    this.persist();
  }
}
