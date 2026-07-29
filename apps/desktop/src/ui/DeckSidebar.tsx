import { useState } from "react";
import { CinderMascot } from "@cinderous/brand";
import type { BlockedContact, ChatMessage, Contact, ContactRequest, Group, Self, Status } from "@cinderous/engine";
import { useI18n } from "../i18n.js";
import { Avatar, EditableAvatar } from "./Avatar.js";
import { AddContact, StatusPicker } from "./ContactListWindow.js";
import { ContactRow } from "./ContactRow.js";
import { hasRichStatus, renderStatus } from "./status-text.js";
import { buildEntries, messagePreview, type SidebarEntry, visibleEntries } from "./deck-sidebar.js";
import type { GroupPrefsMap } from "./group-labels.js";

export interface DeckSidebarProps {
  self: Self;
  contacts: Contact[];
  groups: Group[];
  convos: Record<string, ChatMessage[]>;
  prefs: GroupPrefsMap;
  unread: Record<string, number>;
  onOpen: (id: string) => void;
  onStatus: (s: Status) => void;
  /** 自訂狀態文字（ADR-0142）：三欄版過去缺這個入口。 */
  onStatusMessage: (message: string) => void;
  /** 正在聽什麼（可選）。 */
  onNowPlaying?: (text: string) => void;
  /** 自動偵測正在聽（ADR-0252）：切換開關；僅 Tauri 提供（瀏覽器讀不到系統媒體）。 */
  onToggleNpAuto?: () => void;
  /** 自動偵測目前是否開啟。 */
  npAuto?: boolean;
  /** 自動偵測到的曲目（顯示用；空＝偵測中/無播放）。 */
  npAutoText?: string;
  onAddLabel: (id: string, label: string) => void;
  onRemoveLabel: (id: string, label: string) => void;
  labelOptions: string[];
  activeLabel: string | undefined;
  onFilterLabel: (label: string | undefined) => void;
  selfNpub?: string;
  onAddContact?: (npub: string) => void;
  /** 設定/移除自己的廣播頭像（ADR-0154）；三欄版過去連本地換圖入口都缺，一併補上。 */
  onSelfAvatar?: (uri: string | undefined) => boolean;
  /** 刪除聯絡人（ADR-0214：統一列操作鈕，三欄版補上 🗑）。 */
  onRemoveContact?: (pubkey: string) => void;
  /** 封鎖聯絡人（ADR-0214：三欄版補上 🚫）。 */
  onBlockContact?: (pubkey: string) => void;
  /** 點開前以本機 AI 摘要未讀（ADR-0060/0214：三欄版補上 🧠，有未讀才顯示）。 */
  onSummarize?: (pubkey: string) => void;
  /**
   * 訊息請求（ADR-0121／0285）：**三欄版過去完全沒有這一區**——`App.tsx` 只把
   * `addContactProps` 傳進來，帶著 `requests` 的 `manageProps` 只給了經典版。
   * 結果是：對方把你加為好友，你在三欄佈局下**看不到任何東西**，也就永遠不會接受，
   * 於是雙方的顯示名稱都停在 `npub1abc…`。
   */
  requests?: ContactRequest[];
  onAcceptRequest?: (pubkey: string) => void;
  onDeclineRequest?: (pubkey: string) => void;
  /** 預覽請求裡的訊息（只開窗、不接受——不送已讀回條給非聯絡人）。 */
  onOpenRequest?: (pubkey: string) => void;
  /** 全部刪除（ADR-0127 防洪）：被灌爆時一次清空。 */
  onClearRequests?: () => void;
  /**
   * 已封鎖名單（ADR-0285）：三欄版同樣漏接——封鎖之後**沒有任何地方解得開**。
   * 與請求區同一個成因（`manageProps` 只給了經典版）。
   */
  blocked?: BlockedContact[];
  onUnblockContact?: (pubkey: string) => void;
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
        {/* 尺寸與經典版 me 列對齊（44px 基礎款）——原本掛 sm（30px）偏小（使用者回報）。 */}
        <EditableAvatar
          id={props.self.pubkey}
          name={props.self.name}
          ring={`ring-${props.self.status}`}
          {...(props.onSelfAvatar ? { onBroadcast: props.onSelfAvatar } : {})}
        />
        <div className="dsb__meinfo">
          <div className="dsb__mename">{props.self.name}</div>
          <StatusPicker value={props.self.status} onChange={props.onStatus} />
          {/* 自訂狀態文字（ADR-0142）：與經典版同一套（含 :emoji: 等富狀態預覽）。 */}
          <div className="me__msg">
            <input
              aria-label={t("personalMessage_placeholder")}
              placeholder={t("personalMessage_placeholder")}
              value={props.self.statusMessage}
              onChange={(e) => props.onStatusMessage(e.target.value)}
            />
          </div>
          {hasRichStatus(props.self.statusMessage) ? (
            <div className="me__msg-preview" aria-hidden="true">{renderStatus(props.self.statusMessage)}</div>
          ) : null}
          {props.onNowPlaying ? (
            <div className="me__np">
              {/* ♪ 點擊切換自動偵測（ADR-0252）：與經典佈局同款（僅 Tauri 有切換鈕）。 */}
              {props.onToggleNpAuto ? (
                <button
                  type="button"
                  className={`me__np-ic me__np-auto${props.npAuto ? " me__np-auto--on" : ""}`}
                  title={t("npAuto_toggle")}
                  aria-label={t("npAuto_toggle")}
                  aria-pressed={!!props.npAuto}
                  data-testid="np-auto-toggle"
                  onClick={props.onToggleNpAuto}
                >
                  ♪
                </button>
              ) : (
                <span className="me__np-ic">♪</span>
              )}
              {props.npAuto ? (
                <span className="me__np-live" data-testid="np-auto-live">
                  {props.npAutoText || t("npAuto_detecting")}
                </span>
              ) : (
                <input
                  aria-label={t("nowPlaying_placeholder")}
                  placeholder={t("nowPlaying_placeholder")}
                  onBlur={(e) => props.onNowPlaying?.(e.target.value.trim())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              )}
            </div>
          ) : null}
        </div>
        {/* 吉祥物（ADR-0247 延伸）：三欄側欄 me 列與經典版對齊——原本只在中欄空狀態出現，
            開著對話時就整個消失（使用者回報）；有未讀時進入 alert 狀態，與經典同款。 */}
        <div className="me__mascot" title="Cinderous">
          <CinderMascot alert={Object.values(props.unread).some((n) => n > 0)} size={44} />
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

      {/* 訊息請求（ADR-0121／0285）：放在名冊**之前**——這是需要你裁示的東西，不該被埋在清單裡。
          與經典版同一套結構與 class，共用 msn.css 的 .requests 樣式。 */}
      {(props.requests ?? []).length > 0 ? (
        <div className="requests" data-testid="requests">
          <div className="group group--requests">
            <span>
              {t("request_section")}（{(props.requests ?? []).length}）
            </span>
            {props.onClearRequests && (props.requests ?? []).length > 1 ? (
              <button
                type="button"
                className="requests__clear"
                data-testid="requests-clear"
                onClick={() => props.onClearRequests?.()}
              >
                {t("request_clearAll")}
              </button>
            ) : null}
          </div>
          <div className="requests__hint">{t("request_hint")}</div>
          {(props.requests ?? []).map((r) => (
            <div className="request" key={r.pubkey} data-testid={`request-${r.pubkey}`}>
              <Avatar id={r.pubkey} name={r.name} />
              <button
                type="button"
                className="request__name"
                title={t("request_preview")}
                onClick={() => props.onOpenRequest?.(r.pubkey)}
              >
                {r.name}
              </button>
              <button
                type="button"
                className="request__ok"
                data-testid={`request-accept-${r.pubkey}`}
                onClick={() => props.onAcceptRequest?.(r.pubkey)}
              >
                {t("request_accept")}
              </button>
              <button
                type="button"
                className="request__no"
                data-testid={`request-decline-${r.pubkey}`}
                onClick={() => props.onDeclineRequest?.(r.pubkey)}
              >
                {t("request_decline")}
              </button>
              <button
                type="button"
                className="request__block"
                data-testid={`request-block-${r.pubkey}`}
                onClick={() => props.onBlockContact?.(r.pubkey)}
              >
                {t("contact_block")}
              </button>
            </div>
          ))}
        </div>
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
        {entries.map((e) =>
          e.kind === "contact" ? (
            // ADR-0214：聯絡人列改用共用 ContactRow（與經典版同一份規格：情境切換副線＋統一操作鈕）。
            <ContactRow
              key={e.id}
              id={e.id}
              name={e.name}
              status={e.status ?? "offline"}
              unread={props.unread[e.id] ?? 0}
              hint={t("contact_openHint")}
              {...(e.statusMessage ? { statusMessage: e.statusMessage } : {})}
              {...(e.nowPlaying ? { nowPlaying: e.nowPlaying } : {})}
              preview={messagePreview(e.id, props.convos)}
              {...(e.title ? { title: e.title } : {})}
              labels={e.labels}
              onOpen={props.onOpen}
              {...(props.onRemoveContact ? { onRemove: props.onRemoveContact } : {})}
              {...(props.onBlockContact ? { onBlock: props.onBlockContact } : {})}
              {...(props.onSummarize ? { onSummarize: props.onSummarize } : {})}
              onAddLabel={props.onAddLabel}
              onRemoveLabel={props.onRemoveLabel}
            />
          ) : (
            <DeckRow
              key={e.id}
              entry={e}
              preview={messagePreview(e.id, props.convos)}
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
          ),
        )}
        {/* 已封鎖（ADR-0285）：三欄版原本沒有這一區——封鎖之後沒有任何地方解得開。
            與經典版同一套 class，共用既有樣式。 */}
        {(props.blocked ?? []).length > 0 ? (
          <div className="dsb__blocked" data-testid="sidebar-blocked">
            <div className="group">{t("group_blocked", { count: (props.blocked ?? []).length })}</div>
            {(props.blocked ?? []).map((b) => (
              <div className="contact blocked" key={b.pubkey} data-testid={`blocked-${b.pubkey}`}>
                <Avatar id={b.pubkey} name={b.name} />
                <div className="contact__info">
                  <div className="contact__name">{b.name}</div>
                </div>
                {props.onUnblockContact ? (
                  <button
                    type="button"
                    className="contact__act"
                    data-testid={`unblock-${b.pubkey}`}
                    onClick={() => props.onUnblockContact?.(b.pubkey)}
                  >
                    {t("contact_unblock")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
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
      {entry.title || entry.labels.length > 0 || editing ? (
        <div className="labelrow dsb__labels">
          {/* 企業頭銜（ADR-0158）：實心強調色 chip，與私標 outline 區隔；不可移除（對方自填）。 */}
          {entry.title ? (
            <span className="chip chip--role" data-testid="sidebar-title-chip">
              {entry.title}
            </span>
          ) : null}
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
