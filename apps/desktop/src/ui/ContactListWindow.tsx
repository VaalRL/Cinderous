import type { Contact, Self, Status } from "../backend/types.js";
import { avatarColor, initial } from "./util.js";

const STATUS_LABEL: Record<Status, string> = {
  online: "線上",
  away: "離開",
  busy: "忙碌",
  offline: "顯示為離線",
};

export interface ContactListProps {
  self: Self;
  contacts: Contact[];
  onOpen: (pubkey: string) => void;
  onStatus: (status: Status) => void;
  onStatusMessage: (message: string) => void;
}

export function ContactListWindow(props: ContactListProps): JSX.Element {
  const { self, contacts } = props;
  const online = contacts.filter((c) => c.status !== "offline");
  const offline = contacts.filter((c) => c.status === "offline");

  return (
    <div className="win contacts">
      <div className="win__title">
        <span>Nostr Buddy</span>
        <span className="spacer" />
        <span className="win__btn">_</span>
        <span className="win__btn">×</span>
      </div>

      <div className="me">
        <div className="avatar" style={{ background: avatarColor(self.pubkey) }}>{initial(self.name)}</div>
        <div className="me__info">
          <div className="me__name">
            <span>{self.name}</span>
            <select
              aria-label="狀態"
              value={self.status}
              onChange={(e) => props.onStatus(e.target.value as Status)}
            >
              {(["online", "away", "busy", "offline"] as Status[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className="me__msg">
            <input
              aria-label="個人訊息"
              placeholder="輸入個人訊息…"
              value={self.statusMessage}
              onChange={(e) => props.onStatusMessage(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="roster">
        <div className="group">線上 ({online.length})</div>
        {online.map((c) => (
          <ContactRow key={c.pubkey} contact={c} onOpen={props.onOpen} />
        ))}
        <div className="group">離線 ({offline.length})</div>
        {offline.map((c) => (
          <ContactRow key={c.pubkey} contact={c} onOpen={props.onOpen} />
        ))}
      </div>
    </div>
  );
}

function ContactRow({ contact, onOpen }: { contact: Contact; onOpen: (pk: string) => void }): JSX.Element {
  const secondary = contact.nowPlaying
    ? <span className="np">♪ {contact.nowPlaying}</span>
    : contact.statusMessage;
  return (
    <div
      className={`contact ${contact.status === "offline" ? "offline" : ""}`}
      onDoubleClick={() => onOpen(contact.pubkey)}
      title="雙擊開啟對話"
    >
      <div className="avatar sm" style={{ background: avatarColor(contact.pubkey) }}>{initial(contact.name)}</div>
      <div className="contact__info">
        <div className="contact__name">{contact.name}</div>
        <div className="contact__msg">{secondary}</div>
      </div>
      <span className={`dot ${contact.status}`} />
    </div>
  );
}
