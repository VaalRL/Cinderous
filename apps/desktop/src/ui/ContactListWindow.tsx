import type { MessageKey } from "@nostr-buddy/i18n";
import { useState } from "react";
import { useI18n } from "../i18n.js";
import type { BlockedContact, Contact, Self, Status } from "../backend/types.js";
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
  /** 刪除聯絡人並清除對話。 */
  onRemoveContact?: (pubkey: string) => void;
  /** 封鎖聯絡人。 */
  onBlockContact?: (pubkey: string) => void;
  /** 解除封鎖。 */
  onUnblockContact?: (pubkey: string) => void;
  /** 已封鎖名單。 */
  blocked?: BlockedContact[];
  /** 開啟設定面板。 */
  onOpenSettings?: () => void;
  /** 設定自己的音樂狀態（分享正在聽的音樂）。 */
  onNowPlaying?: (text: string) => void;
  /** 每位聯絡人的未讀訊息數。 */
  unread?: Record<string, number>;
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
        {props.onOpenSettings ? (
          <button
            type="button"
            className="themebtn"
            aria-label={t("settings_open")}
            title={t("settings_open")}
            onClick={props.onOpenSettings}
          >
            ⚙️
          </button>
        ) : null}
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
          {props.onNowPlaying ? (
            <div className="me__np">
              <span className="me__np-ic">♪</span>
              <input
                aria-label={t("nowPlaying_placeholder")}
                placeholder={t("nowPlaying_placeholder")}
                onBlur={(e) => props.onNowPlaying?.(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
          ) : null}
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
          <ContactRow
            key={c.pubkey}
            contact={c}
            onOpen={props.onOpen}
            hint={t("contact_openHint")}
            unread={props.unread?.[c.pubkey] ?? 0}
            {...(props.onRemoveContact ? { onRemove: props.onRemoveContact } : {})}
            {...(props.onBlockContact ? { onBlock: props.onBlockContact } : {})}
          />
        ))}
        <div className="group">{t("group_offline", { count: offline.length })}</div>
        {offline.map((c) => (
          <ContactRow
            key={c.pubkey}
            contact={c}
            onOpen={props.onOpen}
            hint={t("contact_openHint")}
            unread={props.unread?.[c.pubkey] ?? 0}
            {...(props.onRemoveContact ? { onRemove: props.onRemoveContact } : {})}
            {...(props.onBlockContact ? { onBlock: props.onBlockContact } : {})}
          />
        ))}
        {props.blocked && props.blocked.length > 0 ? (
          <>
            <div className="group">{t("group_blocked", { count: props.blocked.length })}</div>
            {props.blocked.map((b) => (
              <div className="contact blocked" key={b.pubkey}>
                <div className="avatar sm" style={{ background: avatarColor(b.pubkey) }}>{initial(b.name)}</div>
                <div className="contact__info">
                  <div className="contact__name">{b.name}</div>
                </div>
                {props.onUnblockContact ? (
                  <button className="contact__act" onClick={() => props.onUnblockContact?.(b.pubkey)}>
                    {t("contact_unblock")}
                  </button>
                ) : null}
              </div>
            ))}
          </>
        ) : null}
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
  unread,
  onRemove,
  onBlock,
}: {
  contact: Contact;
  onOpen: (pk: string) => void;
  hint: string;
  unread: number;
  onRemove?: ((pubkey: string) => void) | undefined;
  onBlock?: ((pubkey: string) => void) | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const secondary = contact.nowPlaying
    ? <span className="np">♪ {contact.nowPlaying}</span>
    : contact.statusMessage;
  const remove = () => {
    if (window.confirm(t("contact_removeConfirm", { name: contact.name }))) onRemove?.(contact.pubkey);
  };
  const block = () => {
    if (window.confirm(t("contact_blockConfirm", { name: contact.name }))) onBlock?.(contact.pubkey);
  };
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
      {unread > 0 ? (
        <span className="unread-badge" title={t("unread_title", { count: unread })}>{unread}</span>
      ) : null}
      <span className="contact__acts">
        {onBlock ? (
          <button className="contact__act" title={t("contact_block")} onClick={block}>🚫</button>
        ) : null}
        {onRemove ? (
          <button className="contact__act" title={t("contact_remove")} onClick={remove}>🗑</button>
        ) : null}
      </span>
      <span className={`dot ${contact.status}`} />
    </div>
  );
}
