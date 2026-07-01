import { REACTION_EMOJIS } from "@nostr-buddy/core";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import type { CallMedia } from "@nostr-buddy/core";
import type { ChatMessage, Contact, Self } from "../backend/types.js";
import { formatSticker, parseSticker, STICKER_PACKS, stickerSvg, svgToDataUri } from "../stickers.js";
import { renderMarkdown } from "./markdown.js";
import { avatarColor, emoticonize, EMOTICONS, initial } from "./util.js";

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
  onClose: () => void;
}

export function ConversationWindow(props: ConversationProps): JSX.Element {
  const { t } = useI18n();
  const { self, contact, messages } = props;
  const [text, setText] = useState("");
  const [showEmo, setShowEmo] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [showAlbum, setShowAlbum] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [ttl, setTtl] = useState(0);
  const [dragging, setDragging] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 相簿：本對話中收發過、可顯示的圖片。
  const images = messages
    .filter((m) => m.file?.mime.startsWith("image/") && m.file.url)
    .map((m) => ({ id: m.id, name: m.file!.name, url: m.file!.url! }));

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
          {messages.map((m) => (
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

      <div className="toolbar">
        <button className="tool" title={t("convo_emojiTitle")} onClick={() => setShowEmo((v) => !v)}>🙂</button>
        <button
          className="tool"
          title={t("sticker_title")}
          onClick={() => setShowStickers((v) => !v)}
        >
          🧸
        </button>
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
      {showStickers && (
        <div className="stickerpick" data-testid="stickerpick">
          {Object.entries(STICKER_PACKS).map(([pack, items]) =>
            Object.entries(items).map(([id, s]) => (
              <button
                key={`${pack}/${id}`}
                className="stickerpick__item"
                title={s.label}
                aria-label={s.label}
                onClick={() => {
                  props.onSend(formatSticker(pack, id));
                  setShowStickers(false);
                }}
              >
                <img src={svgToDataUri(s.svg)} alt={s.label} />
              </button>
            )),
          )}
        </div>
      )}

      <div className="composer">
        <textarea
          aria-label={t("convo_composerPlaceholder")}
          value={text}
          placeholder={t("convo_composerPlaceholder")}
          onChange={(e) => {
            setText(e.target.value);
            props.onTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="composer__send" onClick={send}>{t("convo_send")}</button>
      </div>

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
}: {
  message: ChatMessage;
  who: string;
  reactions: string[];
  unsent: boolean;
  expired: boolean;
  onReact?: ((messageId: string, emoji: string) => void) | undefined;
  onUnsend?: ((messageId: string) => void) | undefined;
  onView?: ((url: string) => void) | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const react = (emoji: string) => {
    onReact?.(message.id, emoji);
    setPicking(false);
  };
  const ref = parseSticker(message.text);
  const sticker = ref ? stickerSvg(ref.pack, ref.id) : undefined;

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
      ) : (
        <span className="text">{renderMarkdown(emoticonize(message.text))}</span>
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
