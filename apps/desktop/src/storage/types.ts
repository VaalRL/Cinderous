/** 本機持久化的資料型別（身分、聯絡人、訊息）。 */

export interface StoredIdentity {
  /** NIP-19 nsec（私鑰）。之後 Tauri 版改存 OS 金鑰庫。 */
  nsec: string;
  name: string;
}

export interface StoredContact {
  pubkey: string;
  name: string;
}

export interface StoredMessage {
  id: string;
  contact: string;
  outgoing: boolean;
  text: string;
  at: number;
  /** 限時訊息到期時間（毫秒）；一般訊息省略。 */
  expiresAt?: number;
}

export interface StoredReaction {
  /** 回應事件自身的 id（去重用）。 */
  id: string;
  messageId: string;
  emoji: string;
  mine: boolean;
}

/**
 * 前端本機儲存抽象。目前提供記憶體與 localStorage 實作；
 * Tauri 版之後以相同介面接原生 SQLite（SQLCipher）。
 */
export interface AppStorage {
  loadIdentity(): StoredIdentity | null;
  saveIdentity(identity: StoredIdentity): void;
  loadContacts(): StoredContact[];
  addContact(contact: StoredContact): void;
  loadMessages(contactPubkey: string): StoredMessage[];
  appendMessage(message: StoredMessage): void;
  loadReactions(): StoredReaction[];
  addReaction(reaction: StoredReaction): void;
  /** 標記某訊息為已收回（NIP-09）。 */
  markDeleted(messageId: string): void;
  /** 已收回的訊息 id 集合。 */
  loadDeleted(): string[];
}
