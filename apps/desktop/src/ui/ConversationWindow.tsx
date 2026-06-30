import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Contact, Self } from "../backend/types.js";
import { avatarColor, emoticonize, EMOTICONS, initial } from "./util.js";

export interface ConversationProps {
  self: Self;
  contact: Contact;
  messages: ChatMessage[];
  typing: boolean;
  /** 每次遞增即觸發一次震動動畫。 */
  nudgeSignal: number;
  onSend: (text: string) => void;
  onTyping: () => void;
  onNudge: () => void;
  onClose: () => void;
}

export function ConversationWindow(props: ConversationProps): JSX.Element {
  const { self, contact, messages } = props;
  const [text, setText] = useState("");
  const [showEmo, setShowEmo] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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
    props.onSend(t);
    setText("");
  };

  return (
    <div className="win convo" ref={rootRef} data-contact={contact.name}>
      <div className="win__title">
        <span>{contact.name}</span>
        <span className="spacer" />
        <span className="win__btn" onClick={props.onClose} role="button" aria-label="關閉">×</span>
      </div>

      <div className="convo__head">
        <b>{contact.name}</b>
        <div className="sub">
          {contact.status === "offline" ? "目前離線——訊息將於對方上線時送達" : contact.statusMessage}
          {contact.nowPlaying ? `　♪ ${contact.nowPlaying}` : ""}
        </div>
      </div>

      <div className="convo__body">
        <div className="log" ref={logRef} data-testid="log">
          {messages.map((m) => (
            <div key={m.id} className={`line ${m.outgoing ? "out" : "in"}`}>
              <span className="who">{m.outgoing ? self.name : contact.name}</span>
              <span className="time">{new Date(m.at).toLocaleTimeString()}</span>
              <span className="text">{emoticonize(m.text)}</span>
            </div>
          ))}
        </div>
        <div className="pics">
          <div className="avatar" style={{ background: avatarColor(contact.pubkey) }}>{initial(contact.name)}</div>
          <div className="cap">{contact.name}</div>
          <div className="avatar" style={{ background: avatarColor(self.pubkey) }}>{initial(self.name)}</div>
          <div className="cap">{self.name}</div>
        </div>
      </div>

      <div className="typing">{props.typing ? `${contact.name} 正在輸入訊息…` : ""}</div>

      <div className="toolbar">
        <button className="tool" title="表情" onClick={() => setShowEmo((v) => !v)}>🙂</button>
        <button className="tool" title="震動對方視窗" onClick={props.onNudge}>震動</button>
      </div>
      {showEmo && (
        <div className="emopick">
          {EMOTICONS.map((e) => (
            <span key={e} role="button" onClick={() => setText((t) => t + e)}>{e}</span>
          ))}
        </div>
      )}

      <div className="composer">
        <textarea
          aria-label="訊息輸入"
          value={text}
          placeholder="輸入訊息…（Enter 送出，Shift+Enter 換行）"
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
        <button className="composer__send" onClick={send}>送出</button>
      </div>
    </div>
  );
}
