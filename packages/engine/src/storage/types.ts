/** 本機持久化的資料型別（身分、聯絡人、訊息）。 */

import type { MessageArchive } from "./archive.js";

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
  /**
   * 本地暱稱（ADR-0148）：你私下給這位聯絡人取的顯示名，**恒優先於對方廣播名**顯示。
   * 純本地私有——**絕不廣播、絕不送給對方或中繼站**；僅隨你自己的加密快照/搬家捆包在你自己的
   * 裝置間流動。清除（空）即退回對方廣播名。不覆寫 `name`（廣播名獨立保存，供點擊切換/清除還原）。
   */
  alias?: string;
  /**
   * 依聯絡人通知音效（ADR-0149）：內建合成預設集的 id（見 desktop `CHIME_PRESETS`）。
   * 純本地偏好——**絕不廣播、絕不送給對方或中繼站**；僅隨你自己的加密快照/搬家捆包流動。
   * 未設＝播全域預設音效。指向已移除 id 時播放端自動退回經典叮咚。
   */
  notifySound?: string;
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

/** 持久化的檔案附件 metadata（ADR-0093）：**無原檔位元組**；圖片可另存小縮圖（ADR-0102）。 */
export interface StoredFileMeta {
  /** P2P 傳輸關聯 id（對應收發雙方的位元組傳輸與 metadata 訊息）。 */
  tid: string;
  name: string;
  size: number;
  mime: string;
  /**
   * 使用者選定的本機儲存路徑（收檔另存後才有；瀏覽器下載無法得知則省略）。
   * 使用者事後把檔案搬走時，UI 可重新指定並更新此值（ADR-0102）。
   */
  savedPath?: string;
  /**
   * 圖片縮圖（ADR-0102）：`data:` URL，**縮小後的衍生預覽圖，不是原檔**。
   * 為的是讓相簿與聊天內嵌縮圖能**跨 session 存活**——原檔位元組依然不存（ADR-0093 裁示不變）。
   * 上限見 {@link THUMB_MAX_BYTES}；超過就不存（寧可沒縮圖，也不讓儲存膨脹）。
   */
  thumb?: string;
}

// ── 圖片縮圖政策（ADR-0102）：常數放這裡當單一來源，避免桌面/行動端各自漂移 ──

/** 縮圖最長邊（像素）。夠當相簿格狀與聊天內嵌縮圖，不足以還原原圖。 */
export const THUMB_MAX_EDGE = 256;
/** 縮圖編碼品質（JPEG）。 */
export const THUMB_QUALITY = 0.7;
/** 縮圖位元組上限（data URL 字元數）；超過即不存縮圖。 */
export const THUMB_MAX_BYTES = 64 * 1024;

/**
 * 此 mime 是否該產縮圖（ADR-0102）。
 *
 * 只認點陣圖，**排除 SVG**——SVG 是可執行的標記（可含 script/外部參照），
 * 拿去餵 canvas 或當預覽圖都是不必要的攻擊面；本專案已有自製貼圖的 SVG 驗證管道，
 * 一般檔案附件不走那條路，故直接不產縮圖。
 */
export function isThumbnailable(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml";
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
  /** 設定/清除聯絡人本地暱稱（ADR-0148）；空字串或 undefined＝清除，退回廣播名。 */
  setContactAlias(pubkey: string, alias: string | undefined): void;
  /** 設定/清除依聯絡人通知音效（ADR-0149）；空字串或 undefined＝清除，退回全域預設。 */
  setContactNotifySound(pubkey: string, soundId: string | undefined): void;
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
  /**
   * 訊息請求（ADR-0121）：陌生人傳訊息給你 → 進這裡，**不是**聯絡人清單。
   *
   * 在你按下「接受」之前，對方不是聯絡人 → 不跳通知、不能 nudge 你、不訂閱他的上線狀態。
   */
  addRequest(contact: StoredContact): void;
  /** 移除一筆訊息請求（接受或刪除時）。 */
  removeRequest(pubkey: string): void;
  /** 待處理的訊息請求。 */
  loadRequests(): StoredContact[];
  loadMessages(contactPubkey: string): StoredMessage[];
  appendMessage(message: StoredMessage): void;
  /** 只往前推進某訊息的送達/已讀狀態（ADR-0058）；訊息不存在或狀態不前進則忽略。 */
  setMessageStatus(contactPubkey: string, messageId: string, status: MessageStatus): void;
  /**
   * 批次推進多則訊息的狀態（ADR-0110）：整個已讀水位**一次**完成，回傳實際有前進的 id。
   *
   * 已讀回條會把「時間不晚於目標」的自己訊息全標為已讀。逐則呼叫 `setMessageStatus` 時，
   * 持久化的儲存層每一次都要「載入整個對話 → 改一則 → 寫回整個對話」→ **O(k×n)**。
   * 實測 5 萬則歷史、50 則水位＝**3.5 秒主執行緒凍結**。
   */
  setMessageStatusBulk(contactPubkey: string, messageIds: string[], status: MessageStatus): string[];
  /** 記錄某檔案訊息收檔後的本機儲存路徑（ADR-0093）；訊息不存在或無 file 則忽略。 */
  setFileSavedPath(contactPubkey: string, messageId: string, savedPath: string): void;
  /** 記錄某圖片訊息的縮圖 data URL（ADR-0102）；超過上限或訊息不存在則忽略。 */
  setFileThumb(contactPubkey: string, messageId: string, thumb: string): void;
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
  /**
   * 批次記錄多則群訊對某成員的回條（ADR-0110）：群組**已讀水位**一次完成。
   * 與 {@link setMessageStatusBulk} 同理——逐則呼叫在持久化層是 O(k×n)。
   * 回傳有更新者的 `id → 完整回條表`（供 UI 立即渲染）。
   */
  setMessageReceiptBulk(
    convoKey: string,
    messageIds: string[],
    member: string,
    type: "delivered" | "read",
  ): Map<string, Record<string, "delivered" | "read">>;
  /** 設定每對話保留上限（ADR-0094）；`0`＝無上限。變更後即時對既有對話套用逐出。 */
  setMaxPerConvo(max: number): void;
  /**
   * 掛上訊息封存（ADR-0111）：超出熱區上限的舊訊息**移入封存**，而非刪除。
   *
   * **只有掛上後熱區才會被裁切。** 沒有封存就不裁切——絕不讓「封存不可用」變成「訊息被刪掉」。
   */
  attachArchive?(archive: MessageArchive): void;
  /** 已掛上的封存（歷史紀錄 UI 與匯出用）；未掛回 undefined。 */
  archiveOf?(): MessageArchive | undefined;
  /** 等待在途的封存搬移完成（關閉前／測試）。 */
  flushArchive?(): Promise<void>;
  /**
   * 已讀水位（ADR-0108）：對話 → 我已讀到的最新訊息時間（毫秒）。未出現＝未讀過任何訊息。
   * 未讀數由此推導（`!outgoing && at > readAt` 的則數），不是記憶體計數器 → 重載後仍在。
   */
  loadReadAt(): Record<string, number>;
  /** 推進某對話的已讀水位（ADR-0108）；**單調遞增**，倒退則忽略。 */
  setReadAt(convoKey: string, at: number): void;
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
  /** 訊息請求（ADR-0121）；舊快照沒有這個欄位 → 匯入時須容忍 `undefined`（退回 `[]`）。 */
  requests?: StoredContact[];
  messages: Record<string, StoredMessage[]>;
  reactions: StoredReaction[];
  deleted: string[];
  groups: StoredGroup[];
  bootstrapList: StoredBootstrapList | null;
  /**
   * 已讀水位（ADR-0108）：對話 → 已讀到的最新訊息時間（毫秒）。
   *
   * 舊快照沒有這個欄位 → 匯入時須容忍 `undefined`（退回 `{}`）。
   * 隨**配對搬家**（ADR-0072）一起搬到新裝置是刻意的；但它**不會**進雲端快照
   * ——那用的是另一個型別（`CloudSnapshotContent`），已讀狀態不上中繼（ADR-0108 明確劃線）。
   */
  readAt?: Record<string, number>;
}
