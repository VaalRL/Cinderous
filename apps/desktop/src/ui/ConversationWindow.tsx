import {
  applyMention,
  calcPreview,
  contentHash,
  groupReceiptMode,
  parseMentions,
  REACTION_EMOJIS,
  suggestMentions,
} from "@cinder/core";
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import type { CallMedia, MentionCandidate } from "@cinder/core";
import { mainMessages, replyCounts, threadMessages } from "./thread-util.js";
import type { MessageKey } from "@cinder/i18n";
import type { ChatMessage, Contact, MessageStatus, Self } from "@cinder/engine";
import {
  formatCustomSticker,
  formatSticker,
  parseCustomSticker,
  parseSticker,
  resolveSticker,
  STICKER_PACK_META,
  STICKER_PACK_ORDER,
  STICKER_PACKS,
  stickerSvg,
  svgToDataUri,
} from "@cinder/core";
import {
  addSticker,
  CUSTOM_PACK,
  findSticker,
  loadLibrary,
  removeSticker,
  saveLibrary,
  type CustomSticker,
} from "./sticker-library.js";
import {
  isFavorite,
  loadFavorites,
  loadRecent,
  recordRecent,
  saveFavorites,
  toggleFavorite,
  type StickerRef,
} from "./sticker-prefs.js";
import { StickerEditor } from "./StickerEditor.js";
import { validateStickerSvg, wrapRasterAsSvg } from "@cinder/core";
import {
  buildTriggerIndex,
  loadTriggers,
  matchTriggers,
  normalizeTrigger,
  removeTrigger,
  removeTriggersFor,
  renameTrigger,
  saveTriggers,
  setTrigger,
  TRIGGERS_MAX,
  triggersFor,
  type TriggerEntry,
  type TriggerMatch,
} from "./sticker-triggers.js";
import { cleanOnPasteEnabled, cleanText } from "./url-hygiene.js";
import { indentText } from "./composer-indent.js";
import { ComposerInsert, type InsertTemplate } from "./ComposerInsert.js";
import { renderMarkdown } from "./markdown.js";
import { ComposerRewrite } from "./ComposerRewrite.js";
import { applyEmoticons } from "./emoticons.js";
import { avatarColor, EMOTICONS, initial } from "./util.js";
import { EditableAvatar, usePersonalizeTick } from "./Avatar.js";
import { ChatBgPicker } from "./ChatBgPicker.js";
import { useDialog } from "./Dialog.js";
import { MsgStatusIcon } from "./MsgStatusIcon.js";
import { readOriginal, relocateOriginal } from "../native/save-file.js";
import { copyImageFromUrl, copyText } from "../native/clipboard.js";
import { chatBgCss, getChatBg, getConvoSize, setConvoSize } from "./personalize.js";

/**
 * 燈箱項目（ADR-0102）：`preview` 是立刻能顯示的東西（本 session 的原圖 blob，或跨 session 存活的縮圖）；
 * `hasOriginal` 表示 `preview` 本身就是原圖（不需再去讀檔）。
 */
export interface LightboxItem {
  id: string;
  name: string;
  mime: string;
  preview: string;
  hasOriginal: boolean;
  savedPath?: string | undefined;
}

/** 由檔案訊息建燈箱項目；原圖優先，否則用縮圖。 */
function lightboxItem(m: ChatMessage): LightboxItem {
  const f = m.file!;
  return {
    id: m.id,
    name: f.name,
    mime: f.mime,
    preview: f.url ?? f.thumb ?? "",
    hasOriginal: !!f.url,
    savedPath: f.savedPath,
  };
}

/**
 * 燈箱（ADR-0102）：先顯示能顯示的（原圖或縮圖），再嘗試從 `savedPath` **讀回原圖**。
 * 讀不到（使用者把檔案搬走/刪了）→ 顯示縮圖並提供「重新指定位置」，由使用者**主動**選新路徑
 * （點縮圖不該無預警彈出檔案總管）。瀏覽器無法讀回原檔 → 只顯示縮圖。
 */
export function Lightbox({
  item,
  onClose,
  onRelocated,
}: {
  item: LightboxItem;
  onClose: () => void;
  onRelocated: (messageId: string, newPath: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const [src, setSrc] = useState(item.preview);
  const [state, setState] = useState<"ok" | "loading" | "missing" | "unsupported">(
    item.hasOriginal ? "ok" : "loading",
  );

  useEffect(() => {
    if (item.hasOriginal) return; // 本 session 就有原圖
    let cancelled = false;
    void readOriginal(item.savedPath, item.mime).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setSrc(r.url);
        setState("ok");
      } else {
        setState(r.reason);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.hasOriginal, item.savedPath, item.mime]);

  const relocate = (): void => {
    void relocateOriginal(item.name, item.mime).then((r) => {
      if (!r) return;
      setSrc(r.url);
      setState("ok");
      onRelocated(item.id, r.newPath); // 更新 savedPath，下次就直接讀得到
    });
  };

  // 快速複製（ADR-0132）：複製圖片本身、或其檔案路徑（僅在已另存時）。
  const [copied, setCopied] = useState<"" | "image" | "path" | "fail">("");
  const flash = (ok: boolean, which: "image" | "path"): void => {
    setCopied(ok ? which : "fail");
    setTimeout(() => setCopied(""), 1500);
  };
  const doCopyImage = (): void => void copyImageFromUrl(src).then((ok) => flash(ok, "image"));
  const doCopyPath = (): void => {
    if (item.savedPath) void copyText(item.savedPath).then((ok) => flash(ok, "path"));
  };

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      {src ? <img src={src} alt={t("image_alt")} /> : null}
      {/* 快速複製（ADR-0132）：圖片 / 路徑。只在正常顯示原圖時出現（missing/unsupported 已各有 note，
          且同在底部，避免疊在一起）。點動作列不關燈箱。 */}
      {state === "ok" && src ? (
        <div className="lightbox__actions" onClick={(e) => e.stopPropagation()}>
          <button className="lightbox__btn" data-testid="copy-image" onClick={doCopyImage}>
            {copied === "image" ? t("share_copied") : t("share_copyImage")}
          </button>
          {item.savedPath ? (
            <button className="lightbox__btn" data-testid="copy-path" onClick={doCopyPath}>
              {copied === "path" ? t("share_copied") : t("share_copyPath")}
            </button>
          ) : null}
          {copied === "fail" ? <span className="lightbox__copyfail">{t("share_failed")}</span> : null}
        </div>
      ) : null}
      {state === "missing" ? (
        <div className="lightbox__note" onClick={(e) => e.stopPropagation()}>
          <span>{t("image_originalMissing")}</span>
          <button className="lightbox__btn" data-testid="relocate-original" onClick={relocate}>
            {t("image_relocate")}
          </button>
        </div>
      ) : null}
      {state === "unsupported" ? (
        <div className="lightbox__note" onClick={(e) => e.stopPropagation()}>
          <span>{t("image_thumbOnly")}</span>
        </div>
      ) : null}
    </div>
  );
}

/** 群組已讀呈現（ADR-0095）：`list`＝顯示誰已讀（≤5 人）；`count`＝只顯示 M/N（6–10 人）。 */
interface GroupRead {
  mode: "list" | "count";
  /** 已讀人數。 */
  count: number;
  /** 其他成員總數（不含自己）。 */
  total: number;
  /** 已讀者顯示名（名單制才用）。 */
  names: string[];
}

/** 送達/已讀狀態的 i18n 標籤（ADR-0058／0095）。 */
const MSG_STATUS_KEY: Record<MessageStatus, MessageKey> = {
  sending: "msgStatus_sending",
  failed: "msgStatus_failed",
  sent: "msgStatus_sent",
  delivered: "msgStatus_delivered",
  read: "msgStatus_read",
};

export interface ConversationProps {
  self: Self;
  contact: Contact;
  messages: ChatMessage[];
  typing: boolean;
  /** 每次遞增即觸發一次震動動畫。 */
  nudgeSignal: number;
  /** messageId → 該訊息的回應 emoji 清單。 */
  reactions?: Record<string, string[]>;
  /** 已收回（NIP-09）的訊息 id 集合。 */
  unsent?: Set<string>;
  /** 已到期（限時訊息）的訊息 id 集合。 */
  expired?: Set<string>;
  onSend: (text: string, ttlSeconds?: number, mentions?: string[], replyTo?: string) => void;
  onTyping: () => void;
  /** 本機 AI 改寫（ADR-0060）：提供才顯示 ✨ 改寫入口；回傳改寫後文字。 */
  onRewrite?: (text: string, instruction: string) => Promise<string>;
  /** 開啟改寫面板時預偵測 Ollama 是否可用。 */
  onCheckAiAvailable?: () => Promise<boolean>;
  /** @提及候選（ADR-0050）：群成員／對方，供 composer 自動完成與送出解析。 */
  mentionCandidates?: MentionCandidate[];
  onNudge: () => void;
  /** 對某訊息送出 emoji 回應（未提供則不顯示回應功能）。 */
  onReact?: (messageId: string, emoji: string) => void;
  /** 收回自己送出的某訊息（未提供則不顯示收回功能）。 */
  onUnsend?: (messageId: string) => void;
  /** 檢視此對話時呼叫（供送出已讀回條；ADR-0058）。開窗與新訊息到達時觸發。 */
  onMarkRead?: () => void;
  /** 以 P2P 傳送檔案（未提供則不顯示檔案功能）。 */
  onSendFile?: (file: File) => void;
  /**
   * 以**原生選檔對話框**挑檔（ADR-0103）；提供時 📎 走這條（拿得到完整路徑）。
   * 未提供（瀏覽器）則退回 `<input type=file>`——那條路拿不到路徑，是瀏覽器的安全限制。
   */
  onAttach?: () => void;
  /** 原生拖放（ADR-0104）正懸停在本對話上：與 HTML5 拖放共用同一個 highlight。 */
  dropActive?: boolean;
  /** 發起語音/視訊通話（未提供則不顯示通話按鈕）。 */
  onStartCall?: (media: CallMedia) => void;
  /** 群組模式：以發送者公鑰解析顯示暱稱（提供即為群組視窗）。 */
  senderName?: (pubkey: string) => string;
  /** 離開群組（群組視窗才提供）。 */
  onLeaveGroup?: () => void;
  /** 導出此對話紀錄（ADR-0094）；未提供則不顯示。 */
  onExport?: () => void;
  /** 開啟歷史紀錄（ADR-0111）：只有該對話真的有封存時才傳入。 */
  onHistory?: () => void;
  /** 使用者重新指定原圖位置後回寫 savedPath（ADR-0102）。 */
  onFileRelocated?: (messageId: string, newPath: string) => void;
  /**
   * 外部插入文字到草稿（ADR-0097 右欄計算機）：`nonce` 變動時把 `text` 附加到 composer。
   * 用單向指令而非把草稿狀態上提，避免動到既有 composer 狀態機（@提及建議、串內 composer 等）。
   */
  insert?: { text: string; nonce: number };
  /** 群組成員清單（提供即顯示 👥 成員管理入口，M9）。 */
  groupMembers?: MentionCandidate[];
  /** 自己是否為群組管理者（可增/移成員）。 */
  isGroupAdmin?: boolean;
  /** 可加入的聯絡人（不在群內者），供管理者新增成員。 */
  addableContacts?: MentionCandidate[];
  /** 管理者新增成員。 */
  onAddMember?: (pubkey: string) => void;
  /** 管理者移除成員。 */
  onRemoveMember?: (pubkey: string) => void;
  /** 企業政策停用貼圖時隱藏貼圖鈕（ADR-0048）。 */
  stickersDisabled?: boolean;
  /** 公告頻道唯讀（ADR-0049）：非管理者隱藏輸入區。 */
  readOnly?: boolean;
  /** 內嵌模式（ADR-0079 Q3）：三欄中欄用——填滿容器、無浮動標題列/縮放把手。 */
  embedded?: boolean;
  onClose: () => void;
}

/** 訊息列視窗化：初始只渲染最近這麼多則，點「載入較早」再往前展開（審查 P0-3）。 */
const MESSAGE_WINDOW = 200;
/** 主頻道單則訊息文字截斷門檻（字數）；超過即只顯示前段 + 「展開全文」開右側詳情面板。 */
const MESSAGE_TRUNCATE_CHARS = 600;

export function ConversationWindow(props: ConversationProps): JSX.Element {
  const { t } = useI18n();
  const { confirm, alert, prompt } = useDialog(); // 統一自訂對話框（ADR-0139）
  const { self, contact, messages } = props;
  // 檢視此對話（開窗或新訊息到達）→ 送已讀回條（ADR-0058；App 端另以聚焦把關）。
  const onMarkRead = props.onMarkRead;
  useEffect(() => {
    onMarkRead?.();
  }, [contact.pubkey, messages.length, onMarkRead]);
  const [visibleCount, setVisibleCount] = useState(MESSAGE_WINDOW);
  const [text, setText] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** 快速插入模板（➕ 選單）：插到游標處（非行首自動補換行），並選取佔位字。 */
  const insertSnippet = (tpl: InsertTemplate): void => {
    const el = composerRef.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const prefix = at > 0 && text[at - 1] !== "\n" ? "\n" : "";
    setText(text.slice(0, at) + prefix + tpl.text + text.slice(end));
    const s = at + prefix.length + tpl.selStart;
    const e2 = at + prefix.length + tpl.selEnd;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s, e2);
    });
  };
  const [showEmo, setShowEmo] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [stickerTab, setStickerTab] = useState<string>(STICKER_PACK_ORDER[0] ?? "");
  const [recent, setRecent] = useState<StickerRef[]>([]);
  const [favorites, setFavorites] = useState<StickerRef[]>([]);
  const [library, setLibrary] = useState<CustomSticker[]>(() => loadLibrary());
  const stickerFileRef = useRef<HTMLInputElement>(null);
  /** 貼圖編輯器（ADR-0033）：null=關閉；base 為底圖（空白畫布時省略）。 */
  const [editor, setEditor] = useState<{ base?: string; label?: string } | null>(null);
  /** 文字觸發貼圖（ADR-0037）。 */
  const [triggers, setTriggers] = useState<TriggerEntry[]>(() => loadTriggers());
  const [trigSel, setTrigSel] = useState(0);
  const [trigDismissed, setTrigDismissed] = useState(false);
  const [showTrigPanel, setShowTrigPanel] = useState(false);
  /** @提及建議（ADR-0050）。 */
  const [menSel, setMenSel] = useState(0);
  const [menDismissed, setMenDismissed] = useState(false);
  /** 對話串面板（ADR-0051）：開啟中的串根訊息 id（null＝未開）。 */
  const [threadRoot, setThreadRoot] = useState<string | null>(null);
  const [threadText, setThreadText] = useState("");
  /** 長訊息詳情面板：開啟中的訊息 id（null＝未開）。與對話串面板互斥（共用右側槽位）。 */
  const [detailMsgId, setDetailMsgId] = useState<string | null>(null);
  /** 開右側面板：兩者互斥（Slack 風，右側一次只一個）。 */
  const openThread = (id: string): void => {
    setDetailMsgId(null);
    setThreadRoot(id);
  };
  const openDetail = (id: string): void => {
    setThreadRoot(null);
    setThreadText("");
    setDetailMsgId(id);
  };
  const detailMsg = detailMsgId !== null ? messages.find((m) => m.id === detailMsgId) : undefined;
  // Slack 風：Esc 關閉右側面板（但輸入框內的 Esc 留給既有處理，如關閉 @提及建議）。
  useEffect(() => {
    if (threadRoot === null && detailMsgId === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      setThreadRoot(null);
      setThreadText("");
      setDetailMsgId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [threadRoot, detailMsgId]);
  /** 串內 composer 的 @提及建議（獨立於主 composer）。 */
  const [threadMenSel, setThreadMenSel] = useState(0);
  const [threadMenDismissed, setThreadMenDismissed] = useState(false);
  const [showAlbum, setShowAlbum] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  // 燈箱（ADR-0102）：帶著訊息資訊，才能在只有縮圖時嘗試讀回原檔／讓使用者重新指定位置。
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [ttl, setTtl] = useState(0);
  const [dragging, setDragging] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 本地個人化（ADR-0077）：訂閱變更以即時反映背景/頭像；背景套用到訊息區。
  usePersonalizeTick();
  const chatBg = chatBgCss(getChatBg(contact.pubkey));

  // O1 對話框縮放：掛載時套用全域尺寸偏好（ADR-0077）。內嵌模式（Q3）由中欄決定尺寸、不套用。
  useEffect(() => {
    const el = rootRef.current;
    if (!el || props.embedded) return;
    const saved = getConvoSize();
    if (saved) {
      el.style.width = `${saved.w}px`;
      el.style.height = `${saved.h}px`;
    }
  }, [props.embedded]);
  // 右下角把手拖曳縮放：夾在 min/max，放開時持久化為全域偏好。
  const startResize = (e: ReactMouseEvent): void => {
    e.preventDefault();
    const el = rootRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;
    const MIN_W = 300;
    const MIN_H = 320;
    const MAX_W = 900;
    const maxH = Math.round(window.innerHeight * 0.92);
    const onMove = (ev: MouseEvent): void => {
      el.style.width = `${Math.max(MIN_W, Math.min(MAX_W, startW + ev.clientX - startX))}px`;
      el.style.height = `${Math.max(MIN_H, Math.min(maxH, startH + ev.clientY - startY))}px`;
    };
    const onUp = (): void => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (el.offsetWidth > 0 && el.offsetHeight > 0) setConvoSize({ w: el.offsetWidth, h: el.offsetHeight });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // 對話串（ADR-0051）：主頻道排除回覆、彙整各根回覆數；回覆只在右側面板顯示。
  const channel = mainMessages(messages);
  const counts = replyCounts(messages);
  // 訊息列視窗化：只渲染最近 visibleCount 則，避免長對話一次渲染上千 DOM 節點。
  const hiddenCount = Math.max(0, channel.length - visibleCount);
  const shown = hiddenCount > 0 ? channel.slice(hiddenCount) : channel;
  // 擁有中的自製貼圖 id 集合：整個訊息列共用一份（不再每則訊息各建一個 Set）。
  const ownedIds = new Set(library.map((s) => s.id));

  // 算式預覽（ADR-0097）：純函式判定草稿是否為算式；不是就回 null（不顯示）。
  const calc = calcPreview(text);

  // 右欄計算機的「插入」（ADR-0097）：以 nonce 變化為訊號，把文字附加到草稿（不接管草稿狀態）。
  const insertNonce = props.insert?.nonce;
  useEffect(() => {
    const ins = props.insert;
    if (!ins || !ins.text) return;
    setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${ins.text}` : ins.text));
    composerRef.current?.focus();
    // 只在 nonce 變動時觸發（同一段文字可重複插入）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertNonce]);

  /**
   * 群組已讀呈現（ADR-0095）：依成員數分級——≤5 名單制（顯示誰已讀）、6–10 計數制（已讀 M/N）、
   * >10 完全不記（回 undefined，不顯示）。只對自己送出的訊息有意義。
   */
  const groupReadOf = (m: ChatMessage): GroupRead | undefined => {
    const members = props.groupMembers;
    if (!m.outgoing || !members) return undefined; // 非群組或非自己送出
    const total = members.length - 1; // 其他成員數（不含自己）
    if (total <= 0) return undefined;
    const mode = groupReceiptMode(members.length);
    if (mode === "off") return undefined; // 大群不記
    const readers = Object.entries(m.receipts ?? {})
      .filter(([, v]) => v === "read")
      .map(([pk]) => pk);
    return {
      mode,
      total,
      count: readers.length,
      names: readers.map((pk) => props.senderName?.(pk) ?? `${pk.slice(0, 8)}…`),
    };
  };

  // 相簿（ADR-0023／0102）：可顯示＝有原圖 blob（本 session）**或有縮圖**（跨 session 存活）。
  const images = messages
    .filter((m) => m.file?.mime.startsWith("image/") && (m.file.url || m.file.thumb))
    .map((m) => lightboxItem(m));

  // 貼圖偏好：開啟選擇器時載入「最近／最愛」。
  useEffect(() => {
    if (!showStickers) return;
    setRecent(loadRecent());
    setFavorites(loadFavorites());
  }, [showStickers]);

  const sendSticker = (pack: string, id: string): void => {
    props.onSend(formatSticker(pack, id));
    setRecent(recordRecent({ pack, id }));
    setShowStickers(false);
  };
  const sendCustomSticker = (s: CustomSticker): void => {
    props.onSend(formatCustomSticker({ label: s.label, svg: s.svg }));
    setRecent(recordRecent({ pack: CUSTOM_PACK, id: s.id }));
    setShowStickers(false);
  };
  const flipFavorite = (ref: StickerRef): void => {
    const next = toggleFavorite(favorites, ref);
    setFavorites(next);
    saveFavorites(next);
  };

  // 貼圖庫寫入（匯入 / fork / 點擊收藏共用）；失敗以 alert 呈現拒收原因。
  const acquireSticker = (label: string, svg: string): boolean => {
    const r = addSticker(library, label, svg);
    if (!r.ok) {
      void alert(t("sticker_importFail", { reason: r.reason }));
      return false;
    }
    setLibrary(r.list);
    saveLibrary(r.list);
    return true;
  };
  const deleteCustom = (id: string): void => {
    const next = removeSticker(library, id);
    setLibrary(next);
    saveLibrary(next);
  };
  // 統一解析：內建包或自製庫（供最近/最愛分頁）。
  const resolveAny = (ref: StickerRef): { label: string; svg: string } | undefined =>
    ref.pack === CUSTOM_PACK ? findSticker(library, ref.id) : resolveSticker(ref.pack, ref.id);

  // 文字觸發貼圖（ADR-0037）：尾端比對（字首索引）、Tab/點擊送出、⌨ 設定。
  const trigIndex = useMemo(() => buildTriggerIndex(triggers), [triggers]);
  const trigMatches: TriggerMatch[] = trigDismissed
    ? []
    : matchTriggers(text, triggers, trigIndex).filter((m) => resolveAny(m.entry.ref) !== undefined);
  const trigActive = Math.min(trigSel, Math.max(trigMatches.length - 1, 0));
  const acceptTrigger = (m: TriggerMatch): void => {
    setText(text.slice(0, text.length - m.matchedLen));
    setTrigSel(0);
    const ref = m.entry.ref;
    if (ref.pack === CUSTOM_PACK) {
      const st = findSticker(library, ref.id);
      if (st) sendCustomSticker(st);
    } else {
      sendSticker(ref.pack, ref.id);
    }
  };
  const promptTriggers = async (ref: StickerRef, label: string): Promise<void> => {
    const current = triggersFor(triggers, ref).join(" ");
    const input = await prompt({ message: t("trigger_prompt", { name: label }), defaultValue: current });
    if (input === null) return;
    let list = removeTriggersFor(triggers, ref);
    const skipped: string[] = [];
    for (const raw of input.split(/[\s,，、]+/).filter(Boolean)) {
      const norm = normalizeTrigger(raw);
      const occupied = norm ? list.find((e) => e.trigger === norm) : undefined;
      if (occupied && !(await confirm(t("trigger_conflict", { trigger: occupied.trigger })))) continue;
      const r = setTrigger(list, raw, ref);
      if (r.ok) list = r.list;
      else skipped.push(raw);
    }
    if (skipped.length > 0) void alert(t("trigger_skipped", { list: skipped.join(", ") }));
    setTriggers(list);
    saveTriggers(list);
  };
  // 觸發字總覽面板：改名 / 刪除（ADR-0037 後續）。
  const renameOneTrigger = async (oldTrigger: string): Promise<void> => {
    const input = await prompt({ message: t("trigger_renamePrompt"), defaultValue: oldTrigger });
    if (input === null) return;
    const norm = normalizeTrigger(input);
    const occupied = norm && norm !== oldTrigger ? triggers.find((e) => e.trigger === norm) : undefined;
    if (occupied && !(await confirm(t("trigger_conflict", { trigger: occupied.trigger })))) return;
    const r = renameTrigger(triggers, oldTrigger, input);
    if (!r.ok) {
      void alert(t("trigger_skipped", { list: input }));
      return;
    }
    setTriggers(r.list);
    saveTriggers(r.list);
  };
  const deleteOneTrigger = (trigger: string): void => {
    const next = removeTrigger(triggers, trigger);
    setTriggers(next);
    saveTriggers(next);
  };

  // 匯入：SVG 檔直接驗證；點陣圖經 canvas 縮圖重編碼後包成 SVG（ADR-0032）。
  const importStickerFile = async (f: File): Promise<void> => {
    const stem = f.name.replace(/\.[^.]+$/, "");
    if (f.type === "image/svg+xml" || f.name.toLowerCase().endsWith(".svg")) {
      acquireSticker(stem, (await f.text()).trim());
      return;
    }
    if (!f.type.startsWith("image/")) {
      void alert(t("sticker_importFail", { reason: "not-image" }));
      return;
    }
    const bitmap = await createImageBitmap(f);
    const side = 256;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d")!;
    // 等比置中縮放
    const scale = Math.min(side / bitmap.width, side / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (side - w) / 2, (side - h) / 2, w, h);
    bitmap.close();
    const dataUri = canvas.toDataURL("image/webp", 0.85);
    acquireSticker(stem, wrapRasterAsSvg(dataUri, side));
  };

  const dropFiles = (files: FileList | null) => {
    if (!files || !props.onSendFile) return;
    for (const f of Array.from(files)) props.onSendFile(f);
  };

  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    if (!props.onSendFile || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size > 0) {
          props.onSendFile?.(new File([blob], "voice-message.webm", { type }));
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      /* 無麥克風或被拒：略過 */
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const toggleRecording = () => (recording ? stopRecording() : void startRecording());

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, props.typing]);

  useEffect(() => {
    if (props.nudgeSignal === 0) return;
    const el = rootRef.current;
    if (!el) return;
    el.classList.remove("nudging");
    void el.offsetWidth; // 強制 reflow 以重啟動畫
    el.classList.add("nudging");
  }, [props.nudgeSignal]);

  // @提及自動完成（ADR-0050）：進行中的 @token → 候選列。
  const menSuggest = !menDismissed && props.mentionCandidates ? suggestMentions(text, props.mentionCandidates) : null;
  const menList = menSuggest?.candidates ?? [];
  const menActive = Math.min(menSel, Math.max(menList.length - 1, 0));
  const acceptMention = (cand: MentionCandidate): void => {
    setText(applyMention(text, menSuggest!, cand));
    setMenSel(0);
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    const mentions = props.mentionCandidates ? parseMentions(body, props.mentionCandidates) : [];
    props.onSend(body, ttl > 0 ? ttl : undefined, mentions.length > 0 ? mentions : undefined);
    setText("");
  };

  // 對話串（ADR-0051）：發送者顯示名稱、串內回覆送出。
  const whoOf = (m: ChatMessage): string =>
    m.outgoing ? self.name : m.sender && props.senderName ? props.senderName(m.sender) : contact.name;
  const sendThread = () => {
    const body = threadText.trim();
    if (!body || threadRoot === null) return;
    const mentions = props.mentionCandidates ? parseMentions(body, props.mentionCandidates) : [];
    props.onSend(body, undefined, mentions.length > 0 ? mentions : undefined, threadRoot);
    setThreadText("");
  };
  // 串內 @提及自動完成（ADR-0050/0051）。
  const threadMenSuggest =
    !threadMenDismissed && props.mentionCandidates ? suggestMentions(threadText, props.mentionCandidates) : null;
  const threadMenList = threadMenSuggest?.candidates ?? [];
  const threadMenActive = Math.min(threadMenSel, Math.max(threadMenList.length - 1, 0));
  const acceptThreadMention = (cand: MentionCandidate): void => {
    setThreadText(applyMention(threadText, threadMenSuggest!, cand));
    setThreadMenSel(0);
  };

  return (
    <div className={`convo-dock${props.embedded ? " convo-dock--embed" : ""}`}>
    // data-convo（ADR-0104）：原生拖放只給座標，靠它命中測試「掉在哪個對話上」。
    <div
      className={`win convo${props.embedded ? " convo--embed" : ""}`}
      ref={rootRef}
      data-contact={contact.name}
      data-convo={contact.pubkey}
    >
      <div className="win__title">
        <span>{contact.name}</span>
        <span className="spacer" />
        {props.onStartCall ? (
          <>
            <span
              className="win__btn"
              role="button"
              title={t("call_audio")}
              data-testid="start-call-audio"
              onClick={() => props.onStartCall!("audio")}
            >
              📞
            </span>
            <span
              className="win__btn"
              role="button"
              title={t("call_video")}
              data-testid="start-call-video"
              onClick={() => props.onStartCall!("video")}
            >
              🎥
            </span>
          </>
        ) : null}
        {props.groupMembers ? (
          <span
            className="win__btn"
            role="button"
            title={t("members_title")}
            data-testid="members-btn"
            onClick={() => setShowMembers(true)}
          >
            👥
          </span>
        ) : null}
        {props.onLeaveGroup ? (
          <span
            className="win__btn"
            role="button"
            title={t("group_leave")}
            data-testid="leave-group"
            onClick={props.onLeaveGroup}
          >
            ⎋
          </span>
        ) : null}
        {props.onHistory ? (
          <span
            className="win__btn"
            role="button"
            title={t("history_open")}
            data-testid="open-history"
            onClick={props.onHistory}
          >
            🗄
          </span>
        ) : null}
        {props.onExport ? (
          <span
            className="win__btn"
            role="button"
            title={t("export_this")}
            data-testid="export-convo"
            onClick={props.onExport}
          >
            📤
          </span>
        ) : null}
        <ChatBgPicker pubkey={contact.pubkey} />
        <span className="win__btn" onClick={props.onClose} role="button" aria-label={t("convo_close")}>×</span>
      </div>

      <div className="convo__head">
        <b>{contact.name}</b>
        <div className="sub">
          {contact.status === "offline" ? t("convo_offlineNotice") : contact.statusMessage}
          {contact.nowPlaying ? `　♪ ${contact.nowPlaying}` : ""}
        </div>
      </div>

      <div
        className={`convo__body ${dragging || props.dropActive ? "dropping" : ""}`}
        {...(chatBg ? { style: { background: chatBg } } : {})}
        onDragOver={(e) => {
          if (!props.onSendFile) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!props.onSendFile) return;
          e.preventDefault();
          setDragging(false);
          dropFiles(e.dataTransfer.files);
        }}
      >
        {dragging ? <div className="dropzone">{t("file_dropHint")}</div> : null}
        <div className="log" ref={logRef} data-testid="log">
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="log__earlier"
              data-testid="load-earlier"
              onClick={() => setVisibleCount((n) => n + MESSAGE_WINDOW)}
            >
              {t("convo_loadEarlier", { count: hiddenCount })}
            </button>
          ) : null}
          {shown.map((m) => (
            <MessageLine
              key={m.id}
              message={m}
              who={whoOf(m)}
              reactions={props.reactions?.[m.id] ?? []}
              unsent={props.unsent?.has(m.id) ?? false}
              expired={props.expired?.has(m.id) ?? false}
              onReact={props.onReact}
              onUnsend={props.onUnsend}
              onView={setLightbox}
              ownedIds={ownedIds}
              onOwnSticker={acquireSticker}
              replyCount={counts.get(m.id) ?? 0}
              onOpenThread={props.readOnly ? undefined : () => openThread(m.id)}
              onExpand={() => openDetail(m.id)}
              groupRead={groupReadOf(m)}
            />
          ))}
        </div>
        <div className="pics">
          <EditableAvatar id={contact.pubkey} name={contact.name} />
          <div className="cap">{contact.name}</div>
          <EditableAvatar id={self.pubkey} name={self.name} />
          <div className="cap">{self.name}</div>
        </div>
      </div>

      <div className="typing">{props.typing ? t("convo_typing", { name: contact.name }) : ""}</div>

      <div className="toolbar" style={props.readOnly ? { display: "none" } : undefined}>
        <button className="tool" title={t("convo_emojiTitle")} onClick={() => setShowEmo((v) => !v)}>🙂</button>
        {props.stickersDisabled ? null : (
          <button
            className="tool"
            title={t("sticker_title")}
            onClick={() => setShowStickers((v) => !v)}
          >
            🧸
          </button>
        )}
        <button className="tool" title={t("convo_nudgeTitle")} onClick={props.onNudge}>{t("convo_nudge")}</button>
        <button
          className="tool"
          title={t("album_open")}
          data-testid="album-btn"
          onClick={() => setShowAlbum(true)}
        >
          🖼️{images.length > 0 ? <span className="tool__count">{images.length}</span> : null}
        </button>
        {props.onSendFile ? (
          <>
            <button
              className="tool"
              title={t("file_attach")}
              onClick={() => (props.onAttach ? props.onAttach() : fileRef.current?.click())}
            >
              📎
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                dropFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              className={`tool ${recording ? "tool--recording" : ""}`}
              title={recording ? t("voice_stop") : t("voice_record")}
              aria-pressed={recording}
              onClick={toggleRecording}
            >
              {recording ? "⏹" : "🎤"}
            </button>
          </>
        ) : null}
        <select
          className="tool tool--timer"
          title={t("convo_timerTitle")}
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
        >
          <option value={0}>⏱ {t("convo_timerOff")}</option>
          <option value={60}>⏱ {t("convo_timer1m")}</option>
          <option value={3600}>⏱ {t("convo_timer1h")}</option>
          <option value={86400}>⏱ {t("convo_timer1d")}</option>
        </select>
      </div>
      {showEmo && (
        <div className="emopick">
          {EMOTICONS.map((e) => (
            <span key={e} role="button" onClick={() => setText((t) => t + e)}>{e}</span>
          ))}
        </div>
      )}
      {recording && (
        <div className="recbar" role="status">
          <span className="recdot" /> {t("voice_recording")}
        </div>
      )}
      {showStickers && (() => {
        const currentRefs: StickerRef[] =
          stickerTab === "__recent"
            ? recent
            : stickerTab === "__fav"
              ? favorites
              : stickerTab === "__mine"
                ? library.map((s) => ({ pack: CUSTOM_PACK, id: s.id }))
                : Object.keys(STICKER_PACKS[stickerTab] ?? {}).map((id) => ({ pack: stickerTab, id }));
        const visible = currentRefs.filter((r) => resolveAny(r) !== undefined);
        return (
          <div className="stickerpick" data-testid="stickerpick">
            <div className="stickerpick__tabs" role="tablist" aria-label={t("sticker_title")}>
              <button
                type="button"
                role="tab"
                aria-selected={stickerTab === "__recent"}
                className={`stickerpick__tab${stickerTab === "__recent" ? " on" : ""}`}
                title={t("sticker_recent")}
                aria-label={t("sticker_recent")}
                onClick={() => setStickerTab("__recent")}
              >
                🕘
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={stickerTab === "__fav"}
                className={`stickerpick__tab${stickerTab === "__fav" ? " on" : ""}`}
                title={t("sticker_favorites")}
                aria-label={t("sticker_favorites")}
                onClick={() => setStickerTab("__fav")}
              >
                ⭐
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={stickerTab === "__mine"}
                className={`stickerpick__tab${stickerTab === "__mine" ? " on" : ""}`}
                title={t("sticker_custom")}
                aria-label={t("sticker_custom")}
                onClick={() => setStickerTab("__mine")}
              >
                ✏️
              </button>
              {STICKER_PACK_ORDER.map((pack) => {
                const meta = STICKER_PACK_META[pack]!;
                const coverSvg = stickerSvg(pack, meta.cover);
                return (
                  <button
                    type="button"
                    role="tab"
                    key={pack}
                    aria-selected={stickerTab === pack}
                    className={`stickerpick__tab${stickerTab === pack ? " on" : ""}`}
                    title={meta.title}
                    aria-label={meta.title}
                    onClick={() => setStickerTab(pack)}
                  >
                    {coverSvg ? <img src={svgToDataUri(coverSvg)} alt="" /> : meta.title}
                  </button>
                );
              })}
              <button
                type="button"
                className="stickerpick__tab stickerpick__tab--manage"
                title={t("trigger_manage")}
                aria-label={t("trigger_manage")}
                data-testid="trigger-manage"
                onClick={() => setShowTrigPanel(true)}
              >
                ⌨
              </button>
            </div>
            <div className="stickerpick__grid">
              {stickerTab === "__mine" ? (
                <>
                  <button
                    type="button"
                    className="stickerpick__item stickerpick__import"
                    title={t("sticker_import")}
                    aria-label={t("sticker_import")}
                    onClick={() => stickerFileRef.current?.click()}
                  >
                    ＋
                  </button>
                  <button
                    type="button"
                    className="stickerpick__item stickerpick__import"
                    title={t("editor_new")}
                    aria-label={t("editor_new")}
                    data-testid="editor-open"
                    onClick={() => setEditor({})}
                  >
                    🖌
                  </button>
                  <input
                    ref={stickerFileRef}
                    type="file"
                    accept=".svg,image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void importStickerFile(f);
                      e.target.value = "";
                    }}
                  />
                </>
              ) : null}
              {visible.length === 0 && stickerTab !== "__mine" ? (
                <div className="stickerpick__empty">{t("sticker_empty")}</div>
              ) : (
                visible.map((ref) => {
                  const s = resolveAny(ref)!;
                  const fav = isFavorite(favorites, ref);
                  const custom = ref.pack === CUSTOM_PACK;
                  return (
                    <div className="stickerpick__cell" key={`${ref.pack}/${ref.id}`}>
                      <button
                        type="button"
                        className="stickerpick__item"
                        title={s.label}
                        aria-label={s.label}
                        onClick={() =>
                          custom
                            ? sendCustomSticker(findSticker(library, ref.id)!)
                            : sendSticker(ref.pack, ref.id)
                        }
                      >
                        <img src={svgToDataUri(s.svg)} alt={s.label} />
                      </button>
                      <button
                        type="button"
                        className="stickerpick__act stickerpick__act--topleft"
                        aria-label={t("trigger_set")}
                        title={t("trigger_set")}
                        onClick={() => promptTriggers(ref, s.label)}
                      >
                        ⌨
                      </button>
                      <button
                        type="button"
                        className={`stickerpick__fav${fav ? " on" : ""}`}
                        aria-label={t("sticker_favToggle")}
                        aria-pressed={fav}
                        title={t("sticker_favToggle")}
                        onClick={() => flipFavorite(ref)}
                      >
                        {fav ? "★" : "☆"}
                      </button>
                      {custom ? (
                        <>
                          <button
                            type="button"
                            className="stickerpick__act"
                            aria-label={t("sticker_delete")}
                            title={t("sticker_delete")}
                            onClick={() => {
                              void confirm({ message: t("sticker_deleteConfirm", { name: s.label }), danger: true }).then(
                                (ok) => {
                                  if (ok) deleteCustom(ref.id);
                                },
                              );
                            }}
                          >
                            ✕
                          </button>
                          <button
                            type="button"
                            className="stickerpick__act stickerpick__act--left"
                            aria-label={t("editor_fromBase")}
                            title={t("editor_fromBase")}
                            onClick={() => setEditor({ base: s.svg, label: s.label })}
                          >
                            🖉
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="stickerpick__act"
                          aria-label={t("sticker_fork")}
                          title={t("sticker_fork")}
                          onClick={() => acquireSticker(s.label, s.svg)}
                        >
                          ⑂
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })()}

      {menList.length > 0 ? (
        <div className="menbar" data-testid="mention-bar">
          {menList.map((c, i) => (
            <button
              key={c.pubkey}
              type="button"
              className={`menbar__item${i === menActive ? " on" : ""}`}
              title={c.name}
              onMouseDown={(e) => {
                e.preventDefault(); // 避免 textarea 失焦
                acceptMention(c);
              }}
            >
              <span className="menbar__avatar" style={{ background: avatarColor(c.pubkey) }}>{initial(c.name)}</span>
              <span>@{c.name}</span>
            </button>
          ))}
          <span className="trigbar__hint">{t("mention_hint")}</span>
        </div>
      ) : null}

      {trigMatches.length > 0 ? (
        <div className="trigbar" data-testid="trigger-bar">
          {trigMatches.map((m, i) => {
            const st = resolveAny(m.entry.ref)!;
            return (
              <button
                key={m.entry.trigger}
                type="button"
                className={`trigbar__item${i === trigActive ? " on" : ""}`}
                title={m.entry.trigger}
                onClick={() => acceptTrigger(m)}
              >
                <img src={svgToDataUri(st.svg)} alt={st.label} />
                <span>{m.entry.trigger}</span>
              </button>
            );
          })}
          <span className="trigbar__hint">{t("trigger_hint")}</span>
        </div>
      ) : null}

      {/* 算式即時預覽（ADR-0097）：純本地計算，草稿不外流。點擊把「= 結果」附加到草稿。 */}
      {!props.readOnly && calc ? (
        <button
          className="calcchip"
          data-testid="calc-chip"
          title={t("calc_insertHint")}
          onClick={() => {
            setText((prev) => `${prev.trimEnd()} = ${calc.result}`);
            composerRef.current?.focus();
          }}
        >
          <span className="calcchip__eq">=</span>
          <span className="calcchip__val">{calc.result}</span>
        </button>
      ) : null}
      {props.readOnly ? (
        <div className="composer composer--ro" data-testid="announce-readonly">📢 公告頻道（唯讀，僅管理者可發布）</div>
      ) : (
      <div className="composer">
        <textarea
          ref={composerRef}
          aria-label={t("convo_composerPlaceholder")}
          value={text}
          placeholder={t("convo_composerPlaceholder")}
          onChange={(e) => {
            setText(e.target.value);
            setTrigSel(0);
            setTrigDismissed(false);
            setMenSel(0);
            setMenDismissed(false);
            props.onTyping();
          }}
          onPaste={(e) => {
            // 貼上時清除網址追蹤參數（ADR-0038）；關閉開關或無可清除時走原生貼上。
            if (!cleanOnPasteEnabled()) return;
            const pasted = e.clipboardData.getData("text/plain");
            const { text: cleanedPaste, cleaned } = cleanText(pasted);
            if (cleaned === 0) return;
            e.preventDefault();
            const el = e.currentTarget;
            const start = el.selectionStart ?? text.length;
            const end = el.selectionEnd ?? text.length;
            setText(text.slice(0, start) + cleanedPaste + text.slice(end));
            const caret = start + cleanedPaste.length;
            requestAnimationFrame(() => el.setSelectionRange(caret, caret));
            setTrigSel(0);
            setTrigDismissed(false);
            props.onTyping();
          }}
          onKeyDown={(e) => {
            if (menList.length > 0) {
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                acceptMention(menList[menActive]!);
                return;
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setMenSel((menActive + delta + menList.length) % menList.length);
                return;
              }
              if (e.key === "Escape") {
                setMenDismissed(true);
                return;
              }
            }
            if (trigMatches.length > 0) {
              if (e.key === "Tab") {
                e.preventDefault();
                acceptTrigger(trigMatches[trigActive]!);
                return;
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setTrigSel((trigActive + delta + trigMatches.length) % trigMatches.length);
                return;
              }
              if (e.key === "Escape") {
                setTrigDismissed(true);
                return;
              }
            }
            if (e.key === "Tab") {
              // Tab 縮排／Shift+Tab 退排（快選未開啟時；供清單巢狀與程式碼區塊）
              e.preventDefault();
              const el = e.currentTarget;
              const r = indentText(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, e.shiftKey);
              setText(r.text);
              requestAnimationFrame(() => el.setSelectionRange(r.start, r.end));
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <ComposerInsert onPick={insertSnippet} />
        {props.onRewrite ? (
          <ComposerRewrite
            text={text}
            onRewrite={props.onRewrite}
            onAdopt={setText}
            {...(props.onCheckAiAvailable ? { onCheckAvailable: props.onCheckAiAvailable } : {})}
          />
        ) : null}
        <button className="composer__send" onClick={send}>{t("convo_send")}</button>
      </div>
      )}

      {showAlbum && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={t("album_open")} onClick={() => setShowAlbum(false)}>
          <div className="modal__box win album" onClick={(e) => e.stopPropagation()}>
            <div className="win__title">
              <span>{t("album_title", { count: images.length })}</span>
              <span className="spacer" />
              <span className="win__btn" role="button" aria-label={t("convo_close")} onClick={() => setShowAlbum(false)}>×</span>
            </div>
            <div className="album__body" data-testid="album">
              {images.length === 0 ? (
                <div className="album__empty">{t("album_empty")}</div>
              ) : (
                images.map((img) => (
                  <button key={img.id} className="album__item" onClick={() => setLightbox(img)}>
                    <img src={img.preview} alt={img.name || t("image_alt")} />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <Lightbox
          item={lightbox}
          onClose={() => setLightbox(null)}
          onRelocated={(id, path) => props.onFileRelocated?.(id, path)}
        />
      )}

      {showMembers && props.groupMembers && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={t("members_title")} onClick={() => setShowMembers(false)}>
          <div className="modal__box win" onClick={(e) => e.stopPropagation()}>
            <div className="win__title">
              <span>{t("members_title")}（{props.groupMembers.length}）</span>
              <span className="spacer" />
              <span className="win__btn" role="button" aria-label={t("convo_close")} onClick={() => setShowMembers(false)}>×</span>
            </div>
            <div className="groupmodal" data-testid="members-panel">
              {props.groupMembers.map((m) => (
                <div className="member__row" key={m.pubkey}>
                  <span className="menbar__avatar" style={{ background: avatarColor(m.pubkey) }}>{initial(m.name)}</span>
                  <span className="member__name">
                    {m.name}
                    {m.pubkey === self.pubkey ? `（${t("members_you")}）` : ""}
                  </span>
                  {props.isGroupAdmin && props.onRemoveMember && m.pubkey !== self.pubkey ? (
                    <button
                      type="button"
                      className="member__remove"
                      title={t("members_remove")}
                      aria-label={t("members_remove")}
                      onClick={() => props.onRemoveMember!(m.pubkey)}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}
              {props.isGroupAdmin && props.addableContacts && props.addableContacts.length > 0 ? (
                <>
                  <div className="groupmodal__label">{t("members_add")}</div>
                  {props.addableContacts.map((c) => (
                    <button
                      type="button"
                      className="member__add"
                      key={c.pubkey}
                      onClick={() => props.onAddMember?.(c.pubkey)}
                    >
                      ＋ {c.name}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {editor && (
        <StickerEditor
          base={editor.base}
          initialLabel={editor.label}
          onSave={acquireSticker}
          onClose={() => setEditor(null)}
        />
      )}

      {showTrigPanel && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={t("trigger_manage")} onClick={() => setShowTrigPanel(false)}>
          <div className="modal__box win trigpanel" onClick={(e) => e.stopPropagation()}>
            <div className="win__title">
              <span>{t("trigger_manage")}（{triggers.length} / {TRIGGERS_MAX}）</span>
              <span className="spacer" />
              <span className="win__btn" role="button" aria-label={t("convo_close")} onClick={() => setShowTrigPanel(false)}>×</span>
            </div>
            <div className="trigpanel__body" data-testid="trigger-panel">
              {triggers.length === 0 ? (
                <div className="trigpanel__empty">{t("trigger_empty")}</div>
              ) : (
                [...triggers]
                  .sort((a, b) => a.trigger.localeCompare(b.trigger))
                  .map((e) => {
                    const st = resolveAny(e.ref);
                    return (
                      <div className="trigpanel__row" key={e.trigger}>
                        {st ? (
                          <img src={svgToDataUri(st.svg)} alt={st.label} />
                        ) : (
                          <span className="trigpanel__gone" title={t("trigger_deleted")}>🚫</span>
                        )}
                        <code className="trigpanel__trigger">{e.trigger}</code>
                        <span className="trigpanel__label">{st ? st.label : t("trigger_deleted")}</span>
                        <button
                          type="button"
                          title={t("trigger_rename")}
                          aria-label={t("trigger_rename")}
                          onClick={() => renameOneTrigger(e.trigger)}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          title={t("trigger_delete")}
                          aria-label={t("trigger_delete")}
                          onClick={() => deleteOneTrigger(e.trigger)}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}
      <div className="convo__resize" onMouseDown={startResize} data-testid="convo-resize" title={t("convo_resize")} />
    </div>
    {threadRoot !== null ? (
      <div className="win convo thread-panel" data-testid="thread-panel">
        <div className="win__title">
          <span>🧵 {t("thread_title")}</span>
          <span className="spacer" />
          <span
            className="win__btn"
            role="button"
            aria-label={t("convo_close")}
            onClick={() => {
              setThreadRoot(null);
              setThreadText("");
            }}
          >
            ×
          </span>
        </div>
        <div className="convo__body">
          <div className="log" data-testid="thread-log">
            {threadMessages(messages, threadRoot).map((m) => (
              <MessageLine
                key={m.id}
                message={m}
                who={whoOf(m)}
                reactions={props.reactions?.[m.id] ?? []}
                unsent={props.unsent?.has(m.id) ?? false}
                expired={props.expired?.has(m.id) ?? false}
                onReact={props.onReact}
                onUnsend={props.onUnsend}
                onView={setLightbox}
                ownedIds={ownedIds}
                onOwnSticker={acquireSticker}
              />
            ))}
          </div>
        </div>
        {threadMenList.length > 0 ? (
          <div className="menbar" data-testid="thread-mention-bar">
            {threadMenList.map((c, i) => (
              <button
                key={c.pubkey}
                type="button"
                className={`menbar__item${i === threadMenActive ? " on" : ""}`}
                title={c.name}
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptThreadMention(c);
                }}
              >
                <span className="menbar__avatar" style={{ background: avatarColor(c.pubkey) }}>{initial(c.name)}</span>
                <span>@{c.name}</span>
              </button>
            ))}
            <span className="trigbar__hint">{t("mention_hint")}</span>
          </div>
        ) : null}
        <div className="composer">
          <textarea
            aria-label={t("thread_reply")}
            value={threadText}
            placeholder={t("thread_reply")}
            onChange={(e) => {
              setThreadText(e.target.value);
              setThreadMenSel(0);
              setThreadMenDismissed(false);
            }}
            onKeyDown={(e) => {
              if (threadMenList.length > 0) {
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  acceptThreadMention(threadMenList[threadMenActive]!);
                  return;
                }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const delta = e.key === "ArrowDown" ? 1 : -1;
                  setThreadMenSel((threadMenActive + delta + threadMenList.length) % threadMenList.length);
                  return;
                }
                if (e.key === "Escape") {
                  setThreadMenDismissed(true);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendThread();
              }
            }}
          />
          <button className="composer__send" onClick={sendThread}>{t("convo_send")}</button>
        </div>
      </div>
    ) : null}
    {detailMsg ? (
      <div className="win convo detail-panel" data-testid="detail-panel">
        <div className="win__title">
          <span>{t("convo_msgDetail")}</span>
          <span className="spacer" />
          <span
            className="win__btn"
            role="button"
            aria-label={t("convo_close")}
            onClick={() => setDetailMsgId(null)}
          >
            ×
          </span>
        </div>
        <div className="convo__body">
          <div className="log" data-testid="detail-log">
            <MessageLine
              message={detailMsg}
              who={whoOf(detailMsg)}
              reactions={props.reactions?.[detailMsg.id] ?? []}
              unsent={props.unsent?.has(detailMsg.id) ?? false}
              expired={props.expired?.has(detailMsg.id) ?? false}
              onReact={props.onReact}
              onUnsend={props.onUnsend}
              onView={setLightbox}
              ownedIds={ownedIds}
              onOwnSticker={acquireSticker}
              expanded
            />
          </div>
        </div>
      </div>
    ) : null}
    </div>
  );
}

function MessageLine({
  message,
  who,
  reactions,
  unsent,
  expired,
  onReact,
  onUnsend,
  onView,
  ownedIds,
  onOwnSticker,
  replyCount = 0,
  onOpenThread,
  onExpand,
  expanded = false,
  groupRead,
}: {
  message: ChatMessage;
  who: string;
  reactions: string[];
  unsent: boolean;
  expired: boolean;
  onReact?: ((messageId: string, emoji: string) => void) | undefined;
  onUnsend?: ((messageId: string) => void) | undefined;
  onView?: ((item: LightboxItem) => void) | undefined;
  ownedIds: Set<string>;
  onOwnSticker: (label: string, svg: string) => void;
  /** 此訊息作為串根的回覆數（ADR-0051）。 */
  replyCount?: number;
  /** 開啟此訊息的對話串面板；未提供則不顯示串入口。 */
  onOpenThread?: (() => void) | undefined;
  /** 開啟此訊息的詳情面板（長訊息「展開全文」）；未提供則不顯示入口。 */
  onExpand?: (() => void) | undefined;
  /** 於詳情面板中渲染時為 true：不截斷、顯示完整內文。 */
  expanded?: boolean;
  /** 群組已讀（ADR-0095）：名單制/計數制；大群或非群組為 undefined（不顯示）。 */
  groupRead?: GroupRead | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const react = (emoji: string) => {
    onReact?.(message.id, emoji);
    setPicking(false);
  };
  const ref = parseSticker(message.text);
  const sticker = ref ? stickerSvg(ref.pack, ref.id) : undefined;
  // 自製貼圖（v2）：內容隨訊息；渲染前必過驗證（ADR-0032）。
  const custom = sticker === undefined ? parseCustomSticker(message.text) : null;
  const customOk = custom !== null && validateStickerSvg(custom.svg).ok;
  const owned = customOk && ownedIds.has(contentHash(custom.svg));

  if (unsent || expired) {
    const cls = unsent ? "unsent" : "expired";
    return (
      <div className={`line ${message.outgoing ? "out" : "in"} ${cls}`}>
        <span className="who">{who}</span>
        <span className="time">{new Date(message.at).toLocaleTimeString()}</span>
        <span className={`text ${cls}__text`}>{t(unsent ? "convo_unsent" : "convo_expired")}</span>
      </div>
    );
  }

  if (message.file) {
    return <FileLine message={message} who={who} onView={onView} />;
  }

  return (
    <div className={`line ${message.outgoing ? "out" : "in"}${message.mentionsMe ? " mention" : ""}`}>
      <span className="who">{who}</span>
      <span className="time">{new Date(message.at).toLocaleTimeString()}</span>
      {message.outgoing && message.status ? (
        <span
          className={`tick tick--${message.status}`}
          title={t(MSG_STATUS_KEY[message.status])}
          aria-label={t(MSG_STATUS_KEY[message.status])}
        >
          <MsgStatusIcon status={message.status} />
        </span>
      ) : null}
      {message.outgoing && groupRead && groupRead.count > 0 ? (
        // 名單制（≤5 人）列出誰已讀；計數制（6–10 人）只給 M/N。大群不會走到這（groupRead 為 undefined）。
        <span
          className="readby"
          title={groupRead.mode === "list" ? groupRead.names.join("、") : undefined}
        >
          {groupRead.mode === "list"
            ? t("readBy_list", { names: groupRead.names.join("、") })
            : t("readBy_count", { count: String(groupRead.count), total: String(groupRead.total) })}
        </span>
      ) : null}
      {message.mentionsMe ? (
        <span className="mention-badge" title={t("mention_you")}>@</span>
      ) : null}
      {message.expiresAt !== undefined ? (
        <span className="timer-badge" title={t("convo_timerTitle")}>⏱</span>
      ) : null}
      {onReact ? (
        <span className="react">
          <button className="react__btn" title={t("convo_react")} onClick={() => setPicking((v) => !v)}>＋</button>
          {picking ? (
            <span className="react__pick">
              {REACTION_EMOJIS.map((e) => (
                <span key={e} role="button" onClick={() => react(e)}>{e}</span>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
      {message.outgoing && onUnsend ? (
        <button
          className="unsend__btn"
          title={t("convo_unsend")}
          onClick={() => onUnsend(message.id)}
        >
          {t("convo_unsend")}
        </button>
      ) : null}
      {onOpenThread ? (
        <button className="thread__btn" title={t("thread_open")} aria-label={t("thread_open")} onClick={onOpenThread}>🧵</button>
      ) : null}
      {sticker ? (
        <span className="sticker">
          <img src={svgToDataUri(sticker)} alt={t("sticker_alt")} data-testid="sticker-img" />
        </span>
      ) : customOk ? (
        <span className="sticker">
          {!message.outgoing && !owned ? (
            <button
              type="button"
              className="sticker__own"
              title={t("sticker_own")}
              aria-label={t("sticker_own")}
              onClick={() => onOwnSticker(custom.label, custom.svg)}
            >
              <img src={svgToDataUri(custom.svg)} alt={custom.label} data-testid="sticker-img" />
            </button>
          ) : (
            <img
              src={svgToDataUri(custom.svg)}
              alt={custom.label}
              title={owned ? t("sticker_owned") : custom.label}
              data-testid="sticker-img"
            />
          )}
        </span>
      ) : custom !== null ? (
        <span className="text expired__text">{t("sticker_invalid")}</span>
      ) : !expanded && message.text.length > MESSAGE_TRUNCATE_CHARS ? (
        <span className="text">
          {renderMarkdown(applyEmoticons(message.text.slice(0, MESSAGE_TRUNCATE_CHARS)))}
          <span className="text__ellip">… </span>
          {onExpand ? (
            <button type="button" className="text__more" data-testid="expand-msg" onClick={onExpand}>
              {t("convo_showFull")}
            </button>
          ) : null}
        </span>
      ) : (
        <span className="text">{renderMarkdown(applyEmoticons(message.text))}</span>
      )}
      {reactions.length > 0 ? (
        <span className="reactions">
          {reactions.map((e) => (
            <span key={e} className="reaction">{e}</span>
          ))}
        </span>
      ) : null}
      {replyCount > 0 && onOpenThread ? (
        <button className="thread__count" data-testid="thread-count" onClick={onOpenThread}>
          💬 {t("thread_replies", { count: replyCount })}
        </button>
      ) : null}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileLine({
  message,
  who,
  onView,
}: {
  message: ChatMessage;
  who: string;
  onView?: ((item: LightboxItem) => void) | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const file = message.file!;
  const pct = file.size > 0 ? Math.min(100, Math.round((file.sent / file.size) * 100)) : 100;
  // 送出端在傳輸完成前顯示進度；收件端一律已完成。
  const uploading = !file.incoming && file.sent < file.size;
  const isVoice = file.mime.startsWith("audio/");
  const isImage = file.mime.startsWith("image/");

  return (
    <div className={`line ${message.outgoing ? "out" : "in"}`}>
      <span className="who">{who}</span>
      <span className="time">{new Date(message.at).toLocaleTimeString()}</span>
      {isImage && (file.url || file.thumb) ? (
        // ADR-0102：縮圖跨 session 存活，故重載後圖片仍是圖片（不再退化成灰色檔案卡）。
        <button className="imgthumb" data-testid="imgthumb" onClick={() => onView?.(lightboxItem(message))}>
          <img src={file.url ?? file.thumb} alt={file.name || t("image_alt")} />
        </button>
      ) : isVoice && file.url ? (
        <span className="voice" data-testid="voice">
          <audio controls src={file.url} aria-label={t("voice_alt")} />
        </span>
      ) : (
        <div className="filecard" data-testid="filecard">
          <span className="filecard__ic">{isVoice ? "🎤" : "📄"}</span>
          <div className="filecard__info">
            <div className="filecard__name">{isVoice ? t("voice_alt") : file.name}</div>
            <div className="filecard__meta">{formatBytes(file.size)}</div>
            {uploading ? (
              <div className="filecard__bar" aria-label={t("file_sending")}>
                <span style={{ width: `${pct}%` }} />
              </div>
            ) : file.url ? (
              <a className="filecard__dl" href={file.url} download={file.name}>⬇ {t("file_download")}</a>
            ) : file.savedPath ? (
              // 收檔另存後只顯示路徑（ADR-0093；App 不保管檔案本體）。
              <div className="filecard__path" title={file.savedPath}>{t("file_saved")}：{file.savedPath}</div>
            ) : file.incoming && file.sent < file.size ? (
              // 位元組落在另一台裝置、此裝置只收到 metadata（ADR-0093）。
              <div className="filecard__note">📍 {t("file_onOtherDevice")}</div>
            ) : file.incoming ? (
              <div className="filecard__note">{t("file_notSaved")}</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
