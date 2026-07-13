import { useState } from "react";
import { calcPreview } from "@cinder/core";
import type { ChatMessage, Contact, Group, Self, Status } from "@cinder/engine";
import type { MessageKey } from "@cinder/i18n";
import { useI18n } from "../i18n.js";
import { Avatar } from "./Avatar.js";
import { replyCounts } from "./thread-util.js";

type AuxTab = "info" | "members" | "media" | "threads" | "calc";

/**
 * 右欄計算機（ADR-0097）：**自己的輸入框**，不碰主對話框草稿。純本地計算（禁用 eval），
 * 算完可選擇「插入」回主對話框——不會偷改你正在打的內容。
 */
function CalcPanel({ onInsert }: { onInsert?: ((text: string) => void) | undefined }): JSX.Element {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const calc = calcPreview(input);
  return (
    <div className="daux__calc">
      <input
        className="daux__calcin"
        data-testid="aux-calc-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={t("calc_placeholder")}
        aria-label={t("aux_tabCalc")}
      />
      {calc ? (
        <>
          <div className="daux__calcout" data-testid="aux-calc-result">
            <span className="daux__calcexpr">{calc.expr}</span>
            <span className="daux__calceq">=</span>
            <b className="daux__calcval">{calc.result}</b>
          </div>
          {onInsert ? (
            <div className="daux__calcbtns">
              <button
                type="button"
                className="daux__calcbtn"
                data-testid="aux-calc-insert"
                onClick={() => onInsert(`${calc.expr} = ${calc.result}`)}
              >
                {t("calc_insertExpr")}
              </button>
              <button
                type="button"
                className="daux__calcbtn"
                data-testid="aux-calc-insert-result"
                onClick={() => onInsert(calc.result)}
              >
                {t("calc_insertResult")}
              </button>
            </div>
          ) : null}
        </>
      ) : input.trim() ? (
        <div className="daux__calchint">{t("calc_notExpr")}</div>
      ) : (
        <div className="daux__calchint">{t("calc_hint")}</div>
      )}
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
  const msgs = props.convos[activeId] ?? [];
  const nameFor = (pk: string): string =>
    pk === props.self.pubkey ? props.self.name : props.contacts.find((c) => c.pubkey === pk)?.name ?? `${pk.slice(0, 8)}…`;

  const members = group ? group.members : contact ? [props.self.pubkey, contact.pubkey] : [];
  const images = msgs.filter((m) => m.file?.mime.startsWith("image/") && m.file.url);
  const threadRoots = [...replyCounts(msgs).entries()].filter(([, n]) => n > 0);

  const TABS: { key: AuxTab; label: string; count?: number }[] = [
    { key: "threads", label: t("aux_tabThreads"), count: threadRoots.length },
    { key: "members", label: t("aux_tabMembers"), count: members.length },
    { key: "media", label: t("aux_tabMedia"), count: images.length },
    { key: "calc", label: t("aux_tabCalc") },
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
              {images.map((m) => (
                <a key={m.id} href={m.file!.url} target="_blank" rel="noreferrer" className="daux__thumb">
                  <img src={m.file!.url} alt={m.file!.name} />
                </a>
              ))}
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

        {/* 算式計算機（ADR-0097）：右欄自有輸入框，算完自行決定要不要插回主對話框。 */}
        {tab === "calc" ? <CalcPanel onInsert={props.onInsert} /> : null}
      </div>
    </div>
  );
}
