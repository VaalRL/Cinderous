import { useState } from "react";
import type { ChatMessage, Contact, Group, Self, Status } from "@cinder/engine";
import { useI18n } from "../i18n.js";
import { Avatar } from "./Avatar.js";
import { AddContact, StatusPicker } from "./ContactListWindow.js";
import { buildEntries, type SidebarEntry, visibleEntries } from "./deck-sidebar.js";
import type { GroupPrefsMap } from "./group-labels.js";

export interface DeckSidebarProps {
  self: Self;
  contacts: Contact[];
  groups: Group[];
  convos: Record<string, ChatMessage[]>;
  prefs: GroupPrefsMap;
  unread: Record<string, number>;
  onOpen: (id: string) => void;
  onOpenSettings: () => void;
  onStatus: (s: Status) => void;
  onAddLabel: (id: string, label: string) => void;
  onRemoveLabel: (id: string, label: string) => void;
  labelOptions: string[];
  activeLabel: string | undefined;
  onFilterLabel: (label: string | undefined) => void;
  selfNpub?: string;
  onAddContact?: (npub: string) => void;
}

/** 某對話最後一則訊息的預覽文字（檔案訊息以佔位表示）。 */
function preview(id: string, convos: Record<string, ChatMessage[]>): string {
  const msgs = convos[id];
  if (!msgs || msgs.length === 0) return "";
  const last = msgs[msgs.length - 1]!;
  return last.file ? `📎 ${last.file.name}` : last.text;
}

/** 三欄左側欄（ADR-0079 Q2）：聯絡人＋群組混合、最近互動排序、搜尋、標籤篩選、雙擊開對話。 */
export function DeckSidebar(props: DeckSidebarProps): JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [labelEditId, setLabelEditId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const entries = visibleEntries(
    buildEntries(props.contacts, props.groups, props.convos, props.prefs),
    query,
    props.activeLabel,
    props.convos,
  );

  const submitLabel = (id: string): void => {
    const v = labelDraft.trim();
    if (v) props.onAddLabel(id, v);
    setLabelDraft("");
    setLabelEditId(null);
  };

  return (
    <div className="dsb">
      <div className="dsb__me">
        <Avatar id={props.self.pubkey} name={props.self.name} ring={`ring-${props.self.status}`} className="sm" />
        <div className="dsb__meinfo">
          <div className="dsb__mename">{props.self.name}</div>
          <StatusPicker value={props.self.status} onChange={props.onStatus} />
        </div>
        <button
          type="button"
          className="themebtn"
          aria-label={t("settings_open")}
          title={t("settings_open")}
          onClick={props.onOpenSettings}
        >
          ⚙️
        </button>
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

      <div className="dsb__search">
        <input
          aria-label={t("sidebar_search")}
          placeholder={t("sidebar_search")}
          value={query}
          data-testid="sidebar-search"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {props.labelOptions.length > 0 ? (
        <div className="labelbar" data-testid="sidebar-labelfilter">
          <button
            type="button"
            className={`chip chip--filter ${props.activeLabel ? "" : "chip--on"}`}
            onClick={() => props.onFilterLabel(undefined)}
          >
            {t("group_filterAll")}
          </button>
          {props.labelOptions.map((l) => (
            <button
              type="button"
              key={l}
              className={`chip chip--filter ${props.activeLabel === l ? "chip--on" : ""}`}
              onClick={() => props.onFilterLabel(props.activeLabel === l ? undefined : l)}
            >
              {l}
            </button>
          ))}
        </div>
      ) : null}

      <div className="dsb__list" data-testid="sidebar-list">
        {entries.length === 0 ? <div className="dsb__empty">{t("sidebar_empty")}</div> : null}
        {entries.map((e) => (
          <DeckRow
            key={e.id}
            entry={e}
            preview={preview(e.id, props.convos)}
            unread={props.unread[e.id] ?? 0}
            editing={labelEditId === e.id}
            labelDraft={labelDraft}
            onOpen={() => props.onOpen(e.id)}
            onStartLabel={() => {
              setLabelEditId(e.id);
              setLabelDraft("");
            }}
            onLabelDraft={setLabelDraft}
            onSubmitLabel={() => submitLabel(e.id)}
            onCancelLabel={() => setLabelEditId(null)}
            onRemoveLabel={(l) => props.onRemoveLabel(e.id, l)}
          />
        ))}
      </div>
    </div>
  );
}

function DeckRow({
  entry,
  preview: prev,
  unread,
  editing,
  labelDraft,
  onOpen,
  onStartLabel,
  onLabelDraft,
  onSubmitLabel,
  onCancelLabel,
  onRemoveLabel,
}: {
  entry: SidebarEntry;
  preview: string;
  unread: number;
  editing: boolean;
  labelDraft: string;
  onOpen: () => void;
  onStartLabel: () => void;
  onLabelDraft: (v: string) => void;
  onSubmitLabel: () => void;
  onCancelLabel: () => void;
  onRemoveLabel: (label: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const dot = entry.kind === "contact" ? entry.status ?? "offline" : "online";
  return (
    <div className={`dsb__row ${entry.kind === "contact" && entry.status === "offline" ? "offline" : ""}`} title={t("contact_openHint")}>
      <div className="dsb__rowmain" onDoubleClick={onOpen}>
        <span className={`dot ${dot}`} aria-hidden="true" />
        <div className="dsb__rowtext">
          <div className="dsb__rowname">
            {entry.kind === "group" ? <span className="dsb__hash" aria-hidden="true"># </span> : null}
            {entry.name}
          </div>
          {prev ? <div className="dsb__rowprev">{prev}</div> : null}
        </div>
        {unread > 0 ? <span className="unread-badge">{unread}</span> : null}
        <button
          type="button"
          className="dsb__label"
          title={t("sidebar_labelAdd")}
          data-testid="sidebar-label-btn"
          onClick={onStartLabel}
        >
          🏷
        </button>
      </div>
      {entry.labels.length > 0 || editing ? (
        <div className="labelrow dsb__labels">
          {entry.labels.map((l) => (
            <span className="chip" key={l}>
              {l}
              <button className="chip__x" aria-label={t("group_labelRemove", { label: l })} onClick={() => onRemoveLabel(l)}>
                ×
              </button>
            </span>
          ))}
          {editing ? (
            <input
              className="labelrow__input"
              aria-label={t("group_labelPlaceholder")}
              placeholder={t("group_labelPlaceholder")}
              autoFocus
              value={labelDraft}
              onChange={(e) => onLabelDraft(e.target.value)}
              onBlur={onSubmitLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmitLabel();
                else if (e.key === "Escape") onCancelLabel();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
