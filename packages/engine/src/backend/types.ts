import type {
  CallFailureReason,
  CallMedia,
  CallState,
  Group,
  OrgGroup,
  OrgMember,
  OrgPolicy,
  OrgRosterDoc,
  OrgWorkHours,
  OutgoingFile,
  PubkeyHex,
  ReceivedFile,
} from "@cinderous/core";
import type { MessageStatus } from "../storage/types.js";
import { inWorkHours } from "@cinderous/core";

export type { Group, OrgGroup, OrgMember, OrgPolicy, OrgRosterDoc, OrgWorkHours };
export type { MessageStatus };

/** 組織資訊（ADR-0157）：採用名冊時發給前端的公司設定摘要。 */
export interface OrgInfo {
  /** 公司名稱。 */
  org: string;
  /** 在世成員 pubkey（供「下班靜音組織通知」判定來源）。 */
  members: PubkeyHex[];
  /** 歡迎詞／基本規範。 */
  welcome?: string;
  /** 表定上下班時間。 */
  workHours?: OrgWorkHours;
}

/**
 * 下班自動靜音（ADR-0157）：非工時且來源為組織（企業同事 1:1／組織群組）→ 靜音（不彈通知、
 * 不響音效；未讀照常）。未設班表、上班時間內、或非組織來源皆不靜音。桌面與行動端共用（原本
 * 在桌面 App.tsx，ADR-0175 上移共用消除重複）。`minutesOfDay`＝當地時間的「時×60＋分」。
 */
export function shouldMuteOrgNotification(
  info: Pick<OrgInfo, "members" | "workHours"> | null,
  source: { senderContact?: string; orgGroup?: boolean },
  minutesOfDay: number,
): boolean {
  if (!info?.workHours) return false;
  if (inWorkHours(info.workHours, minutesOfDay)) return false;
  return source.orgGroup === true || (!!source.senderContact && info.members.includes(source.senderContact));
}

/** 使用者可見狀態（避開商標，以中文呈現於 UI）。 */
export type Status = "online" | "away" | "busy" | "offline";

/** 與中繼站的連線狀態（供顯示連線/重連中）。 */
export type ConnectionState = "connecting" | "online" | "offline";

export interface Contact {
  pubkey: PubkeyHex;
  /** 對方廣播的顯示名（ADR-0061）或短 npub 後備。 */
  name: string;
  /**
   * 本地暱稱（ADR-0148）：你私下取的名字。顯示恒優先於 `name`；有設時 UI 可點標頭在
   * 暱稱↔廣播名間切換。純本地私有，絕不廣播。未設＝顯示 `name`。
   */
  alias?: string;
  /**
   * 依聯絡人通知音效（ADR-0149）：合成預設集 id。純本地偏好，絕不廣播。
   * 未設＝全域預設音效；指向已移除 id 時播放端退回經典叮咚。
   */
  notifySound?: string;
  /**
   * 對方廣播的頭像（ADR-0154）：data URI 縮圖，收自加密個人檔（parse 側已過白名單與
   * 大小上限）。顯示優先序：本地覆寫（ADR-0077）＞此欄位＞生成頭像。
   */
  avatar?: string;
  /**
   * 對方廣播的企業頭銜（ADR-0158）：自填自述標註（≤24 字，收端已清洗）。
   * UI 以實心 `chip--role` 顯示，與私有標籤（outline chip）色彩區隔。
   */
  title?: string;
  status: Status;
  /** 個人狀態訊息（暱稱後方那行字）。 */
  statusMessage: string;
  /** 正在聆聽的音樂（空字串表示沒有）。 */
  nowPlaying: string;
}

/**
 * 聯絡人的顯示名（ADR-0148）：本地暱稱恒優先，未設才用對方廣播名/短 npub。
 * 兩端 UI 共用，確保「暱稱取代顯示名」在各處一致。
 */
export function contactLabel(c: { name: string; alias?: string }): string {
  return c.alias?.trim() || c.name;
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

/**
 * 訊息請求（ADR-0121）：陌生人傳訊息給你，但你還沒接受。
 *
 * **他不是聯絡人**——不跳通知、不能 nudge 你（震動）、看不到你的上線狀態、拿不到你的個人檔。
 */
export interface ContactRequest {
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
  /** 下載用的物件 URL（本 session 收/送到位元組時才有；重載後不留，ADR-0093）。 */
  url?: string;
  /** 收檔後使用者選定的本機儲存路徑（Tauri 另存；瀏覽器下載無法得知則省略，ADR-0093）。 */
  savedPath?: string;
  /** 圖片縮圖 data URL（ADR-0102）：跨 session 存活，讓相簿/內嵌縮圖在重載後仍在。 */
  thumb?: string;
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
  /** 此訊息 @提及了自己（ADR-0050）：UI 凸顯、可觸發通知。 */
  mentionsMe?: boolean;
  /** 對話串回覆（ADR-0051）：此訊息所屬串的根訊息 id；無則為主頻道訊息。 */
  replyTo?: string;
  /** 串回覆同時顯示於主對話（ADR-0232，仿 Slack「也傳到頻道」）；僅回覆有意義。 */
  alsoMain?: boolean;
  /** 檔案附件（有值時此訊息為檔案而非文字）。 */
  file?: ChatFile;
  /** 送達/已讀狀態（自己送出的訊息才有意義；ADR-0058/0095）。 */
  status?: MessageStatus;
  /**
   * 群組每成員回條（ADR-0095）：成員 pubkey → delivered/read。僅自己送出的小群訊息才有。
   * 名單制（≤5 人）用來顯示「誰已讀」；計數制（6–10 人）用來算「已讀 M/N」；大群不記錄。
   */
  receipts?: Record<string, "delivered" | "read">;
}

export interface ChatBackendEvents {
  /** 聯絡人清單或其狀態/音樂有更新時觸發。 */
  onContacts(contacts: Contact[]): void;
  /** 收到（或自己送出的）一則訊息。 */
  onMessage(contact: PubkeyHex, message: ChatMessage): void;
  /**
   * 啟動時一次回放某對話的完整歷史（批次，取代逐則 onMessage）。
   * 由前端一次寫入該對話、且不自動開窗——避免大量歷史造成 O(n²) 狀態更新與全開視窗。
   */
  onHistory?(contact: PubkeyHex, messages: ChatMessage[]): void;
  /** 對方正在輸入中。 */
  onTyping(contact: PubkeyHex): void;
  /** 被某聯絡人戳了一下（Nudge）。 */
  onNudge(contact: PubkeyHex): void;
  /** 某訊息收到 emoji 回應（`mine` 表示是否為自己送出）。 */
  onReaction?(messageId: string, emoji: string, mine: boolean): void;
  /** 某訊息被收回（NIP-09），應顯示為「已收回」。 */
  /** 訊息被收回；`traceless`＝無痕收回（ADR-0234）：UI 整行移除、不留「已收回」佔位。 */
  onUnsend?(messageId: string, traceless?: boolean): void;
  /** 自己送出的某訊息送達/已讀狀態更新（ADR-0058；含 `failed`，ADR-0095）。 */
  onMessageStatus?(contact: PubkeyHex, messageId: string, status: MessageStatus): void;
  /**
   * 未讀數更新（ADR-0108）：對話 → 未讀則數（僅含 > 0 者）。
   *
   * 由**儲存推導**（已讀水位之後的收訊則數），不是 UI 自行 +1／歸零的記憶體計數器
   * ——所以重新載入後未讀仍在。開機載入歷史後、收到新訊息時、水位推進時各發一次。
   */
  onUnread?(counts: Record<string, number>): void;
  /**
   * 群組某訊息的每成員回條更新（ADR-0095）：`receipts` 為成員 pubkey → delivered/read 的完整表。
   * 僅小群（≤10 人）會觸發；大群完全不記錄。
   */
  onMessageReceipts?(groupId: string, messageId: string, receipts: Record<string, "delivered" | "read">): void;
  /** 封鎖名單有更新。 */
  onBlocked?(blocked: BlockedContact[]): void;
  /** 訊息請求清單變動（ADR-0121）。UI 以此決定「不通知、不放進主對話清單」。 */
  onRequests?(requests: ContactRequest[]): void;
  /**
   * 跨裝置同步的「每對話靜音」集合變動（ADR-0242 階段③）：靜音狀態現由引擎同步（隨加密快照 LWW），
   * UI 以此更新顯示與 `shouldNotify`。開機與快照合併後皆會發。
   */
  onMutes?(convoIds: string[]): void;
  /** 與中繼站的連線狀態改變。 */
  onConnection?(state: ConnectionState): void;
  /**
   * 與某聯絡人的 P2P 直連狀態改變（ADR-0213）：`connected`＝資料通道開啟（直連可用）。
   * 對話標題列據此顯示連線品質晶片；P2P 失敗不影響文字訊息（走 relay）。
   */
  onPeerConnection?(contact: PubkeyHex, connected: boolean): void;
  /** Relay pool（home + 外部座）各自的連線狀態；`stale`＝連續離線過久，hint 可能過期（ADR-0034/0036）。 */
  onRelayPool?(relays: { url: string; state: ConnectionState; home: boolean; stale: boolean }[]): void;
  /** P2P 送檔進度（`id` 對應 sendFile 回傳值；`sent`/`total` 為位元組）。 */
  onFileProgress?(contact: PubkeyHex, id: string, sent: number, total: number): void;
  /**
   * 此裝置經 P2P 收到某檔案的**位元組**（ADR-0093）：前端據此跳「另存新檔」對話框，
   * 寫入使用者選定路徑後以 `setFileSavedPath` 回填。`messageId` 對應 `onMessage`/`onHistory`
   * 發出的檔案訊息（backend 已先建好該訊息，metadata-only）。App 不保管位元組本體。
   */
  onFileBytes?(contact: PubkeyHex, messageId: string, file: ReceivedFile): void;
  /** 某圖片訊息的縮圖已產生/更新（ADR-0102）：UI 據此即時顯示，不必等重載。 */
  onFileThumb?(contact: PubkeyHex, messageId: string, thumb: string): void;
  /**
   * 自訂 emoji blob 已收齊並入快取（ADR-0223 backfill）：backend 已驗整合性＋存進
   * `assetBlobs`，UI 據此重新讀快取、把先前的占位重繪為動畫。
   */
  onAssetCached?(hash: string): void;
  /**
   * 公司儲存槽存放到達（ADR-0161，企業主端）：名冊成員的存放位元組已收齊。
   * App 負責落盤（槽目錄＋索引），**不建聊天訊息、不跳通知**。
   */
  onSlotDeposit?(sender: PubkeyHex, deposit: { tid: string; name: string; mime: string; origin: string; bytes: Uint8Array }): void;
  /** 檔案傳輸錯誤。 */
  onFileError?(contact: PubkeyHex, reason: string): void;
  /** 群組清單更新（M9）。 */
  onGroups?(groups: Group[]): void;
  /** 企業政策更新（ADR-0048，來自組織名冊）：前端據此隱藏對應功能。 */
  onPolicy?(policy: OrgPolicy): void;
  /**
   * 組織資訊更新（ADR-0157，來自組織名冊）：公司名稱、在世成員（供下班靜音判定）、
   * 歡迎詞/基本規範、表定上下班時間。每次採用名冊時發出（含開機重放）。
   */
  onOrgInfo?(info: OrgInfo): void;
  /**
   * 入職金鑰託管到達（ADR-0163，管理者端）：公司帳號成員入職時把私鑰（E2E 加密給
   * 管理者）託管過來。App 持久化，供日後離職接管。權杖已驗、nsec 已對回成員 pubkey。
   */
  onOrgEscrow?(escrow: { pubkey: PubkeyHex; name: string; nsec: string; relayUrl: string }): void;
  /** 收到自己的雲端快照時回報其模式（ADR-0071）：App 於本機從未設定時採用（還原接續備份習慣）。 */
  onCloudSyncMode?(mode: "basic" | "full"): void;
  /**
   * 企業工作身分輪替（ADR-0052）：某聯絡人的舊 npub `from` 已由名冊宣告換為新 npub `to`，
   * 對話歷史與群組成員資格已接續。前端可提示「`name` 已更新金鑰」。
   */
  onIdentityRotated?(from: PubkeyHex, to: PubkeyHex, name: string): void;
  /** 通話狀態變化（M8；`peer` 為對象、null 表示無通話）。 */
  onCallState?(peer: PubkeyHex | null, state: CallState, media: CallMedia | null): void;
  /** 本端通話媒體串流（自我預覽；null 表示結束）。 */
  onCallLocalStream?(stream: MediaStream | null): void;
  /** 遠端通話媒體串流（播放；null 表示結束）。 */
  onCallRemoteStream?(stream: MediaStream | null): void;
  /**
   * 通話**連線失敗**（ADR-0243）：P2P 連不通/斷線時觸發，UI 據 `reason` 給可行動提示——
   * `unreachable`＝限制網路（對稱 NAT／嚴格防火牆）下無 TURN 退路，可改 Wi-Fi/其他網路重試；
   * `lost`＝已連上後斷線，可再撥。與 `onCallState('ended')` 一起發生（視窗關閉＋留下提示）。
   */
  onCallFailed?(peer: PubkeyHex, reason: CallFailureReason): void;
}

/**
 * 前端與通訊層之間的抽象。瀏覽器模式以記憶體 relay 實作；
 * 之後 Tauri 模式以相同介面接 IPC，UI 不需更動。
 */
export interface ChatBackend {
  readonly self: Self;
  start(handlers: ChatBackendEvents): void;
  setStatus(status: Status, message?: string): void;
  /** 隱身（ADR-0088）：開＝停止一切在線廣播（relay＋P2P），仍正常收發。僅真實 relay 後端支援。 */
  setInvisible?(invisible: boolean): void;
  setNowPlaying(text: string): void;
  /**
   * 更改顯示名稱（ADR-0144）：更新記憶體、落地本機（nsec 不明文，只更名）、把新名廣播給所有
   * 聯絡人（ADR-0061 profile）。未實作的後端（如部分示範）由呼叫端以本機狀態更新即可。
   */
  setSelfName?(name: string): void;
  /**
   * 設定/清除某聯絡人的**本地暱稱**（ADR-0148）：空字串或 undefined＝清除，退回廣播名。
   * 純本地私有——**不廣播、不送對方/中繼站**，只更新本機儲存並重發聯絡人清單。
   */
  setContactAlias?(pubkey: PubkeyHex, alias: string | undefined): void;
  /**
   * 設定/清除依聯絡人通知音效（ADR-0149）：`soundId` 為合成預設集 id，空/undefined＝清除，
   * 退回全域預設。純本地偏好——**不廣播、不送對方/中繼站**。
   */
  setContactNotifySound?(pubkey: PubkeyHex, soundId: string | undefined): void;
  /**
   * 設定某對話（聯絡人或群組）的**每對話靜音**（ADR-0217/0242 階段③）：現由引擎跨裝置同步
   * （隨加密快照逐鍵 LWW）。設定後發 `onMutes`；隨快照傳到其他裝置。純本地偏好、不送對方/中繼站內容。
   */
  setConvoMuted?(convoId: string, muted: boolean): void;
  /** 目前靜音的對話集合（ADR-0242 階段③）：供 UI 初始化。 */
  mutedConvos?(): string[];
  /** 一次性遷移（ADR-0242 階段③）：把本機舊有靜音種進同步設定，僅在鍵不存在時（不蓋遠端解除靜音）。 */
  seedMutesIfAbsent?(convoIds: string[]): void;
  /**
   * 啟用前向保密（ADR-0245，opt-in、預設關）：生成加密子鑰 EK、發佈 kind 10040 公告、訂閱聯絡人 EK。
   * 之後送訊息加密到收件人當前 EK（不知則退回身分）；收訊多鑰解封並學對方 EK。冪等。
   */
  enableFs?(): void;
  /** 手動更換加密金鑰（ADR-0245）：生成新 EK、發新 10040；保留舊 EK 至 grace 供解在途。需先 enableFs。 */
  rotateEncryptionKey?(): void;
  /**
   * 設定/移除自己的**廣播頭像**（ADR-0154）：`avatar` 為 data URI 縮圖（來源端 128px），
   * 空字串或 undefined＝移除（廣播移除記號，聯絡人端清掉舊圖）。設定即比照改名
   * （ADR-0144）全量重播個人檔。格式不合（非白名單 data URI 或超過上限）回 false 不套用。
   */
  setSelfAvatar?(avatar: string | undefined): boolean;
  /** 自己目前的廣播頭像（ADR-0154）；未設定或已移除回 undefined。 */
  selfAvatar?(): string | undefined;
  /**
   * 設定/移除自己的企業頭銜（ADR-0158）：≤24 字（引擎清洗），空/undefined＝移除
   * （廣播移除記號）。變更比照改名全量重播個人檔。
   */
  setSelfTitle?(title: string | undefined): void;
  /** 自己目前的企業頭銜（ADR-0158）；未設定或已移除回 undefined。 */
  selfTitle?(): string | undefined;
  /**
   * 送出訊息；`ttlSeconds` 設定時為限時訊息（閱後即焚，NIP-40 短期過期）；
   * `mentions` 為 @提及公鑰（ADR-0050）；`replyTo` 為對話串根訊息 id（ADR-0051）；
   * `alsoMain` 為串回覆同時顯示於主對話（ADR-0232，與 replyTo 併用才有意義）。
   */
  sendMessage(to: PubkeyHex, text: string, ttlSeconds?: number, mentions?: PubkeyHex[], replyTo?: string, alsoMain?: boolean): void;
  sendTyping(to: PubkeyHex): void;
  sendNudge(to: PubkeyHex): void;
  /** 對某訊息送出 emoji 回應（NIP-25）。 */
  sendReaction?(to: PubkeyHex, messageId: string, emoji: string): void;
  /** 收回（刪除）自己送出的某訊息（NIP-09）。 */
  /** 收回自己送出的訊息（NIP-09）；`traceless`＝無痕收回（ADR-0234，不留佔位）。 */
  unsendMessage?(to: PubkeyHex, messageId: string, traceless?: boolean): void;
  /**
   * 使用者**看到**了這個對話：推進本機已讀水位（ADR-0108）**並**送出已讀回條
   * （僅在回條開啟時；ADR-0058 Tier 3）。
   */
  markRead?(contact: PubkeyHex): void;
  /**
   * 清除某對話的未讀＝**只**推進本機已讀水位（ADR-0108），**不**告訴對方。
   *
   * 用於「清掉紅點但不算真的看到」的情境（例如視窗隱藏時切換分頁）。與 `markRead` 的差別
   * 純粹是隱私：本機記得讀到哪是 UX（永遠有效）；告訴對方我讀了是隱私選擇（opt-in）。
   */
  clearUnread?(convo: string): void;
  /** 設定已讀回條開關（opt-in + 互惠；ADR-0058）。 */
  setReadReceipts?(enabled: boolean): void;
  /**
   * 以 WebRTC P2P 傳送檔案（不經中繼），回傳追蹤用的傳輸 id。
   *
   * `opts.thumb`（ADR-0102）：圖片縮圖 data URL——前端產生（需 canvas），只存本機、不外送。
   * `opts.savedPath`（ADR-0103）：**送出端原檔的本機路徑**。只有原生選檔對話框拿得到
   * （瀏覽器 `<input type=file>` 基於安全不給完整路徑）；有了它，自己送出的圖片重載後也能看原圖。
   */
  sendFile?(to: PubkeyHex, file: OutgoingFile, opts?: { thumb?: string; savedPath?: string }): string;
  /**
   * 向 `to` 索取自訂 emoji blob（ADR-0223 backfill）：收端見訊息的 `ref` 但快取無此 hash 時呼叫。
   * 對端查得後以加密分塊回傳；收齊、驗整合性、入快取後觸發 `onAssetCached`。
   */
  requestAsset?(to: PubkeyHex, hash: string): void;
  /** 自訂資產庫／墓碑變更後呼叫（ADR-0224）：重發雲端快照，讓自己其他裝置同步庫與刪除。 */
  resyncAssets?(): void;
  /** 記錄某圖片訊息的縮圖（ADR-0102）：收檔端產生縮圖後回填。 */
  setFileThumb?(contact: PubkeyHex, messageId: string, thumb: string): void;
  /**
   * 存入公司儲存槽（ADR-0161，員工端）：以 P2P 把檔案交給企業主（帶 `slot` 標記，
   * 兩端不建聊天訊息）。`origin`＝來源對話標註。回傳傳輸 id 供進度/完成對應。
   */
  depositFile?(to: PubkeyHex, file: OutgoingFile, origin: string): string;
  /** 回填某檔案訊息收檔後的本機儲存路徑（ADR-0093）：App 另存完成後呼叫以持久化路徑。 */
  setFileSavedPath?(contact: PubkeyHex, messageId: string, savedPath: string): void;
  /** 開啟對話時主動建立 P2P 通道（F5：讓輸入中等狀態卸載中繼）。 */
  connectPeer?(to: PubkeyHex): void;
  /** 建立群組（M9）：`memberPubkeys` 為其他成員的公鑰（既有聯絡人）。 */
  createGroup?(name: string, memberPubkeys: PubkeyHex[]): void;
  /** 對群組送出訊息（扇出給所有成員）；`mentions` 為 @提及公鑰（ADR-0050）；`replyTo` 為對話串根 id（ADR-0051）；`alsoMain` 同 sendMessage（ADR-0232）。 */
  sendGroupMessage?(groupId: string, text: string, mentions?: PubkeyHex[], replyTo?: string, alsoMain?: boolean): void;
  /** 離開群組。 */
  leaveGroup?(groupId: string): void;
  /** 管理者新增群組成員（M9 成員管理）。 */
  addGroupMember?(groupId: string, pubkey: PubkeyHex): void;
  /** 管理者移除群組成員（M9 成員管理）。 */
  removeGroupMember?(groupId: string, pubkey: PubkeyHex): void;
  /** 管理者佈建（ADR-0047/0048/0049/0157）：簽章並發布組織名冊（含可選政策/群組/公司設定），回傳供 relay allowlist 佈建的 pubkey 清單。 */
  publishRoster?(
    org: string,
    members: OrgMember[],
    policy?: OrgPolicy,
    groups?: OrgGroup[],
    profile?: { welcome?: string; workHours?: OrgWorkHours },
  ): PubkeyHex[];
  /** 現行名冊（ADR-0157，企業主）：供名冊管理視窗預填；尚未發佈/找回前為 null。 */
  currentRoster?(): OrgRosterDoc | null;
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
  /** 接受訊息請求（ADR-0121）：請求 → 聯絡人。 */
  acceptRequest?(pubkey: PubkeyHex): void;
  /** 刪除訊息請求（ADR-0121）：連同他傳來的訊息一起清掉；不封鎖。 */
  declineRequest?(pubkey: PubkeyHex): void;
  /** 全部刪除訊息請求（ADR-0127 防洪）：被灌爆時一次清空。 */
  clearRequests?(): void;
  /** 清除指向某座 relay 的聯絡人 hint 並釋放連線（ADR-0036）。 */
  clearRelayHint?(url: string): void;
  /** 確認保留某座 stale relay（重置離線計時、暫時隱藏警告，ADR-0036）。 */
  acknowledgeRelayStale?(url: string): void;
  /** 立即備份雲端快照（ADR-0071；已開啟模式時，跳過節流）。 */
  publishSnapshotNow?(): void;
  /** 關閉雲端快照時清除 relay 上此裝置的快照（purge，ADR-0071）。 */
  purgeCloudSnapshot?(deviceId: string): void;
  /** 自己的 `npub`（供分享/加好友；僅真實 relay 後端提供）。 */
  readonly selfNpub?: string;
  /** 分享用字串 `npub…@wss://…`（帶 relay hint；無 home relay 時同 npub）。 */
  readonly selfShareUri?: string;
  /** 自己的 `nsec` 私鑰（僅供本機身分備份；絕不外流；僅真實 relay 後端提供）。 */
  readonly selfNsec?: string;
  stop(): void;
}
