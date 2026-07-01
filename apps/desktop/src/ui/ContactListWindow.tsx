import type { MessageKey } from "@nostr-buddy/i18n";
import { useState } from "react";
import { useI18n } from "../i18n.js";
import type { Contact, Self, Status } from "../backend/types.js";
import { TitleControls } from "./TitleControls.js";
import { avatarColor, initial } from "./util.js";

const STATUS_KEY: Record<Status, MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
  offline: "status_offline",
};

export interface ContactListProps {
  self: Self;
  contacts: Contact[];
  onOpen: (pubkey: string) => void;
  onStatus: (status: Status) => void;
  onStatusMessage: (message: string) => void;
  /** 自己的 npub（真實 relay 模式才有），供分享。 */
  selfNpub?: string;
  /** 以 npub 加好友（真實 relay 模式才有）。 */
  onAddContact?: (npub: string) => void;
}

export function ContactListWindow(props: ContactListProps): JSX.Element {
  const { t } = useI18n();
  const { self, contacts } = props;
  const online = contacts.filter((c) => c.status !== "offline");
  const offline = contacts.filter((c) => c.status === "offline");

  return (
    <div className="win contacts">
      <div className="win__title">
        <span>{t("appName")}</span>
        <span className="spacer" />
        <TitleControls />
      </div>

      <div className="me">
        <div className="avatar" style={{ background: avatarColor(self.pubkey) }}>{initial(self.name)}</div>
        <div className="me__info">
          <div className="me__name">
            <span>{self.name}</span>
            <select
              aria-label={t("status_label")}
              value={self.status}
              onChange={(e) => props.onStatus(e.target.value as Status)}
            >
              {(["online", "away", "busy", "offline"] as Status[]).map((s) => (
                <option key={s} value={s}>{t(STATUS_KEY[s])}</option>
              ))}
            </select>
          </div>
          <div className="me__msg">
            <input
              aria-label={t("personalMessage_placeholder")}
              placeholder={t("personalMessage_placeholder")}
              value={self.statusMessage}
              onChange={(e) => props.onStatusMessage(e.target.value)}
            />
          </div>
        </div>
      </div>

      {props.onAddContact ? (
        <AddContact
          selfNpub={props.selfNpub ?? ""}
          onAdd={props.onAddContact}
          myIdLabel={t("contact_myId")}
          placeholder={t("contact_addPlaceholder")}
          addLabel={t("contact_add")}
        />
      ) : null}

      <div className="roster">
        <div className="group">{t("group_online", { count: online.length })}</div>
        {online.map((c) => (
          <ContactRow key={c.pubkey} contact={c} onOpen={props.onOpen} hint={t("contact_openHint")} />
        ))}
        <div className="group">{t("group_offline", { count: offline.length })}</div>
        {offline.map((c) => (
          <ContactRow key={c.pubkey} contact={c} onOpen={props.onOpen} hint={t("contact_openHint")} />
        ))}
      </div>
    </div>
  );
}

function AddContact({
  selfNpub,
  onAdd,
  myIdLabel,
  placeholder,
  addLabel,
}: {
  selfNpub: string;
  onAdd: (npub: string) => void;
  myIdLabel: string;
  placeholder: string;
  addLabel: string;
}): JSX.Element {
  const [value, setValue] = useState("");
  const add = () => {
    const v = value.trim();
    if (!v) return;
    try {
      onAdd(v);
      setValue("");
    } catch {
      /* 非法 npub：保留輸入 */
    }
  };
  return (
    <div className="addbar">
      <div className="myid" title={selfNpub}>
        <b>{myIdLabel}:</b> <span className="myid__val" data-testid="my-npub">{selfNpub}</span>
      </div>
      <div className="addbar__row">
        <input
          aria-label={placeholder}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add}>{addLabel}</button>
      </div>
    </div>
  );
}

function ContactRow({
  contact,
  onOpen,
  hint,
}: {
  contact: Contact;
  onOpen: (pk: string) => void;
  hint: string;
}): JSX.Element {
  const secondary = contact.nowPlaying
    ? <span className="np">♪ {contact.nowPlaying}</span>
    : contact.statusMessage;
  return (
    <div
      className={`contact ${contact.status === "offline" ? "offline" : ""}`}
      onDoubleClick={() => onOpen(contact.pubkey)}
      title={hint}
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
