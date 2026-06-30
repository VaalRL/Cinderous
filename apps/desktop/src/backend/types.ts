import type { PubkeyHex } from "@nostr-buddy/core";

/** 使用者可見狀態（避開商標，以中文呈現於 UI）。 */
export type Status = "online" | "away" | "busy" | "offline";

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

export interface ChatMessage {
  id: string;
  /** 是否為自己送出。 */
  outgoing: boolean;
  text: string;
  /** 毫秒時間戳。 */
  at: number;
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
  sendMessage(to: PubkeyHex, text: string): void;
  sendTyping(to: PubkeyHex): void;
  sendNudge(to: PubkeyHex): void;
  stop(): void;
}
