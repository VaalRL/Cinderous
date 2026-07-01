import { REACTION_EMOJIS } from "@nostr-buddy/core";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
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
  onClose: () => void;
}

export function ConversationWindow(props: ConversationProps): JSX.Element {
  const { t } = useI18n();
  const { self, contact, messages } = props;
  const [text, setText] = useState("");
  const [showEmo, setShowEmo] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [ttl, setTtl] = useState(0);
  const [dragging, setDragging] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dropFiles = (files: FileList | null) => {
    if (!files || !props.onSendFile) return;
    for (const f of Array.from(files)) props.onSendFile(f);
  };

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
              who={m.outgoing ? self.name : contact.name}
              reactions={props.reactions?.[m.id] ?? []}
              unsent={props.unsent?.has(m.id) ?? false}
              expired={props.expired?.has(m.id) ?? false}
              onReact={props.onReact}
              onUnsend={props.onUnsend}
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
}: {
  message: ChatMessage;
  who: string;
  reactions: string[];
  unsent: boolean;
  expired: boolean;
  onReact?: ((messageId: string, emoji: string) => void) | undefined;
  onUnsend?: ((messageId: string) => void) | undefined;
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
    return <FileLine message={message} who={who} />;
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

function FileLine({ message, who }: { message: ChatMessage; who: string }): JSX.Element {
  const { t } = useI18n();
  const file = message.file!;
  const pct = file.size > 0 ? Math.min(100, Math.round((file.sent / file.size) * 100)) : 100;
  const done = file.url !== undefined || (!file.incoming && file.sent >= file.size);
  return (
    <div className={`line ${message.outgoing ? "out" : "in"}`}>
      <span className="who">{who}</span>
      <span className="time">{new Date(message.at).toLocaleTimeString()}</span>
      <div className="filecard" data-testid="filecard">
        <span className="filecard__ic">📄</span>
        <div className="filecard__info">
          <div className="filecard__name">{file.name}</div>
          <div className="filecard__meta">{formatBytes(file.size)}</div>
          {!done ? (
            <div className="filecard__bar" aria-label={t("file_sending")}>
              <span style={{ width: `${pct}%` }} />
            </div>
          ) : file.url ? (
            <a className="filecard__dl" href={file.url} download={file.name}>⬇ {t("file_download")}</a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
