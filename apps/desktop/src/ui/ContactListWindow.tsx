import type { MessageKey } from "@cinder/i18n";
import { Fragment, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n.js";
import type { BlockedContact, ConnectionState, Contact, Group, Self, Status } from "../backend/types.js";
import { qrDataUri } from "../qr.js";
import { hasRichStatus, renderStatus } from "./status-text.js";
import { TitleControls } from "./TitleControls.js";
import { avatarColor, initial } from "./util.js";

const STATUS_KEY: Record<Status, MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
  offline: "status_offline",
};

/** 上線狀態的分區順序（MSN 風：線上→離開→忙碌→離線）。 */
const STATUS_SECTIONS: Status[] = ["online", "away", "busy", "offline"];

/** 依上線狀態分區、每區內依名稱排序；只回傳非空的區（MSN 風清單）。不改動輸入。 */
export function groupByStatus(contacts: Contact[]): { status: Status; contacts: Contact[] }[] {
  return STATUS_SECTIONS.map((status) => ({
    status,
    contacts: contacts.filter((c) => c.status === status).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((sec) => sec.contacts.length > 0);
}

/** 縮短 npub / 分享字串供顯示（保留頭尾、中間省略）；完整值仍供複製、QR 與 title。 */
export function shortId(id: string): string {
  const npub = id.split("@")[0] ?? id;
  return npub.length > 22 ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : npub;
}

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
  /** 點開對話前以本機 AI 摘要未讀（ADR-0060）；提供且有未讀時顯示 🧠。 */
  onSummarize?: (pubkey: string) => void;
  /** 與中繼站的連線狀態（非 online 時顯示提示）。 */
  connection?: ConnectionState;
  /** 群組清單（M9）。 */
  groups?: Group[];
  /** 建立群組（名稱 + 成員公鑰）。 */
  onCreateGroup?: (name: string, memberPubkeys: string[]) => void;
  /** 開啟群組對話。 */
  onOpenGroup?: (groupId: string) => void;
  /** 各群組的本地標籤（ADR-0040）。 */
  groupLabels?: Record<string, string[]>;
  /** 各群組是否置頂。 */
  groupPinned?: Record<string, boolean>;
  /** 目前使用中的所有標籤（過濾列用）。 */
  labelOptions?: string[];
  /** 目前套用的標籤過濾（undefined＝全部）。 */
  activeLabel?: string | undefined;
  /** 切換標籤過濾。 */
  onFilterLabel?: (label: string | undefined) => void;
  /** 為群組新增標籤。 */
  onAddGroupLabel?: (groupId: string, label: string) => void;
  /** 移除群組某標籤。 */
  onRemoveGroupLabel?: (groupId: string, label: string) => void;
  /** 切換群組置頂。 */
  onToggleGroupPin?: (groupId: string) => void;
}

/** MSN 風狀態選單：目前狀態的彩色圓點＋下拉，每項附對應顏色圓點（取代原生 select）。 */
function StatusPicker({ value, onChange }: { value: Status; onChange: (s: Status) => void }): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="statuspick" ref={ref}>
      <button
        type="button"
        className="statuspick__cur"
        aria-label={t("status_label")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`dot ${value}`} />
        <span className="statuspick__txt">{t(STATUS_KEY[value])}</span>
        <span className="statuspick__caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="statuspick__menu" role="listbox">
          {STATUS_SECTIONS.map((s) => (
            <button
              type="button"
              key={s}
              role="option"
              aria-selected={s === value}
              className={`statuspick__opt ${s === value ? "on" : ""}`}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
            >
              <span className={`dot ${s}`} />
              <span>{t(STATUS_KEY[s])}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ContactListWindow(props: ContactListProps): JSX.Element {
  const { t } = useI18n();
  const { self, contacts } = props;
  const sections = groupByStatus(contacts);
  const renderRow = (c: Contact): JSX.Element => (
    <ContactRow
      key={c.pubkey}
      contact={c}
      onOpen={props.onOpen}
      hint={t("contact_openHint")}
      unread={props.unread?.[c.pubkey] ?? 0}
      {...(props.onRemoveContact ? { onRemove: props.onRemoveContact } : {})}
      {...(props.onBlockContact ? { onBlock: props.onBlockContact } : {})}
      {...(props.onSummarize ? { onSummarize: props.onSummarize } : {})}
    />
  );
  const [groupModal, setGroupModal] = useState(false);
  const groups = props.groups ?? [];

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

      {props.connection && props.connection !== "online" ? (
        <div className={`connbar connbar--${props.connection}`} role="status">
          {props.connection === "connecting" ? t("conn_connecting") : t("conn_offline")}
        </div>
      ) : null}

      <div className="me">
        <div className={`avatar ring-${self.status}`} style={{ background: avatarColor(self.pubkey) }}>{initial(self.name)}</div>
        <div className="me__info">
          <div className="me__name">
            <span className="me__name-txt">{self.name}</span>
            <StatusPicker value={self.status} onChange={props.onStatus} />
          </div>
          <div className="me__msg">
            <input
              aria-label={t("personalMessage_placeholder")}
              placeholder={t("personalMessage_placeholder")}
              value={self.statusMessage}
              onChange={(e) => props.onStatusMessage(e.target.value)}
            />
          </div>
          {hasRichStatus(self.statusMessage) ? (
            <div className="me__msg-preview" aria-hidden="true">{renderStatus(self.statusMessage)}</div>
          ) : null}
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
        {props.onCreateGroup ? (
          <>
            <div className="group group--groups">
              <span>{t("group_section")}（{groups.length}）</span>
              <button className="group__add" data-testid="create-group" onClick={() => setGroupModal(true)}>
                ＋ {t("group_create")}
              </button>
            </div>
            {props.labelOptions && props.labelOptions.length > 0 ? (
              <div className="labelbar" data-testid="label-filter">
                <button
                  className={`chip chip--filter ${props.activeLabel ? "" : "chip--on"}`}
                  onClick={() => props.onFilterLabel?.(undefined)}
                >
                  {t("group_filterAll")}
                </button>
                {props.labelOptions.map((l) => (
                  <button
                    key={l}
                    className={`chip chip--filter ${props.activeLabel === l ? "chip--on" : ""}`}
                    onClick={() => props.onFilterLabel?.(props.activeLabel === l ? undefined : l)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            ) : null}
            {groups.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                labels={props.groupLabels?.[g.id] ?? []}
                pinned={props.groupPinned?.[g.id] ?? false}
                onOpen={() => props.onOpenGroup?.(g.id)}
                {...(props.onAddGroupLabel ? { onAddLabel: (l: string) => props.onAddGroupLabel?.(g.id, l) } : {})}
                {...(props.onRemoveGroupLabel ? { onRemoveLabel: (l: string) => props.onRemoveGroupLabel?.(g.id, l) } : {})}
                {...(props.onToggleGroupPin ? { onTogglePin: () => props.onToggleGroupPin?.(g.id) } : {})}
              />
            ))}
          </>
        ) : null}
        {sections.map((sec) => (
          <Fragment key={sec.status}>
            <div className="group">
              {t(STATUS_KEY[sec.status])}（{sec.contacts.length}）
            </div>
            {sec.contacts.map(renderRow)}
          </Fragment>
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
      {groupModal && props.onCreateGroup ? (
        <GroupModal
          contacts={contacts}
          onCancel={() => setGroupModal(false)}
          onCreate={(name, members) => {
            props.onCreateGroup?.(name, members);
            setGroupModal(false);
          }}
        />
      ) : null}
    </div>
  );
}

function GroupRow({
  group,
  labels,
  pinned,
  onOpen,
  onAddLabel,
  onRemoveLabel,
  onTogglePin,
}: {
  group: Group;
  labels: string[];
  pinned: boolean;
  onOpen: () => void;
  onAddLabel?: (label: string) => void;
  onRemoveLabel?: (label: string) => void;
  onTogglePin?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const submit = () => {
    const v = value.trim();
    if (v) onAddLabel?.(v);
    setValue("");
    setAdding(false);
  };
  return (
    <div className="contact group-row" data-testid="group-row" title={t("contact_openHint")}>
      <div className="avatar sm" style={{ background: avatarColor(group.id) }} onDoubleClick={onOpen}>#</div>
      <div className="contact__info" onDoubleClick={onOpen}>
        <div className="contact__name">
          {pinned ? <span className="pin-ic" aria-hidden="true">📌</span> : null}
          {group.name}
        </div>
        <div className="contact__msg">{t("group_membersCount", { count: group.members.length })}</div>
        {labels.length > 0 || onAddLabel ? (
          <div className="labelrow">
            {labels.map((l) => (
              <span className="chip" key={l}>
                {l}
                {onRemoveLabel ? (
                  <button
                    className="chip__x"
                    aria-label={t("group_labelRemove", { label: l })}
                    onClick={() => onRemoveLabel(l)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            {onAddLabel && adding ? (
              <input
                className="labelrow__input"
                aria-label={t("group_labelPlaceholder")}
                placeholder={t("group_labelPlaceholder")}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={submit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  else if (e.key === "Escape") {
                    setValue("");
                    setAdding(false);
                  }
                }}
              />
            ) : onAddLabel ? (
              <button className="chip chip--add" data-testid="add-label" onClick={() => setAdding(true)}>
                {t("group_labelAdd")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {onTogglePin ? (
        <button
          className={`contact__act ${pinned ? "on" : ""}`}
          title={pinned ? t("group_unpin") : t("group_pin")}
          aria-label={pinned ? t("group_unpin") : t("group_pin")}
          data-testid="pin-group"
          onClick={onTogglePin}
        >
          📌
        </button>
      ) : null}
    </div>
  );
}

function GroupModal({
  contacts,
  onCreate,
  onCancel,
}: {
  contacts: Contact[];
  onCreate: (name: string, memberPubkeys: string[]) => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (pk: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(pk)) next.delete(pk);
      else next.add(pk);
      return next;
    });
  const create = () => {
    if (picked.size === 0) return;
    onCreate(name.trim() || t("group_section"), [...picked]);
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t("group_create")} onClick={onCancel}>
      <div className="modal__box win" onClick={(e) => e.stopPropagation()}>
        <div className="win__title">
          <span>{t("group_create")}</span>
          <span className="spacer" />
          <span className="win__btn" role="button" aria-label={t("convo_close")} onClick={onCancel}>×</span>
        </div>
        <div className="groupmodal">
          <input
            className="groupmodal__name"
            aria-label={t("group_name")}
            placeholder={t("group_name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="groupmodal__label">{t("group_members")}</div>
          <div className="groupmodal__list">
            {contacts.map((c) => (
              <label key={c.pubkey} className="groupmodal__item">
                <input type="checkbox" checked={picked.has(c.pubkey)} onChange={() => toggle(c.pubkey)} />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
          <button className="groupmodal__create" data-testid="group-confirm" disabled={picked.size === 0} onClick={create}>
            {t("group_confirm")}
          </button>
        </div>
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
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(selfNpub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const add = () => {
    const v = value.trim();
    if (!v) return;
    try {
      onAdd(v);
      setValue("");
      setError("");
    } catch (e) {
      // onAdd 以 "self-identity" 代碼表示「加到自己的身分」（跨身分互加被擋，見 ADR-0055）；
      // 其餘（含非法 npub）顯示為無效。
      setError(e instanceof Error && e.message === "self-identity" ? t("contact_addSelf") : t("contact_addInvalid"));
    }
  };
  return (
    <div className="addbar">
      <div className="myid" title={selfNpub}>
        <b>{myIdLabel}:</b> <span className="myid__val" data-testid="my-npub">{shortId(selfNpub)}</span>
        {selfNpub ? (
          <>
            <button
              className="myid__qr"
              title={copied ? t("contact_copied") : t("contact_copy")}
              data-testid="copy-id"
              onClick={copy}
            >
              {copied ? "✓" : "📋"}
            </button>
            <button className="myid__qr" title={t("qr_show")} data-testid="qr-show" onClick={() => setShowQr(true)}>
              ▦
            </button>
          </>
        ) : null}
      </div>
      {showQr && selfNpub ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label={t("qr_title")} onClick={() => setShowQr(false)}>
          <div className="modal__box win qrcard" onClick={(e) => e.stopPropagation()}>
            <div className="win__title">
              <span>{t("qr_title")}</span>
              <span className="spacer" />
              <span className="win__btn" role="button" aria-label="×" onClick={() => setShowQr(false)}>×</span>
            </div>
            <div className="qrcard__body">
              <img className="qrcard__img" data-testid="qr-img" src={qrDataUri(selfNpub, { cell: 5 })} alt={t("qr_alt")} />
              <div className="qrcard__hint">{t("qr_hint")}</div>
              <code className="qrcard__npub">{selfNpub}</code>
            </div>
          </div>
        </div>
      ) : null}
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
      {error ? (
        <div className="addbar__error" data-testid="add-error" role="alert">
          {error}
        </div>
      ) : null}
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
  onSummarize,
}: {
  contact: Contact;
  onOpen: (pk: string) => void;
  hint: string;
  unread: number;
  onRemove?: ((pubkey: string) => void) | undefined;
  onBlock?: ((pubkey: string) => void) | undefined;
  onSummarize?: ((pubkey: string) => void) | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const secondary = contact.nowPlaying
    ? <span className="np">♪ {contact.nowPlaying}</span>
    : renderStatus(contact.statusMessage);
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
      <div className={`avatar sm ring-${contact.status}`} style={{ background: avatarColor(contact.pubkey) }}>{initial(contact.name)}</div>
      <div className="contact__info">
        <div className="contact__name">{contact.name}</div>
        <div className="contact__msg">{secondary}</div>
      </div>
      {unread > 0 ? (
        <span className="unread-badge" title={t("unread_title", { count: unread })}>{unread}</span>
      ) : null}
      <span className="contact__acts">
        {onSummarize && unread > 0 ? (
          <button
            className="contact__act"
            title={t("ai_summarize")}
            data-testid="summarize-btn"
            onClick={() => onSummarize(contact.pubkey)}
          >
            🧠
          </button>
        ) : null}
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
