import { contentHash, REACTION_EMOJIS } from "@nostr-buddy/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import type { CallMedia } from "@nostr-buddy/core";
import type { ChatMessage, Contact, Self } from "../backend/types.js";
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
} from "../stickers.js";
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
import { validateStickerSvg, wrapRasterAsSvg } from "./sticker-svg.js";
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
import { renderMarkdown } from "./markdown.js";
import { applyEmoticons } from "./emoticons.js";
import { avatarColor, EMOTICONS, initial } from "./util.js";

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
  onSend: (text: string, ttlSeconds?: number) => void;
  onTyping: () => void;
  onNudge: () => void;
  /** 對某訊息送出 emoji 回應（未提供則不顯示回應功能）。 */
  onReact?: (messageId: string, emoji: string) => void;
  /** 收回自己送出的某訊息（未提供則不顯示收回功能）。 */
  onUnsend?: (messageId: string) => void;
  /** 以 P2P 傳送檔案（未提供則不顯示檔案功能）。 */
  onSendFile?: (file: File) => void;
  /** 發起語音/視訊通話（未提供則不顯示通話按鈕）。 */
  onStartCall?: (media: CallMedia) => void;
  /** 群組模式：以發送者公鑰解析顯示暱稱（提供即為群組視窗）。 */
  senderName?: (pubkey: string) => string;
  /** 離開群組（群組視窗才提供）。 */
  onLeaveGroup?: () => void;
  /** 企業政策停用貼圖時隱藏貼圖鈕（ADR-0048）。 */
  stickersDisabled?: boolean;
  /** 公告頻道唯讀（ADR-0049）：非管理者隱藏輸入區。 */
  readOnly?: boolean;
  onClose: () => void;
}

/** 訊息列視窗化：初始只渲染最近這麼多則，點「載入較早」再往前展開（審查 P0-3）。 */
const MESSAGE_WINDOW = 200;

export function ConversationWindow(props: ConversationProps): JSX.Element {
  const { t } = useI18n();
  const { self, contact, messages } = props;
  const [visibleCount, setVisibleCount] = useState(MESSAGE_WINDOW);
  const [text, setText] = useState("");
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
  const [showAlbum, setShowAlbum] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [ttl, setTtl] = useState(0);
  const [dragging, setDragging] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 訊息列視窗化：只渲染最近 visibleCount 則，避免長對話一次渲染上千 DOM 節點。
  const hiddenCount = Math.max(0, messages.length - visibleCount);
  const shown = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;
  // 擁有中的自製貼圖 id 集合：整個訊息列共用一份（不再每則訊息各建一個 Set）。
  const ownedIds = new Set(library.map((s) => s.id));

  // 相簿：本對話中收發過、可顯示的圖片。
  const images = messages
    .filter((m) => m.file?.mime.startsWith("image/") && m.file.url)
    .map((m) => ({ id: m.id, name: m.file!.name, url: m.file!.url! }));

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
      window.alert(t("sticker_importFail", { reason: r.reason }));
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
  const promptTriggers = (ref: StickerRef, label: string): void => {
    const current = triggersFor(triggers, ref).join(" ");
    const input = window.prompt(t("trigger_prompt", { name: label }), current);
    if (input === null) return;
    let list = removeTriggersFor(triggers, ref);
    const skipped: string[] = [];
    for (const raw of input.split(/[\s,，、]+/).filter(Boolean)) {
      const norm = normalizeTrigger(raw);
      const occupied = norm ? list.find((e) => e.trigger === norm) : undefined;
      if (occupied && !window.confirm(t("trigger_conflict", { trigger: occupied.trigger }))) continue;
      const r = setTrigger(list, raw, ref);
      if (r.ok) list = r.list;
      else skipped.push(raw);
    }
    if (skipped.length > 0) window.alert(t("trigger_skipped", { list: skipped.join(", ") }));
    setTriggers(list);
    saveTriggers(list);
  };
  // 觸發字總覽面板：改名 / 刪除（ADR-0037 後續）。
  const renameOneTrigger = (oldTrigger: string): void => {
    const input = window.prompt(t("trigger_renamePrompt"), oldTrigger);
    if (input === null) return;
    const norm = normalizeTrigger(input);
    const occupied = norm && norm !== oldTrigger ? triggers.find((e) => e.trigger === norm) : undefined;
    if (occupied && !window.confirm(t("trigger_conflict", { trigger: occupied.trigger }))) return;
    const r = renameTrigger(triggers, oldTrigger, input);
    if (!r.ok) {
      window.alert(t("trigger_skipped", { list: input }));
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
      window.alert(t("sticker_importFail", { reason: "not-image" }));
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

  const send = () => {
    const t = text.trim();
    if (!t) return;
    props.onSend(t, ttl > 0 ? ttl : undefined);
    setText("");
  };

  return (
    <div className="win convo" ref={rootRef} data-contact={contact.name}>
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
        className={`convo__body ${dragging ? "dropping" : ""}`}
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
              who={
                m.outgoing
                  ? self.name
                  : m.sender && props.senderName
                    ? props.senderName(m.sender)
                    : contact.name
              }
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
        <div className="pics">
          <div className="avatar" style={{ background: avatarColor(contact.pubkey) }}>{initial(contact.name)}</div>
          <div className="cap">{contact.name}</div>
          <div className="avatar" style={{ background: avatarColor(self.pubkey) }}>{initial(self.name)}</div>
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
            <button className="tool" title={t("file_attach")} onClick={() => fileRef.current?.click()}>📎</button>
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
                              if (window.confirm(t("sticker_deleteConfirm", { name: s.label }))) {
                                deleteCustom(ref.id);
                              }
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

      {props.readOnly ? (
        <div className="composer composer--ro" data-testid="announce-readonly">📢 公告頻道（唯讀，僅管理者可發布）</div>
      ) : (
      <div className="composer">
        <textarea
          aria-label={t("convo_composerPlaceholder")}
          value={text}
          placeholder={t("convo_composerPlaceholder")}
          onChange={(e) => {
            setText(e.target.value);
            setTrigSel(0);
            setTrigDismissed(false);
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
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
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
                  <button key={img.id} className="album__item" onClick={() => setLightbox(img.url)}>
                    <img src={img.url} alt={img.name || t("image_alt")} />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt={t("image_alt")} />
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
}: {
  message: ChatMessage;
  who: string;
  reactions: string[];
  unsent: boolean;
  expired: boolean;
  onReact?: ((messageId: string, emoji: string) => void) | undefined;
  onUnsend?: ((messageId: string) => void) | undefined;
  onView?: ((url: string) => void) | undefined;
  ownedIds: Set<string>;
  onOwnSticker: (label: string, svg: string) => void;
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
    <div className={`line ${message.outgoing ? "out" : "in"}`}>
      <span className="who">{who}</span>
      <span className="time">{new Date(message.at).toLocaleTimeString()}</span>
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
  onView?: ((url: string) => void) | undefined;
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
      {isImage && file.url ? (
        <button className="imgthumb" data-testid="imgthumb" onClick={() => onView?.(file.url!)}>
          <img src={file.url} alt={file.name || t("image_alt")} />
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
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
