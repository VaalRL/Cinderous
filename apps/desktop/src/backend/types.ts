import type { PubkeyHex } from "@nostr-buddy/core";

/** 使用者可見狀態（避開商標，以中文呈現於 UI）。 */
export type Status = "online" | "away" | "busy" | "offline";

/** 與中繼站的連線狀態（供顯示連線/重連中）。 */
export type ConnectionState = "connecting" | "online" | "offline";

export interface Contact {
  pubkey: PubkeyHex;
  name: string;
  status: Status;
  /** 個人狀態訊息（暱稱後方那行字）。 */
  statusMessage: string;
  /** 正在聆聽的音樂（空字串表示沒有）。 */
  nowPlaying: string;
}

export interface Self {
  pubkey: PubkeyHex;
  name: string;
  status: Status;
  statusMessage: string;
}

/** 已封鎖的身分（供設定/聯絡人視窗顯示與解除封鎖）。 */
export interface BlockedContact {
  pubkey: PubkeyHex;
  name: string;
}

export interface ChatMessage {
  id: string;
  /** 是否為自己送出。 */
  outgoing: boolean;
  text: string;
  /** 毫秒時間戳。 */
  at: number;
  /** 限時訊息到期時間（毫秒）；一般訊息省略。 */
  expiresAt?: number;
}

export interface ChatBackendEvents {
  /** 聯絡人清單或其狀態/音樂有更新時觸發。 */
  onContacts(contacts: Contact[]): void;
  /** 收到（或自己送出的）一則訊息。 */
  onMessage(contact: PubkeyHex, message: ChatMessage): void;
  /** 對方正在輸入中。 */
  onTyping(contact: PubkeyHex): void;
  /** 被某聯絡人戳了一下（Nudge）。 */
  onNudge(contact: PubkeyHex): void;
  /** 某訊息收到 emoji 回應（`mine` 表示是否為自己送出）。 */
  onReaction?(messageId: string, emoji: string, mine: boolean): void;
  /** 某訊息被收回（NIP-09），應顯示為「已收回」。 */
  onUnsend?(messageId: string): void;
  /** 封鎖名單有更新。 */
  onBlocked?(blocked: BlockedContact[]): void;
  /** 與中繼站的連線狀態改變。 */
  onConnection?(state: ConnectionState): void;
}

/**
 * 前端與通訊層之間的抽象。瀏覽器模式以記憶體 relay 實作；
 * 之後 Tauri 模式以相同介面接 IPC，UI 不需更動。
 */
export interface ChatBackend {
  readonly self: Self;
  start(handlers: ChatBackendEvents): void;
  setStatus(status: Status, message?: string): void;
  setNowPlaying(text: string): void;
  /** 送出訊息；`ttlSeconds` 設定時為限時訊息（閱後即焚，NIP-40 短期過期）。 */
  sendMessage(to: PubkeyHex, text: string, ttlSeconds?: number): void;
  sendTyping(to: PubkeyHex): void;
  sendNudge(to: PubkeyHex): void;
  /** 對某訊息送出 emoji 回應（NIP-25）。 */
  sendReaction?(to: PubkeyHex, messageId: string, emoji: string): void;
  /** 收回（刪除）自己送出的某訊息（NIP-09）。 */
  unsendMessage?(to: PubkeyHex, messageId: string): void;
  /** 以 NIP-19 `npub` 新增聯絡人（僅真實 relay 後端支援）。 */
  addContact?(npub: string): void;
  /** 移除聯絡人並清除對話。 */
  removeContact?(pubkey: PubkeyHex): void;
  /** 封鎖某聯絡人（移出清單、忽略其後續訊息）。 */
  blockContact?(pubkey: PubkeyHex): void;
  /** 解除封鎖。 */
  unblockContact?(pubkey: PubkeyHex): void;
  /** 自己的 `npub`（供分享/加好友；僅真實 relay 後端提供）。 */
  readonly selfNpub?: string;
  /** 自己的 `nsec` 私鑰（僅供本機身分備份；絕不外流；僅真實 relay 後端提供）。 */
  readonly selfNsec?: string;
  stop(): void;
}
