import type { CallMedia, CallState, Group, OutgoingFile, PubkeyHex, ReceivedFile } from "@nostr-buddy/core";

export type { Group };

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

/** 對話中的檔案附件（P2P 傳輸）。 */
export interface ChatFile {
  /** 傳輸 id（送出端用來對應進度）。 */
  id: string;
  name: string;
  mime: string;
  /** 位元組總數。 */
  size: number;
  /** 已傳送位元組（送出端進度）；收檔完成後等於 size。 */
  sent: number;
  /** 是否為對方傳來。 */
  incoming: boolean;
  /** 下載用的物件 URL（收檔完成後才有）。 */
  url?: string;
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
  /** 群訊發送者公鑰（群組訊息才有，供顯示暱稱）。 */
  sender?: PubkeyHex;
  /** 檔案附件（有值時此訊息為檔案而非文字）。 */
  file?: ChatFile;
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
  /** Relay pool（home + 外部座）各自的連線狀態；`stale`＝連續離線過久，hint 可能過期（ADR-0034/0036）。 */
  onRelayPool?(relays: { url: string; state: ConnectionState; home: boolean; stale: boolean }[]): void;
  /** P2P 送檔進度（`id` 對應 sendFile 回傳值；`sent`/`total` 為位元組）。 */
  onFileProgress?(contact: PubkeyHex, id: string, sent: number, total: number): void;
  /** 收到一個經 P2P 傳來的完整檔案。 */
  onFileReceived?(contact: PubkeyHex, file: ReceivedFile): void;
  /** 檔案傳輸錯誤。 */
  onFileError?(contact: PubkeyHex, reason: string): void;
  /** 群組清單更新（M9）。 */
  onGroups?(groups: Group[]): void;
  /** 通話狀態變化（M8；`peer` 為對象、null 表示無通話）。 */
  onCallState?(peer: PubkeyHex | null, state: CallState, media: CallMedia | null): void;
  /** 本端通話媒體串流（自我預覽；null 表示結束）。 */
  onCallLocalStream?(stream: MediaStream | null): void;
  /** 遠端通話媒體串流（播放；null 表示結束）。 */
  onCallRemoteStream?(stream: MediaStream | null): void;
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
  /** 以 WebRTC P2P 傳送檔案（不經中繼），回傳追蹤用的傳輸 id。 */
  sendFile?(to: PubkeyHex, file: OutgoingFile): string;
  /** 開啟對話時主動建立 P2P 通道（F5：讓輸入中等狀態卸載中繼）。 */
  connectPeer?(to: PubkeyHex): void;
  /** 建立群組（M9）：`memberPubkeys` 為其他成員的公鑰（既有聯絡人）。 */
  createGroup?(name: string, memberPubkeys: PubkeyHex[]): void;
  /** 對群組送出訊息（扇出給所有成員）。 */
  sendGroupMessage?(groupId: string, text: string): void;
  /** 離開群組。 */
  leaveGroup?(groupId: string): void;
  /** 發起語音/視訊通話（M8，媒體全程 P2P）。 */
  startCall?(to: PubkeyHex, media: CallMedia): void;
  /** 接聽目前來電。 */
  acceptCall?(): void;
  /** 拒接目前來電。 */
  rejectCall?(): void;
  /** 掛斷目前通話。 */
  hangupCall?(): void;
  /** 以 NIP-19 `npub`（可附 `@wss://…` relay hint，ADR-0034）新增聯絡人（僅真實 relay 後端支援）。 */
  addContact?(npub: string, relayUrl?: string): void;
  /** 移除聯絡人並清除對話。 */
  removeContact?(pubkey: PubkeyHex): void;
  /** 封鎖某聯絡人（移出清單、忽略其後續訊息）。 */
  blockContact?(pubkey: PubkeyHex): void;
  /** 解除封鎖。 */
  unblockContact?(pubkey: PubkeyHex): void;
  /** 自己的 `npub`（供分享/加好友；僅真實 relay 後端提供）。 */
  readonly selfNpub?: string;
  /** 分享用字串 `npub…@wss://…`（帶 relay hint；無 home relay 時同 npub）。 */
  readonly selfShareUri?: string;
  /** 自己的 `nsec` 私鑰（僅供本機身分備份；絕不外流；僅真實 relay 後端提供）。 */
  readonly selfNsec?: string;
  stop(): void;
}
