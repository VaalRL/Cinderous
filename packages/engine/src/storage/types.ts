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

/**
 * 送出訊息的狀態（ADR-0058／0095）：送出中→（失敗）→已送中繼→已送達裝置→已讀。
 * `failed`＝外送匣重試耗盡或被明確拒收（ADR-0095）。
 */
export type MessageStatus = "sending" | "failed" | "sent" | "delivered" | "read";

/**
 * 狀態前進順序；只能往前推進、不得倒退（避免 read 被較晚到的 delivered 蓋掉）。
 * `failed` 排在 `sending` 之後、`sent` 之前——所以「傳送中→失敗」可推進，而失敗後若延遲
 * 送達成功仍能推進到 `sent`；反之較晚到的 `failed` 不會覆蓋已成功的 `sent`（ADR-0095）。
 */
export const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = {
  sending: 0,
  failed: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

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
  /** 送達/已讀狀態（自己送出的訊息才有意義；ADR-0058）。 */
  status?: MessageStatus;
  /**
   * 檔案附件（ADR-0093）：僅持久化 metadata，**不存位元組**。位元組走 P2P；收到後由使用者
   * 另存至選定路徑（`savedPath`）——App 不保管檔案本體。`savedPath` 為裝置本地語意，不跨裝置同步。
   */
  file?: StoredFileMeta;
  /**
   * 群組每成員回條（ADR-0095）：成員 pubkey → 該成員對此訊息的最高狀態（delivered/read）。
   * 僅自己送出的**小群**訊息才有（成員數 ≤ `GROUP_RECEIPT_COUNT_MAX`）；大群不記錄（連送達都不送）。
   * 名單制（≤5）用它顯示「誰已讀」；計數制（6–10）用它算「已讀 M/N」。
   */
  receipts?: Record<string, "delivered" | "read">;
}

/** 持久化的檔案附件 metadata（ADR-0093）：無位元組、無縮圖。 */
export interface StoredFileMeta {
  /** P2P 傳輸關聯 id（對應收發雙方的位元組傳輸與 metadata 訊息）。 */
  tid: string;
  name: string;
  size: number;
  mime: string;
  /** 使用者選定的本機儲存路徑（收檔另存後才有；瀏覽器下載無法得知則省略）。 */
  savedPath?: string;
}

/**
 * 群組回條只前進（delivered→read，不倒退、不重複）（ADR-0095）。
 * 無變更回 `undefined`；有變更回新的回條表（不就地改，供儲存層決定是否寫回）。
 */
export function advanceReceipt(
  current: Record<string, "delivered" | "read"> | undefined,
  member: string,
  type: "delivered" | "read",
): Record<string, "delivered" | "read"> | undefined {
  const prev = current?.[member];
  if (prev === type || (prev === "read" && type === "delivered")) return undefined;
  return { ...(current ?? {}), [member]: type };
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
  /** 更新聯絡人顯示名稱（收到對方加密個人檔時；ADR-0061）。 */
  updateContactName(pubkey: string, name: string): void;
  /** 移除聯絡人並清除其對話訊息。 */
  removeContact(pubkey: string): void;
  /**
   * 身分輪替（ADR-0052）：把舊 npub `from` 的對話歷史與群組成員資格接續到新 npub `to`。
   * 移動 1:1 訊息（重寫 `contact`、併入 `to` 的對話、以 id 去重、依時間排序、遵守每對話上限）、
   * 更新各群組 `members`（from→to 去重）、改寫群組訊息的 `sender` 標籤（from→to，維持歷史歸屬），
   * 並移除舊聯絡人條目（`to` 的聯絡人由名冊對帳補上）。
   */
  remapContact(from: string, to: string): void;
  /** 封鎖某身分（會一併移出聯絡人），並記入封鎖名單。 */
  blockContact(contact: StoredContact): void;
  /** 解除封鎖（僅移出封鎖名單；如需再次往來須重新加好友）。 */
  unblockContact(pubkey: string): void;
  /** 已封鎖的身分清單。 */
  loadBlocked(): StoredContact[];
  loadMessages(contactPubkey: string): StoredMessage[];
  appendMessage(message: StoredMessage): void;
  /** 只往前推進某訊息的送達/已讀狀態（ADR-0058）；訊息不存在或狀態不前進則忽略。 */
  setMessageStatus(contactPubkey: string, messageId: string, status: MessageStatus): void;
  /** 記錄某檔案訊息收檔後的本機儲存路徑（ADR-0093）；訊息不存在或無 file 則忽略。 */
  setFileSavedPath(contactPubkey: string, messageId: string, savedPath: string): void;
  /**
   * 記錄群組某成員對某訊息的回條（ADR-0095）；只前進（delivered→read，不倒退）。
   * 訊息不存在則忽略。回傳更新後的回條表（供 UI 立即渲染）；無變更回 undefined。
   */
  setMessageReceipt(
    convoKey: string,
    messageId: string,
    member: string,
    type: "delivered" | "read",
  ): Record<string, "delivered" | "read"> | undefined;
  /** 設定每對話保留上限（ADR-0094）；`0`＝無上限。變更後即時對既有對話套用逐出。 */
  setMaxPerConvo(max: number): void;
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
  /** 每座營運資訊（ADR-0069）；舊存檔可能缺（形狀鏡像 core RelayEntry）。 */
  entries?: { url: string; accepting?: boolean; weight?: number; status?: "ok" | "draining" | "retired" }[];
  updatedAt: number;
}

/**
 * 整包狀態快照（B2 加密儲存基質，ADR-0054）：供 `TauriStorage` 與 Rust 加密 blob
 * 之間 export/import。`messages` 以對話鍵（聯絡人 pubkey 或群組 id）分流。
 */
export interface StorageSnapshot {
  identity: StoredIdentity | null;
  contacts: StoredContact[];
  blocked: StoredContact[];
  messages: Record<string, StoredMessage[]>;
  reactions: StoredReaction[];
  deleted: string[];
  groups: StoredGroup[];
  bootstrapList: StoredBootstrapList | null;
}
