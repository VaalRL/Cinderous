/** 本機持久化的資料型別（身分、聯絡人、訊息）。 */

/**
 * 每對話持久化訊息上限（審查 P0-1）：超過即逐出最舊，避免單一對話的 JSON
 * 陣列無限膨脹撐爆 localStorage 配額（比照中繼站的每收件人上限）。視窗化已讓
 * UI 只渲染最近 N 則，故本地也只需保留近段歷史。
 */
export const MESSAGES_PER_CONVO = 1000;

export interface StoredIdentity {
  /** NIP-19 nsec（私鑰）。之後 Tauri 版改存 OS 金鑰庫。 */
  nsec: string;
  name: string;
}

export interface StoredContact {
  pubkey: string;
  name: string;
  /** 對方的 relay hint（ADR-0034 多中繼路由）；無 hint 時走自己的 home relay。 */
  relayUrl?: string;
}

export interface StoredMessage {
  id: string;
  contact: string;
  outgoing: boolean;
  text: string;
  at: number;
  /** 限時訊息到期時間（毫秒）；一般訊息省略。 */
  expiresAt?: number;
  /** 群訊發送者公鑰（群組訊息才有；1:1 省略）。 */
  sender?: string;
  /** 此訊息 @提及了自己（ADR-0050）：供重載後仍凸顯。 */
  mentionsMe?: boolean;
  /** 對話串回覆（ADR-0051）：所屬串的根訊息 id；無則為主頻道訊息。 */
  replyTo?: string;
}

export interface StoredGroup {
  id: string;
  name: string;
  admin: string;
  members: string[];
  /** 公告頻道（ADR-0049）：僅管理者可發文、成員唯讀。 */
  announce?: boolean;
  /** 組織名冊分發的群（ADR-0049）：由名冊對帳權威管理，區隔本機自建群以免誤刪。 */
  org?: boolean;
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
  /** 更新聯絡人的 relay hint（ADR-0035 自動學習）；undefined 表示清除。 */
  updateContactRelay(pubkey: string, relayUrl: string | undefined): void;
  /** 移除聯絡人並清除其對話訊息。 */
  removeContact(pubkey: string): void;
  /** 封鎖某身分（會一併移出聯絡人），並記入封鎖名單。 */
  blockContact(contact: StoredContact): void;
  /** 解除封鎖（僅移出封鎖名單；如需再次往來須重新加好友）。 */
  unblockContact(pubkey: string): void;
  /** 已封鎖的身分清單。 */
  loadBlocked(): StoredContact[];
  loadMessages(contactPubkey: string): StoredMessage[];
  appendMessage(message: StoredMessage): void;
  loadReactions(): StoredReaction[];
  addReaction(reaction: StoredReaction): void;
  /** 標記某訊息為已收回（NIP-09）。 */
  markDeleted(messageId: string): void;
  /** 已收回的訊息 id 集合。 */
  loadDeleted(): string[];
  /** 群組清單（M9）。 */
  loadGroups(): StoredGroup[];
  /** 新增或更新群組（以 id 為鍵）。 */
  saveGroup(group: StoredGroup): void;
  /** 移除群組（離開/解散）。 */
  removeGroup(id: string): void;
  /** last-known-good 引導 relay 清單（ADR-0039）；未採用過回傳 null。 */
  loadBootstrapList(): StoredBootstrapList | null;
  saveBootstrapList(doc: StoredBootstrapList): void;
}

/** 已採用的引導 relay 清單（ADR-0039）。 */
export interface StoredBootstrapList {
  relays: string[];
  updatedAt: number;
}
