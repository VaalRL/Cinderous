import { useState } from "react";
import { calcPreview } from "@cinderous/core";
import type { ChatMessage, Contact, Group, Self, Status } from "@cinderous/engine";
import type { MessageKey } from "@cinderous/i18n";
import { useI18n } from "../i18n.js";
import { Avatar } from "./Avatar.js";
import { replyCounts } from "@cinderous/engine";
import { loadNote, saveNote } from "./note-store.js";

type AuxTab = "info" | "members" | "media" | "threads" | "note";

/**
 * 右欄便條（ADR-0182）：**每對話一張私人便條**，純本機、不廣播、不上雲。**計算是其中一個功能**
 * （ADR-0097）——便條內容最後一個非空行若是算式，即時算出結果（禁用 eval），可選擇「插入」回
 * 主對話框（不會偷改你正在打的內容）。以對話 id 為 key 持久化（本元件以 `key={activeId}` 重掛）。
 */
function NotePanel({ convoId, onInsert }: { convoId: string; onInsert?: ((text: string) => void) | undefined }): JSX.Element {
  const { t } = useI18n();
  const [note, setNote] = useState(() => loadNote(convoId));
  const update = (v: string): void => {
    setNote(v);
    saveNote(convoId, v);
  };
  // 計算功能（ADR-0097）：取最後一個非空行判定是否為算式；是則顯示結果、可插回對話。
  const lastLine = note.split("\n").map((s) => s.trim()).filter(Boolean).pop() ?? "";
  const calc = calcPreview(lastLine);
  return (
    <div className="daux__note">
      <textarea
        className="daux__notein"
        data-testid="aux-note-input"
        value={note}
        onChange={(e) => update(e.target.value)}
        placeholder={t("note_placeholder")}
        aria-label={t("aux_tabNote")}
      />
      {calc ? (
        <div className="daux__calcout" data-testid="aux-note-calc">
          <span className="daux__calcexpr">{calc.expr}</span>
          <span className="daux__calceq">=</span>
          <b className="daux__calcval">{calc.result}</b>
          {onInsert ? (
            <div className="daux__calcbtns">
              <button
                type="button"
                className="daux__calcbtn"
                data-testid="aux-note-insert"
                onClick={() => onInsert(`${calc.expr} = ${calc.result}`)}
              >
                {t("calc_insertExpr")}
              </button>
              <button
                type="button"
                className="daux__calcbtn"
                data-testid="aux-note-insert-result"
                onClick={() => onInsert(calc.result)}
              >
                {t("calc_insertResult")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="daux__notehint">{t("note_hint")}</div>
    </div>
  );
}

const STATUS_LABEL: Record<Status, MessageKey> = {
  online: "status_online",
  away: "status_away",
  busy: "status_busy",
  offline: "status_offline",
};

export interface DeckRightProps {
  activeId: string | null;
  self: Self;
  contacts: Contact[];
  groups: Group[];
  convos: Record<string, ChatMessage[]>;
  /** 已收回（佔位）與無痕收回的訊息 id（審查修正）：相簿/串列表不得洩漏其內容。 */
  unsent?: Set<string>;
  purged?: Set<string>;
  /** 把右欄計算機的結果插入主對話框草稿（ADR-0097）；未提供則不顯示插入鈕。 */
  onInsert?: (text: string) => void;
}

/** 三欄右側欄：對話輔助區（ADR-0079 Q4）。四分頁從當前對話資料衍生；深度操作為後續擴充。 */
export function DeckRight(props: DeckRightProps): JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<AuxTab>("info");
  const { activeId } = props;

  if (!activeId) return <div className="deck__ph">{t("aux_pickChat")}</div>;

  const group = props.groups.find((g) => g.id === activeId);
  const contact = props.contacts.find((c) => c.pubkey === activeId);
  // 審查修正：已收回（含無痕）的訊息剔除——否則相簿仍顯示被收回的圖片、串列表洩漏原文。
  const msgs = (props.convos[activeId] ?? []).filter(
    (m) => !(props.unsent?.has(m.id) || props.purged?.has(m.id)),
  );
  const nameFor = (pk: string): string =>
    pk === props.self.pubkey ? props.self.name : props.contacts.find((c) => c.pubkey === pk)?.name ?? `${pk.slice(0, 8)}…`;

  const members = group ? group.members : contact ? [props.self.pubkey, contact.pubkey] : [];
  // ADR-0023／0102：可顯示＝本 session 有原圖 blob **或**有跨 session 存活的縮圖。
  const images = msgs.filter((m) => m.file?.mime.startsWith("image/") && (m.file.url || m.file.thumb));
  const threadRoots = [...replyCounts(msgs).entries()].filter(([, n]) => n > 0);

  const TABS: { key: AuxTab; label: string; count?: number }[] = [
    { key: "threads", label: t("aux_tabThreads"), count: threadRoots.length },
    { key: "members", label: t("aux_tabMembers"), count: members.length },
    { key: "media", label: t("aux_tabMedia"), count: images.length },
    { key: "note", label: t("aux_tabNote") },
    { key: "info", label: t("aux_tabInfo") },
  ];

  return (
    <div className="daux">
      <div className="daux__tabs" role="tablist">
        {TABS.map((x) => (
          <button
            type="button"
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            className={`daux__tab${tab === x.key ? " on" : ""}`}
            data-testid={`aux-tab-${x.key}`}
            onClick={() => setTab(x.key)}
          >
            {x.label}
            {x.count ? <span className="daux__count">{x.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="daux__body" data-testid="aux-body">
        {tab === "info" ? (
          <div className="daux__info">
            <Avatar id={activeId} name={group?.name ?? contact?.name ?? activeId} size={72} />
            <div className="daux__name">{group?.name ?? contact?.name ?? activeId}</div>
            {group ? (
              <div className="daux__sub">{t("group_membersCount", { count: group.members.length })}</div>
            ) : contact ? (
              <div className="daux__sub">{contact.statusMessage || t(STATUS_LABEL[contact.status])}</div>
            ) : null}
            <code className="daux__id">{activeId.slice(0, 24)}…</code>
          </div>
        ) : null}

        {tab === "members" ? (
          <div className="daux__list">
            {members.map((pk) => (
              <div className="daux__row" key={pk}>
                <Avatar id={pk} name={nameFor(pk)} className="sm" />
                <span className="daux__rowname">{nameFor(pk)}</span>
                {pk === props.self.pubkey ? <span className="daux__badge">{t("aux_you")}</span> : null}
                {group && group.admin === pk ? <span className="daux__badge">{t("aux_admin")}</span> : null}
              </div>
            ))}
          </div>
        ) : null}

        {tab === "media" ? (
          images.length === 0 ? (
            <div className="daux__empty">{t("aux_noMedia")}</div>
          ) : (
            <div className="daux__media">
              {images.map((m) => {
                // 縮圖一律顯示得出來（ADR-0102）；只有本 session 還握著原圖 blob 時才給「開新分頁看原圖」。
                const src = m.file!.url ?? m.file!.thumb;
                const inner = <img src={src} alt={m.file!.name} />;
                return m.file!.url ? (
                  <a key={m.id} href={m.file!.url} target="_blank" rel="noreferrer" className="daux__thumb">
                    {inner}
                  </a>
                ) : (
                  <span key={m.id} className="daux__thumb" title={m.file!.name}>
                    {inner}
                  </span>
                );
              })}
            </div>
          )
        ) : null}

        {tab === "threads" ? (
          threadRoots.length === 0 ? (
            <div className="daux__empty">{t("aux_noThreads")}</div>
          ) : (
            <div className="daux__list">
              {threadRoots.map(([rootId, count]) => {
                const root = msgs.find((m) => m.id === rootId);
                return (
                  <div className="daux__thread" key={rootId}>
                    <div className="daux__threadtext">{root ? root.file ? `📎 ${root.file.name}` : root.text : rootId.slice(0, 8)}</div>
                    <span className="daux__count">{t("aux_replies", { count })}</span>
                  </div>
                );
              })}
            </div>
          )
        ) : null}

        {/* 便條（ADR-0182）：每對話一張私人便條；計算是其中一個功能。key＝對話 id → 切換即載對應便條。 */}
        {tab === "note" ? <NotePanel key={activeId} convoId={activeId} onInsert={props.onInsert} /> : null}
      </div>
    </div>
  );
}
