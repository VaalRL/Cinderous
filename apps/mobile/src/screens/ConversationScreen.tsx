// 行動端對話畫面（ADR-0085）：從聊天清單點入的全螢幕對話，參考 LINE/Signal——
// 頂部返回列（‹ 返回＋名稱＋副標）、訊息氣泡（自己靠右主色、對方靠左淺底；群組顯示發送者名）、
// 底部輸入列（輸入框＋送出）。色彩吃 @cinder/theme。訊息與送出由呼叫端注入（接 ChatBackend）。
import { useMemo, useRef, useState } from "react";
import {
  applyMention,
  calcPreview,
  formatSticker,
  groupReceiptMode,
  parseCustomSticker,
  parseMentions,
  parseSticker,
  REACTION_EMOJIS,
  STICKER_PACK_META,
  STICKER_PACK_ORDER,
  STICKER_PACKS,
  stickerSvg,
  suggestMentions,
  svgToDataUri,
  validateStickerSvg,
} from "@cinder/core";
import type { CallMedia, MentionCandidate } from "@cinder/core";
import { replyCounts } from "@cinder/engine";
import type { ChatMessage, MessageStatus } from "@cinder/engine";
import { type Locale, type MessageKey, translate } from "@cinder/i18n";
import { BG_PRESETS, type ChatBg, chatBgStyle, resolveTheme, type Theme, type ThemeTokens } from "@cinder/theme";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native-web";
import { MsgStatusIcon } from "./MsgStatusIcon.js";
import { downloadImageFromUrl, shareImageFromUrl } from "../native/share.js";

/** 送出狀態的 i18n 標籤（ADR-0058／0095）；與桌面同鍵。 */
const MSG_STATUS_KEY: Record<MessageStatus, MessageKey> = {
  sending: "msgStatus_sending",
  failed: "msgStatus_failed",
  sent: "msgStatus_sent",
  delivered: "msgStatus_delivered",
  read: "msgStatus_read",
};

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tk.bgB },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      backgroundColor: tk.surface2,
      borderBottomWidth: 1,
      borderBottomColor: tk.border,
    },
    back: { paddingHorizontal: 6, paddingVertical: 2 },
    backText: { fontSize: 26, color: tk.accent, lineHeight: 26 },
    headText: { flex: 1 },
    callBtn: { paddingHorizontal: 6, paddingVertical: 4 },
    callIcon: { fontSize: 18 },
    headTitle: { fontSize: 16, fontWeight: "700", color: tk.ink },
    headSub: { fontSize: 11, color: tk.muted },
    // 企業頭銜 chip（ADR-0170）：實心主色底、白字，與私有標籤（outline）色彩區隔。
    roleChip: { backgroundColor: tk.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
    roleChipText: { fontSize: 10, fontWeight: "700", color: "#fff" },
    list: { flex: 1 },
    listInner: { padding: 12, gap: 8 },
    rowMine: { alignItems: "flex-end" },
    rowTheir: { alignItems: "flex-start" },
    sender: { fontSize: 11, color: tk.muted, marginBottom: 2, marginLeft: 6 },
    bubble: { maxWidth: "78%", borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
    // 貼圖（ADR-0137）：無泡泡底、直接顯示圖案。
    bubbleSticker: { padding: 0, backgroundColor: "transparent" },
    sticker: { width: 120, height: 120 },
    bubbleMine: { backgroundColor: tk.accent },
    bubbleTheir: { backgroundColor: tk.panel, borderWidth: 1, borderColor: tk.border },
    // @提及你（ADR-0133）：主色左邊條。
    bubbleMention: { borderLeftWidth: 3, borderLeftColor: tk.accent },
    mentionBadge: { fontSize: 10, fontWeight: "700", color: tk.accent, marginBottom: 2 },
    // 內嵌回覆（ADR-0136）：泡泡內的引用區、草稿列上方的回覆列。
    quote: { borderLeftWidth: 2, paddingLeft: 6, marginBottom: 4, opacity: 0.95 },
    quoteWho: { fontSize: 10, fontWeight: "700" },
    quoteText: { fontSize: 11 },
    replyBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingTop: 6, backgroundColor: tk.panel },
    replyBarBody: { flex: 1, borderLeftWidth: 2, borderLeftColor: tk.accent, paddingLeft: 8 },
    replyBarWho: { fontSize: 11, fontWeight: "700", color: tk.accent },
    replyBarText: { fontSize: 12, color: tk.muted },
    replyBarCancel: { paddingHorizontal: 8, paddingVertical: 2 },
    replyBarCancelText: { fontSize: 14, color: tk.muted },
    // 貼圖面板（ADR-0137）。
    stickerPanel: { maxHeight: 240, borderTopWidth: 1, borderTopColor: tk.border, backgroundColor: tk.panel },
    stickerTabs: { gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
    stickerTab: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: tk.border },
    stickerTabOn: { borderColor: tk.accent, backgroundColor: tk.field },
    stickerTabText: { fontSize: 12, color: tk.ink },
    stickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 8 },
    stickerThumb: { width: 72, height: 72 },
    textMine: { color: "#ffffff", fontSize: 14 },
    textTheir: { color: tk.ink, fontSize: 14 },
    status: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, marginRight: 4 },
    members: {
      backgroundColor: tk.panel,
      borderBottomWidth: 1,
      borderBottomColor: tk.border,
      paddingHorizontal: 12,
      paddingVertical: 6,
      gap: 2,
    },
    memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
    memberName: { flex: 1, fontSize: 13, color: tk.ink },
    // 輔助面板（ADR-0183）：媒體/對話串/便條分頁——桌面右欄的行動端版。
    auxPanel: { backgroundColor: tk.panel, borderBottomWidth: 1, borderBottomColor: tk.border, padding: 10, gap: 8, maxHeight: 320 },
    auxTabs: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
    auxTab: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: tk.border },
    auxTabOn: { borderColor: tk.accent, backgroundColor: tk.field },
    auxTabTxt: { fontSize: 12, color: tk.muted },
    auxTabTxtOn: { color: tk.accent, fontWeight: "700" },
    auxEmpty: { fontSize: 11, color: tk.muted, lineHeight: 16, paddingVertical: 4 },
    auxMedia: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    auxThumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: tk.field },
    auxRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: tk.border },
    auxRowText: { flex: 1, fontSize: 13, color: tk.ink },
    auxCount: { fontSize: 11, color: tk.accent },
    auxNote: {
      minHeight: 140, textAlignVertical: "top", borderWidth: 1, borderColor: tk.border, borderRadius: 8,
      backgroundColor: tk.field, color: tk.ink, padding: 10, fontSize: 14, lineHeight: 20,
    },
    // 本地暱稱編輯列（ADR-0148）。
    aliasEdit: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: tk.panel,
      borderBottomWidth: 1,
      borderBottomColor: tk.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    aliasInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 8,
      backgroundColor: tk.field,
      color: tk.ink,
      paddingVertical: 6,
      paddingHorizontal: 10,
      fontSize: 14,
    },
    aliasSave: { backgroundColor: tk.accent, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
    aliasSaveText: { color: "#ffffff", fontWeight: "700", fontSize: 13 },
    memberBtn: { borderWidth: 1, borderColor: tk.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
    memberBtnText: { fontSize: 11, color: tk.muted },
    leaveBtn: { alignSelf: "flex-start", marginTop: 4, borderColor: "#dc2626" },
    leaveText: { fontSize: 11, color: "#dc2626" },
    // 對話背景挑選面板（ADR-0134）。
    bgpanel: {
      backgroundColor: tk.panel,
      borderBottomWidth: 1,
      borderBottomColor: tk.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 8,
    },
    bggrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    bgswatch: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: tk.border },
    bgswatchOn: { borderWidth: 2, borderColor: tk.accent },
    bgclear: { alignSelf: "flex-start" },
    textGone: { fontStyle: "italic", opacity: 0.7 },
    reactions: { marginTop: 2, paddingHorizontal: 4 },
    reactionText: { fontSize: 13 },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
      marginTop: 3,
      backgroundColor: tk.panel,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 999,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    actBtn: { paddingHorizontal: 4, paddingVertical: 1 },
    actEmoji: { fontSize: 16 },
    actText: { fontSize: 12, color: tk.accent },
    readby: { fontSize: 10, color: tk.muted },
    // @提及建議列（ADR-0133）：輸入列上方橫向可捲。
    menbar: { maxHeight: 44, borderTopWidth: 1, borderTopColor: tk.border, backgroundColor: tk.panel },
    menbarInner: { alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
    menItem: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: tk.accent,
      backgroundColor: tk.field,
    },
    menItemText: { fontSize: 13, color: tk.accent },
    // 算式預覽 chip（ADR-0097）
    calcchip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      marginHorizontal: 10,
      marginBottom: 4,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: tk.accent,
      backgroundColor: tk.field,
    },
    attach: { paddingHorizontal: 6, paddingVertical: 6 },
    attachText: { fontSize: 20 },
    fileMeta: { fontSize: 11, marginTop: 2 },
    thumb: { width: 180, height: 135, borderRadius: 8, marginBottom: 6, resizeMode: "cover" },
    calcchipEq: { fontSize: 12, color: tk.muted },
    calcchipVal: { fontSize: 13, fontWeight: "700", color: tk.accent },
    composer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 8,
      backgroundColor: tk.surface2,
      borderTopWidth: 1,
      borderTopColor: tk.border,
    },
    burnLabel: {
      paddingHorizontal: 14,
      paddingTop: 6,
      fontSize: 11,
      fontWeight: "700",
      color: tk.accent,
      backgroundColor: tk.surface2,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 20,
      backgroundColor: tk.field,
      color: tk.ink,
      paddingVertical: 8,
      paddingHorizontal: 14,
      fontSize: 14,
    },
    send: { backgroundColor: tk.accent, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
    sendText: { color: "#ffffff", fontWeight: "700", fontSize: 14 },
  });
}

export function ConversationScreen({
  name,
  broadcastName,
  alias,
  onSetAlias,
  subtitle,
  messages,
  nameFor,
  groupMembers,
  reactions,
  unsent,
  onReact,
  onUnsend,
  onSend,
  onTyping,
  mentionCandidates,
  chatBg = null,
  onSetChatBg,
  onClearChatBg,
  onNoteLoad,
  onNoteSave,
  onSendFile,
  onDepositSlot,
  onStartCall,
  onNudge,
  onHistory,
  onLeaveGroup,
  onRemoveMember,
  onAddMember,
  addMemberCandidates,
  isGroupAdmin,
  title,
  selfPubkey,
  onBack,
  locale = "zh-Hant",
  theme = "light",
  accent = null,
  accent2 = null,
}: {
  name: string;
  /**
   * 本地暱稱（ADR-0148，1:1）：`name` 已是顯示用（暱稱優先）；這裡另給對方廣播名與目前暱稱，
   * 供點標頭在暱稱↔廣播名間切換、與設定/清除暱稱。未提供＝群組/示範，不顯示暱稱功能。
   */
  broadcastName?: string;
  alias?: string;
  onSetAlias?: (alias: string | undefined) => void;
  /** 副標：聯絡人狀態或群組成員數（由呼叫端組好）。 */
  subtitle?: string;
  messages: ChatMessage[];
  /** 群組訊息顯示發送者名（傳 pubkey → 名稱）；未提供則不顯示。 */
  nameFor?: (pubkey: string) => string;
  /** 群組成員 pubkey（含自己）；提供即為群組，用來決定已讀呈現分級（ADR-0095）。 */
  groupMembers?: string[];
  /** 傳送檔案（ADR-0100）；未提供則不顯示 📎（如示範模式）。 */
  onSendFile?: () => void;
  /** 存入公司儲存槽（ADR-0161／0177，員工端）；未提供則不顯示 🗄（非企業成員）。 */
  onDepositSlot?: () => void;
  /** 發起通話（ADR-0101）；未提供則不顯示通話鈕（示範模式／平台無 WebRTC）。 */
  onStartCall?: (media: CallMedia) => void;
  /** 敲一下（ADR-0114）：1:1 才有；過去行動端只能收、不能發。 */
  onNudge?: () => void;
  /** 開啟歷史紀錄（ADR-0111）；只有該對話真的有封存時才傳入。 */
  onHistory?: () => void;
  /** 每則訊息收到的 emoji 回應（NIP-25）：訊息 id → emoji 清單。 */
  reactions?: Record<string, string[]>;
  /** 已收回的訊息 id（NIP-09）：顯示為「（已收回）」，不得洩漏原文。 */
  unsent?: Set<string>;
  /** 對某訊息送出 emoji 回應；未提供則不顯示回應入口（如示範模式）。 */
  onReact?: (messageId: string, emoji: string) => void;
  /** 收回自己送出的訊息；未提供則不顯示收回入口。 */
  onUnsend?: (messageId: string) => void;
  /** 離開群組（ADR-0114）；未提供則不顯示。 */
  onLeaveGroup?: () => void;
  /**
   * 移除群組成員（**僅管理者**，ADR-0027）。群組無共用金鑰——移除成員＝下次扇出略過他，
   * 即時生效且免 rekey。
   */
  onRemoveMember?: (pubkey: string) => void;
  /** 管理者新增群組成員（ADR-0027／0170）：從尚非成員的聯絡人中挑選。未提供則不顯示。 */
  onAddMember?: (pubkey: string) => void;
  /** 可新增的候選（尚非成員的聯絡人）；空＝沒有可加的人，不顯示新增區。 */
  addMemberCandidates?: MentionCandidate[];
  /** 自己是不是這個群的管理者（決定要不要顯示移除/新增成員）。 */
  isGroupAdmin?: boolean;
  /** 對方的企業自報頭銜（ADR-0158／0170，1:1）：標頭旁以 chip 顯示。未提供＝不顯示。 */
  title?: string;
  /** 自己的 pubkey（成員清單中不對自己顯示「移除」）。 */
  selfPubkey?: string;
  /**
   * 送出訊息；`mentions` 為解析出的 @提及公鑰（ADR-0050／0133）；`replyTo` 為對話串根 id
   * （ADR-0136）；`ttlSeconds` 為限時訊息（閱後即焚，ADR-0057，1:1 才有）。
   */
  onSend: (text: string, mentions?: string[], replyTo?: string, ttlSeconds?: number) => void;
  /** 通知對方「正在輸入」（ADR-0120）；1:1 才提供，元件內自行節流。未提供＝不送。 */
  onTyping?: () => void;
  /** @提及候選（ADR-0133）：群組＝其他成員、1:1＝對方。未提供則不顯示提及建議。 */
  mentionCandidates?: MentionCandidate[];
  /** 目前對話背景（ADR-0134，本地個人化）；null＝用預設面板色。 */
  chatBg?: ChatBg | null;
  /** 設定對話背景；未提供則不顯示背景入口（如示範模式）。 */
  onSetChatBg?: (bg: ChatBg) => void;
  /** 清除對話背景。 */
  onClearChatBg?: () => void;
  /**
   * 便條（ADR-0183）：讀/寫這個對話的私人便條（加密由 App 層處理，只回/收明文）。兩者皆提供才
   * 顯示「便條」分頁。未提供＝不顯示（如示範模式）。
   */
  onNoteLoad?: () => string;
  onNoteSave?: (text: string) => void;
  onBack: () => void;
  locale?: Locale;
  theme?: Theme;
  accent?: string | null;
  accent2?: string | null;
}): JSX.Element {
  const tk = useMemo(() => resolveTheme({ theme, accent, accent2 }), [theme, accent, accent2]);
  const styles = useMemo(() => makeStyles(tk), [tk]);
  const t = (k: MessageKey, params?: Record<string, string | number>): string => translate(locale, k, params);
  /** 長按選中的訊息（顯示回應/收回列）。手機沒有 hover，長按是等價的入口。 */
  const [picked, setPicked] = useState<string | null>(null);
  // 本地暱稱（ADR-0148）：有暱稱時點標頭在暱稱↔廣播名切換；✎ 展開輸入列設定/清除。
  const hasAlias = !!alias?.trim();
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [aliasEditing, setAliasEditing] = useState(false);
  const [aliasDraft, setAliasDraft] = useState(alias ?? "");
  const headerName = hasAlias && !showBroadcast ? name : (broadcastName ?? name);
  const applyAlias = (): void => {
    onSetAlias?.(aliasDraft.trim() || undefined); // 空＝清除
    setAliasEditing(false);
    setShowBroadcast(false);
  };
  /** 群組成員面板是否展開（ADR-0114）。 */
  const [membersOpen, setMembersOpen] = useState(false);
  /** 新增成員挑選是否展開（ADR-0170）：管理者才有；避免成員面板一開就塞一長串聯絡人。 */
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  /** 對話背景挑選面板是否展開（ADR-0134）。 */
  const [bgOpen, setBgOpen] = useState(false);
  /** 輔助面板（ADR-0183）：桌面右欄的行動端版——📋 開，內含媒體/對話串/便條分頁。 */
  const [auxOpen, setAuxOpen] = useState(false);
  const [auxTab, setAuxTab] = useState<"media" | "threads" | "note">("media");
  // 便條（ADR-0183）：本畫面以 key={activeId} 重掛（App 層），故 useState 初值即載對應對話的便條。
  const [noteText, setNoteText] = useState(() => onNoteLoad?.() ?? "");
  // 媒體相簿（ADR-0102/0183）：對話中可顯示的圖片。ADR-0184 審查修正：useMemo——只在 messages 變
  // 時重算，避免每次打字（draft/便條 state 變）都對整份 messages 重跑 filter/replyCounts。
  const auxImages = useMemo(
    () => messages.filter((m) => m.file?.mime.startsWith("image/") && (m.file.url || m.file.thumb)),
    [messages],
  );
  // 對話串（ADR-0051/0183）：有回覆的串根＋回覆數。
  const auxThreads = useMemo(() => [...replyCounts(messages).entries()].filter(([, n]) => n > 0), [messages]);
  const auxTabStyle = (on: boolean) => [styles.auxTab, on ? styles.auxTabOn : null];
  const auxTabTxt = (on: boolean) => [styles.auxTabTxt, on ? styles.auxTabTxtOn : null];
  /** 貼圖挑選面板是否展開（ADR-0137）＋目前分頁。 */
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerPack, setStickerPack] = useState<string>(STICKER_PACK_ORDER[0] ?? "");
  // 狀態圖示配色（ADR-0095）：張開眼＝主色、失敗＝紅、其餘＝灰。
  const statusColor = (s: MessageStatus): string =>
    s === "read" ? tk.accent : s === "failed" ? "#dc2626" : tk.muted;

  /**
   * 群組已讀呈現（ADR-0095，與桌面同一套分級）：≤5 名單制（誰已讀）、6–10 計數制（已讀 M/N）、
   * >10 完全不記（回 null，不顯示）。僅自己送出的群訊有意義。
   */
  const groupReadOf = (m: ChatMessage): string | null => {
    if (!m.outgoing || !groupMembers) return null;
    const total = groupMembers.length - 1; // 其他成員數（不含自己）
    if (total <= 0) return null;
    const mode = groupReceiptMode(groupMembers.length);
    if (mode === "off") return null; // 大群不記
    const readers = Object.entries(m.receipts ?? {})
      .filter(([, v]) => v === "read")
      .map(([pk]) => pk);
    if (readers.length === 0) return null;
    return mode === "list"
      ? t("readBy_list", { names: readers.map((pk) => nameFor?.(pk) ?? `${pk.slice(0, 8)}…`).join("、") })
      : t("readBy_count", { count: readers.length, total });
  };
  /**
   * 檔案訊息的附註（ADR-0093 語意，與桌面一致）：
   * 已存路徑 → 顯示路徑；只有 metadata（位元組落在另一台）→ 提示；否則顯示大小。
   */
  const fileNote = (m: ChatMessage): string => {
    const f = m.file;
    if (!f) return "";
    const size = f.size < 1024 ? `${f.size} B` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / 1048576).toFixed(1)} MB`;
    if (f.savedPath) return `${t("file_saved")}：${f.savedPath}`;
    if (!m.outgoing && !f.url && f.sent < f.size) return `📍 ${t("file_onOtherDevice")}`;
    return size;
  };

  const [draft, setDraft] = useState("");
  // 限時訊息（ADR-0057，1:1）：關→1 分→1 小時→1 天 循環。群組不支援（sendGroupMessage 不帶 ttl）。
  const [ttl, setTtl] = useState(0);
  const TTL_CYCLE = [0, 60, 3600, 86400];
  const TTL_LABEL: Record<number, MessageKey> = {
    0: "convo_timerOff",
    60: "convo_timer1m",
    3600: "convo_timer1h",
    86400: "convo_timer1d",
  };
  const cycleTtl = (): void => setTtl((v) => TTL_CYCLE[(TTL_CYCLE.indexOf(v) + 1) % TTL_CYCLE.length] ?? 0);
  // 輸入中節流（ADR-0120）：最多每 3 秒送一次「正在輸入」，避免每個按鍵都打中繼。
  const lastTypingAt = useRef(0);
  const onDraftChange = (text: string): void => {
    setDraft(text);
    if (!onTyping || !text.trim()) return;
    const now = Date.now();
    if (now - lastTypingAt.current < 3000) return;
    lastTypingAt.current = now;
    onTyping();
  };
  // 算式預覽（ADR-0097）：純函式判定草稿是否為算式；不是就回 null（不顯示）。
  const calc = calcPreview(draft);

  /**
   * 貼圖判定（ADR-0137）：訊息本文是不是貼圖標記？回可渲染的 SVG，否則 null。
   * 內建（v1）解出 pack/id 取 SVG；自製（v2）解出內嵌 SVG 並**驗證**（收端縱深防禦）。
   */
  const stickerOf = (m: ChatMessage): string | null => {
    if (m.file) return null;
    const b = parseSticker(m.text);
    if (b) return stickerSvg(b.pack, b.id) ?? null;
    const c = parseCustomSticker(m.text);
    if (c && validateStickerSvg(c.svg).ok) return c.svg;
    return null;
  };

  // @提及建議（ADR-0133，與桌面同一份 core 邏輯）：草稿結尾有進行中的 @token 就過濾候選。
  // 手機沒有下拉，改在輸入列上方橫向排一列可點的名字。
  const menSuggest = mentionCandidates ? suggestMentions(draft, mentionCandidates) : null;
  const acceptMention = (cand: MentionCandidate): void => {
    if (menSuggest) setDraft(applyMention(draft, menSuggest, cand));
  };

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    // 解析 @提及 → p tag（隨 Gift Wrap 加密，中繼看不到；ADR-0050）。
    const mentions = mentionCandidates ? parseMentions(text, mentionCandidates) : [];
    // 內嵌回覆（ADR-0136）：帶對話串根 id → NIP-10 reply e-tag（同樣隨 Gift Wrap 加密）。
    // 限時（ADR-0057）：ttl>0＝閱後即焚；群組無此鈕故恒為 0。送出後保留 ttl 設定（連發同效期）。
    onSend(text, mentions.length > 0 ? mentions : undefined, replyTarget ?? undefined, ttl > 0 ? ttl : undefined);
    setDraft("");
    setReplyTarget(null);
  };

  /** 被回覆的目標訊息 id（ADR-0136）：草稿列上方顯示引用，送出時帶為 replyTo。 */
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const replyToMsg = replyTarget ? messages.find((m) => m.id === replyTarget) : undefined;
  /** 引用預覽文字：已收回不顯示原文；檔案顯示檔名；否則截斷本文。 */
  const quoteText = (m: ChatMessage): string => {
    if (unsent?.has(m.id)) return t("msg_unsent");
    if (m.file) return `📎 ${m.file.name}`;
    return m.text.length > 60 ? `${m.text.slice(0, 60)}…` : m.text;
  };
  const quoteWho = (m: ChatMessage): string =>
    m.outgoing ? t("members_you") : m.sender && nameFor ? nameFor(m.sender) : name;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.back} accessibilityRole="button" aria-label={t("mobileConvo_back")} onPress={onBack}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headText}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {/* ADR-0148：有暱稱→點名字切換廣播名；提供 onSetAlias→顯示 ✎ 設定/清除。 */}
            <Pressable
              accessibilityRole="button"
              disabled={!hasAlias}
              onPress={() => setShowBroadcast((v) => !v)}
              testID="convo-title-name"
            >
              <Text style={styles.headTitle}>{headerName}</Text>
            </Pressable>
            {onSetAlias ? (
              <Pressable
                accessibilityRole="button"
                aria-label={t(hasAlias ? "alias_edit" : "alias_set")}
                testID="convo-alias-edit"
                onPress={() => {
                  setAliasDraft(alias ?? "");
                  setAliasEditing((v) => !v);
                }}
              >
                <Text style={styles.headSub}>✎</Text>
              </Pressable>
            ) : null}
            {/* 企業自報頭銜（ADR-0158／0170）：實心 chip，與私有標籤色彩區隔；1:1 才有。 */}
            {title?.trim() && !groupMembers ? (
              <View style={styles.roleChip} testID="convo-title-chip">
                <Text style={styles.roleChipText}>{title}</Text>
              </View>
            ) : null}
          </View>
          {subtitle ? <Text style={styles.headSub}>{subtitle}</Text> : null}
        </View>
        {/* 敲一下（ADR-0114）：1:1 才有。 */}
        {onNudge && !groupMembers ? (
          <Pressable
            style={styles.callBtn}
            accessibilityRole="button"
            aria-label={t("convo_nudge")}
            testID="nudge"
            onPress={onNudge}
          >
            <Text style={styles.callIcon}>👋</Text>
          </Pressable>
        ) : null}
        {/* 群組管理（ADR-0114）：成員清單／離開群組。1:1 不顯示。 */}
        {groupMembers && (onLeaveGroup || onRemoveMember) ? (
          <Pressable
            style={styles.callBtn}
            accessibilityRole="button"
            aria-label={t("members_title")}
            testID="group-menu"
            onPress={() => setMembersOpen((v) => !v)}
          >
            <Text style={styles.callIcon}>👥</Text>
          </Pressable>
        ) : null}
        {/* 對話背景（ADR-0134）：本地個人化，點開挑選面板。 */}
        {onSetChatBg ? (
          <Pressable
            style={styles.callBtn}
            accessibilityRole="button"
            aria-label={t("chatbg_title")}
            testID="chatbg-btn"
            onPress={() => setBgOpen((v) => !v)}
          >
            <Text style={styles.callIcon}>🖼</Text>
          </Pressable>
        ) : null}
        {/* 輔助面板（ADR-0183）：桌面右欄的行動端版——媒體/對話串/便條。點 📋 展開分頁面板。 */}
        <Pressable
          style={styles.callBtn}
          accessibilityRole="button"
          aria-label={t("aux_title")}
          testID="aux-btn"
          onPress={() => setAuxOpen((v) => !v)}
        >
          <Text style={styles.callIcon}>📋</Text>
        </Pressable>
        {/* 歷史紀錄（ADR-0111）：主畫面只讀熱區；更舊的訊息在封存裡，由此進入。 */}
        {onHistory ? (
          <Pressable
            style={styles.callBtn}
            accessibilityRole="button"
            aria-label={t("history_open")}
            onPress={onHistory}
            testID="open-history"
          >
            <Text style={styles.callIcon}>🗄</Text>
          </Pressable>
        ) : null}
        {/* 通話（ADR-0101）：媒體全程 P2P，不經中繼。群組暫不支援（1:1 才顯示）。 */}
        {onStartCall && !groupMembers ? (
          <>
            <Pressable
              style={styles.callBtn}
              accessibilityRole="button"
              aria-label={t("call_audio")}
              onPress={() => onStartCall("audio")}
            >
              <Text style={styles.callIcon}>📞</Text>
            </Pressable>
            <Pressable
              style={styles.callBtn}
              accessibilityRole="button"
              aria-label={t("call_video")}
              onPress={() => onStartCall("video")}
            >
              <Text style={styles.callIcon}>📹</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {/* 本地暱稱編輯列（ADR-0148）：輸入設定、留空清除；純本地不通知對方。 */}
      {aliasEditing ? (
        <View style={styles.aliasEdit}>
          <TextInput
            style={styles.aliasInput}
            value={aliasDraft}
            onChangeText={setAliasDraft}
            placeholder={t("alias_placeholder")}
            placeholderTextColor={tk.muted}
            aria-label={t("alias_placeholder")}
            testID="alias-input"
          />
          <Pressable style={styles.aliasSave} accessibilityRole="button" testID="alias-save" onPress={applyAlias}>
            <Text style={styles.aliasSaveText}>{t("settings_nameApply")}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 群組成員面板（ADR-0114）：管理者可移除成員；任何人都能離開。 */}
      {membersOpen && groupMembers ? (
        <View style={styles.members}>
          {groupMembers.map((pk) => (
            <View key={pk} style={styles.memberRow}>
              <Text style={styles.memberName}>{nameFor ? nameFor(pk) : `${pk.slice(0, 10)}…`}</Text>
              {isGroupAdmin && onRemoveMember && pk !== selfPubkey ? (
                <Pressable
                  style={styles.memberBtn}
                  accessibilityRole="button"
                  testID={`remove-${pk}`}
                  onPress={() => onRemoveMember(pk)}
                >
                  <Text style={styles.memberBtnText}>{t("group_remove")}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {/* 新增成員（ADR-0170，僅管理者且有可加的聯絡人）：點「新增成員」展開候選清單，逐一加入。 */}
          {isGroupAdmin && onAddMember && addMemberCandidates && addMemberCandidates.length > 0 ? (
            <View>
              <Pressable
                style={styles.memberBtn}
                accessibilityRole="button"
                testID="add-member-toggle"
                onPress={() => setAddMemberOpen((v) => !v)}
              >
                <Text style={styles.memberBtnText}>＋ {t("members_add")}</Text>
              </Pressable>
              {addMemberOpen
                ? addMemberCandidates.map((cand) => (
                    <View key={cand.pubkey} style={styles.memberRow}>
                      <Text style={styles.memberName}>{cand.name}</Text>
                      <Pressable
                        style={styles.memberBtn}
                        accessibilityRole="button"
                        testID={`add-member-${cand.pubkey}`}
                        onPress={() => onAddMember(cand.pubkey)}
                      >
                        <Text style={styles.memberBtnText}>{t("members_add")}</Text>
                      </Pressable>
                    </View>
                  ))
                : null}
            </View>
          ) : null}
          {onLeaveGroup ? (
            <Pressable
              style={[styles.memberBtn, styles.leaveBtn]}
              accessibilityRole="button"
              testID="leave-group"
              onPress={() => {
                onLeaveGroup();
                setMembersOpen(false);
              }}
            >
              <Text style={styles.leaveText}>{t("group_leave")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* 輔助面板（ADR-0183）：桌面右欄的行動端版——媒體相簿／對話串／便條分頁。 */}
      {auxOpen ? (
        <View style={styles.auxPanel} testID="aux-panel">
          <View style={styles.auxTabs}>
            <Pressable style={auxTabStyle(auxTab === "media")} testID="aux-tab-media" onPress={() => setAuxTab("media")}>
              <Text style={auxTabTxt(auxTab === "media")}>{t("aux_tabMedia")}（{auxImages.length}）</Text>
            </Pressable>
            <Pressable style={auxTabStyle(auxTab === "threads")} testID="aux-tab-threads" onPress={() => setAuxTab("threads")}>
              <Text style={auxTabTxt(auxTab === "threads")}>{t("aux_tabThreads")}（{auxThreads.length}）</Text>
            </Pressable>
            {onNoteLoad && onNoteSave ? (
              <Pressable style={auxTabStyle(auxTab === "note")} testID="aux-tab-note" onPress={() => setAuxTab("note")}>
                <Text style={auxTabTxt(auxTab === "note")}>{t("aux_tabNote")}</Text>
              </Pressable>
            ) : null}
          </View>

          {auxTab === "media" ? (
            auxImages.length === 0 ? (
              <Text style={styles.auxEmpty}>{t("aux_noMedia")}</Text>
            ) : (
              <View style={styles.auxMedia}>
                {auxImages.map((m) => (
                  <Pressable
                    key={m.id}
                    testID={`aux-media-${m.id}`}
                    onPress={() => {
                      if (m.file?.url && typeof window !== "undefined") window.open(m.file.url, "_blank");
                    }}
                  >
                    <Image style={styles.auxThumb} source={{ uri: m.file!.url ?? m.file!.thumb }} accessibilityLabel={m.file!.name} />
                  </Pressable>
                ))}
              </View>
            )
          ) : null}

          {auxTab === "threads" ? (
            auxThreads.length === 0 ? (
              <Text style={styles.auxEmpty}>{t("aux_noThreads")}</Text>
            ) : (
              auxThreads.map(([rootId, count]) => {
                const root = messages.find((m) => m.id === rootId);
                return (
                  <View key={rootId} style={styles.auxRow} testID={`aux-thread-${rootId}`}>
                    <Text style={styles.auxRowText} numberOfLines={1}>
                      {root ? (root.file ? `📎 ${root.file.name}` : root.text) : `${rootId.slice(0, 8)}…`}
                    </Text>
                    <Text style={styles.auxCount}>{t("aux_replies", { count })}</Text>
                  </View>
                );
              })
            )
          ) : null}

          {auxTab === "note" && onNoteLoad && onNoteSave ? (
            <View>
              <TextInput
                style={styles.auxNote}
                value={noteText}
                onChangeText={(v: string) => {
                  setNoteText(v);
                  onNoteSave(v);
                }}
                multiline
                placeholder={t("note_placeholderM")}
                placeholderTextColor={tk.muted}
                aria-label={t("aux_tabNote")}
                testID="aux-note-input"
              />
              <Text style={styles.auxEmpty}>{t("note_hintM")}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 對話背景挑選面板（ADR-0134）：預設漸層一鍵套、或清除。圖片上傳留待原生建置（見 ADR）。 */}
      {bgOpen && onSetChatBg ? (
        <View style={styles.bgpanel} testID="chatbg-panel">
          <View style={styles.bggrid}>
            {BG_PRESETS.map((p) => {
              const on = chatBg?.type === "preset" && chatBg.value === p.id;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.bgswatch, chatBgStyle({ type: "preset", value: p.id }), on ? styles.bgswatchOn : null]}
                  accessibilityRole="button"
                  aria-label={p.id}
                  testID={`chatbg-${p.id}`}
                  onPress={() => {
                    onSetChatBg({ type: "preset", value: p.id });
                    setBgOpen(false);
                  }}
                />
              );
            })}
          </View>
          {chatBg && onClearChatBg ? (
            <Pressable
              style={[styles.memberBtn, styles.bgclear]}
              accessibilityRole="button"
              testID="chatbg-clear"
              onPress={() => {
                onClearChatBg();
                setBgOpen(false);
              }}
            >
              <Text style={styles.memberBtnText}>{t("chatbg_clear")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <ScrollView style={[styles.list, chatBgStyle(chatBg)]} contentContainerStyle={styles.listInner}>
        {messages.map((m) => {
          const gone = unsent?.has(m.id) ?? false; // 已收回（NIP-09）
          const emojis = reactions?.[m.id] ?? [];
          // 未收回的訊息一律可長按：至少能「回覆」（ADR-0136），可能還有回應/收回/分享。
          const canAct = !gone;
          const canShareImg = !gone && !!m.file?.mime.startsWith("image/") && !!(m.file.url ?? m.file.thumb);
          const quoted = m.replyTo ? messages.find((q) => q.id === m.replyTo) : undefined;
          const sticker = gone ? null : stickerOf(m); // 貼圖（ADR-0137）：無泡泡底、直接渲染 SVG
          return (
          <View key={m.id} style={m.outgoing ? styles.rowMine : styles.rowTheir}>
            {!m.outgoing && nameFor && m.sender ? <Text style={styles.sender}>{nameFor(m.sender)}</Text> : null}
            {/* 長按＝手機上的「右鍵選單」：回應／收回。已收回的訊息不再提供任何操作。 */}
            <Pressable
              {...(canAct
                ? {
                    onLongPress: () => setPicked((p) => (p === m.id ? null : m.id)),
                    accessibilityRole: "button" as const,
                  }
                : {})}
              testID={`bubble-${m.id}`}
            >
              <View
                style={[
                  // 貼圖（ADR-0137）：無泡泡底色與內距，直接顯示圖案（比照 LINE/WhatsApp）。
                  sticker ? styles.bubbleSticker : styles.bubble,
                  sticker ? null : m.outgoing ? styles.bubbleMine : styles.bubbleTheir,
                  // @提及你（ADR-0050／0133）：主色左邊條凸顯，一眼看到被點名。
                  !gone && m.mentionsMe ? styles.bubbleMention : null,
                ]}
              >
                {sticker ? (
                  <Image
                    source={{ uri: svgToDataUri(sticker) }}
                    style={styles.sticker}
                    accessibilityLabel={t("sticker_alt")}
                    testID={`sticker-${m.id}`}
                  />
                ) : null}
                {!sticker && !gone && m.mentionsMe ? (
                  <Text style={styles.mentionBadge} aria-label={t("mention_you")} testID={`mention-badge-${m.id}`}>
                    @ {t("mention_you")}
                  </Text>
                ) : null}
                {/* 內嵌回覆引用（ADR-0136）：顯示被回覆的訊息（誰＋摘要）。引用不到（已捲出熱區）就略過。 */}
                {!sticker && !gone && m.replyTo && quoted ? (
                  <View
                    style={[styles.quote, { borderLeftColor: m.outgoing ? "#ffffffaa" : tk.accent }]}
                    testID={`reply-quote-${m.id}`}
                  >
                    <Text style={[styles.quoteWho, { color: m.outgoing ? "#ffffffcc" : tk.accent }]} numberOfLines={1}>
                      {quoteWho(quoted)}
                    </Text>
                    <Text style={[styles.quoteText, { color: m.outgoing ? "#ffffffcc" : tk.muted }]} numberOfLines={1}>
                      {quoteText(quoted)}
                    </Text>
                  </View>
                ) : null}
                {/* 圖片縮圖（ADR-0102）：跨 session 存活——重載後圖片仍是圖片，不會退化成檔名。 */}
                {!gone && m.file && (m.file.url ?? m.file.thumb) ? (
                  <Image
                    source={{ uri: m.file.url ?? m.file.thumb }}
                    style={styles.thumb}
                    accessibilityLabel={m.file.name}
                  />
                ) : null}
                {!sticker ? (
                  <Text
                    style={[
                      m.outgoing ? styles.textMine : styles.textTheir,
                      gone ? styles.textGone : null,
                    ]}
                  >
                    {/* 已收回：**絕不顯示原文**——收回的意義就在這裡。 */}
                    {gone ? t("msg_unsent") : m.file ? `📎 ${m.file.name}` : m.text}
                  </Text>
                ) : null}
                {!gone && m.file ? (
                  <Text style={[styles.fileMeta, { color: m.outgoing ? "#ffffffcc" : tk.muted }]}>
                    {fileNote(m)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            {/* 收到的 emoji 回應（NIP-25）。 */}
            {!gone && emojis.length > 0 ? (
              <View style={styles.reactions}>
                <Text style={styles.reactionText}>{emojis.join(" ")}</Text>
              </View>
            ) : null}
            {/* 長按後的操作列。 */}
            {picked === m.id ? (
              <View style={styles.actions}>
                {/* 回覆（ADR-0136）：任何未收回訊息都能回覆——設引用目標、草稿列上方顯示。 */}
                <Pressable
                  style={styles.actBtn}
                  accessibilityRole="button"
                  testID={`reply-${m.id}`}
                  onPress={() => {
                    setReplyTarget(m.id);
                    setPicked(null);
                  }}
                >
                  <Text style={styles.actText}>{t("reply_label")}</Text>
                </Pressable>
                {onReact
                  ? REACTION_EMOJIS.map((e) => (
                      <Pressable
                        key={e}
                        style={styles.actBtn}
                        accessibilityRole="button"
                        onPress={() => {
                          onReact(m.id, e);
                          setPicked(null);
                        }}
                      >
                        <Text style={styles.actEmoji}>{e}</Text>
                      </Pressable>
                    ))
                  : null}
                {/* 分享（ADR-0132）：圖片訊息 → 原生分享選單（與其他手機 app 同體驗）；
                    不支援時退回下載，不讓按鈕變死路。 */}
                {m.file?.mime.startsWith("image/") && (m.file.url ?? m.file.thumb) ? (
                  <Pressable
                    style={styles.actBtn}
                    accessibilityRole="button"
                    testID={`share-${m.id}`}
                    onPress={() => {
                      const uri = m.file?.url ?? m.file?.thumb ?? "";
                      const name = m.file?.name ?? "image";
                      const mime = m.file?.mime ?? "image/*";
                      void shareImageFromUrl(uri, name, mime).then((ok) => {
                        if (!ok) downloadImageFromUrl(uri, name);
                      });
                      setPicked(null);
                    }}
                  >
                    <Text style={styles.actText}>{t("share_share")}</Text>
                  </Pressable>
                ) : null}
                {m.outgoing && onUnsend ? (
                  <Pressable
                    style={styles.actBtn}
                    accessibilityRole="button"
                    testID={`unsend-${m.id}`}
                    onPress={() => {
                      onUnsend(m.id);
                      setPicked(null);
                    }}
                  >
                    <Text style={styles.actText}>{t("msg_unsend")}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {/* 送出狀態（ADR-0095）：與桌面同一套——沙漏／閉眼／半開眼／張開眼（主色）／紅色重試。
                群組另依分級顯示「誰已讀」（≤5）或「已讀 M/N」（6–10）；大群不顯示。 */}
            {!gone && m.outgoing && (m.status || groupReadOf(m)) ? (
              <View style={styles.status}>
                {m.status ? (
                  <View aria-label={t(MSG_STATUS_KEY[m.status])}>
                    <MsgStatusIcon status={m.status} color={statusColor(m.status)} size={12} />
                  </View>
                ) : null}
                {groupReadOf(m) ? <Text style={styles.readby}>{groupReadOf(m)}</Text> : null}
              </View>
            ) : null}
          </View>
          );
        })}
      </ScrollView>

      {/* @提及建議列（ADR-0133）：輸入 @ 時橫向列出可點的名字，點一下補進草稿。 */}
      {menSuggest ? (
        <ScrollView horizontal style={styles.menbar} contentContainerStyle={styles.menbarInner}>
          {menSuggest.candidates.map((c) => (
            <Pressable
              key={c.pubkey}
              style={styles.menItem}
              accessibilityRole="button"
              testID={`mention-${c.pubkey}`}
              onPress={() => acceptMention(c)}
            >
              <Text style={styles.menItemText}>@{c.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* 算式即時預覽（ADR-0097）：純本地計算，草稿不外流；點一下把「= 答案」加到草稿。 */}
      {calc ? (
        <Pressable
          style={styles.calcchip}
          accessibilityRole="button"
          aria-label={t("calc_insertHint")}
          onPress={() => setDraft((prev) => `${prev.trimEnd()} = ${calc.result}`)}
        >
          <Text style={styles.calcchipEq}>=</Text>
          <Text style={styles.calcchipVal}>{calc.result}</Text>
        </Pressable>
      ) : null}

      {/* 回覆引用列（ADR-0136）：正在回覆哪則——顯示引用＋取消。送出後自動清除。 */}
      {replyToMsg ? (
        <View style={styles.replyBar} testID="reply-bar">
          <View style={styles.replyBarBody}>
            <Text style={styles.replyBarWho} numberOfLines={1}>
              {t("reply_label")} · {quoteWho(replyToMsg)}
            </Text>
            <Text style={styles.replyBarText} numberOfLines={1}>
              {quoteText(replyToMsg)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            aria-label={t("reply_cancel")}
            testID="reply-cancel"
            onPress={() => setReplyTarget(null)}
            style={styles.replyBarCancel}
          >
            <Text style={styles.replyBarCancelText}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 貼圖挑選面板（ADR-0137）：內建貼圖包分頁＋圖格；點一下即送出（走既有加密訊息通道）。 */}
      {stickerOpen ? (
        <View style={styles.stickerPanel} testID="sticker-panel">
          <ScrollView horizontal contentContainerStyle={styles.stickerTabs}>
            {STICKER_PACK_ORDER.map((pk) => (
              <Pressable
                key={pk}
                accessibilityRole="button"
                testID={`sticker-tab-${pk}`}
                onPress={() => setStickerPack(pk)}
                style={[styles.stickerTab, stickerPack === pk ? styles.stickerTabOn : null]}
              >
                <Text style={styles.stickerTabText}>{STICKER_PACK_META[pk]?.title ?? pk}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.stickerGrid}>
            {Object.entries(STICKER_PACKS[stickerPack] ?? {}).map(([id, s]) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                aria-label={s.label}
                testID={`sticker-pick-${stickerPack}-${id}`}
                onPress={() => {
                  onSend(formatSticker(stickerPack, id));
                  setStickerOpen(false);
                }}
              >
                <Image source={{ uri: svgToDataUri(s.svg) }} style={styles.stickerThumb} accessibilityLabel={s.label} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* 限時作用中提示（ADR-0057）：讓使用者清楚知道選了哪個效期，而非只有 🔥。 */}
      {ttl > 0 && !groupMembers ? (
        <Text style={styles.burnLabel} testID="burn-label">
          🔥 {t(TTL_LABEL[ttl] ?? "convo_timerOff")}
        </Text>
      ) : null}
      <View style={styles.composer}>
        {/* 傳送檔案（ADR-0093/0100）：位元組走 P2P、metadata 走中繼。 */}
        {onSendFile ? (
          <Pressable style={styles.attach} accessibilityRole="button" aria-label={t("convo_attach")} onPress={onSendFile}>
            <Text style={styles.attachText}>📎</Text>
          </Pressable>
        ) : null}
        {/* 存入公司儲存槽（ADR-0161／0177）：企業成員才有；挑檔 → 佇列 → 企業主上線背景送。 */}
        {onDepositSlot ? (
          <Pressable style={styles.attach} accessibilityRole="button" aria-label={t("slot_deposit")} testID="deposit-slot" onPress={onDepositSlot}>
            <Text style={styles.attachText}>🗄</Text>
          </Pressable>
        ) : null}
        {/* 貼圖（ADR-0137）：切換貼圖面板。 */}
        <Pressable
          style={styles.attach}
          accessibilityRole="button"
          aria-label={t("sticker_title")}
          testID="sticker-btn"
          onPress={() => setStickerOpen((v) => !v)}
        >
          <Text style={styles.attachText}>😊</Text>
        </Pressable>
        {/* 限時訊息（ADR-0057）：點一下循環關/1m/1h/1d；1:1 才有（群組扇出不帶 ttl）。 */}
        {!groupMembers ? (
          <Pressable
            style={styles.attach}
            accessibilityRole="button"
            aria-label={t("convo_timerTitle")}
            testID="burn-toggle"
            onPress={cycleTtl}
          >
            <Text style={[styles.attachText, ttl > 0 ? { opacity: 1 } : { opacity: 0.4 }]}>
              {ttl > 0 ? "🔥" : "⏱"}
            </Text>
          </Pressable>
        ) : null}
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={onDraftChange}
          placeholder={t("mobileConvo_input")}
          aria-label={t("mobileConvo_input")}
        />
        <Pressable style={styles.send} accessibilityRole="button" onPress={submit}>
          <Text style={styles.sendText}>{t("mobileConvo_send")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
