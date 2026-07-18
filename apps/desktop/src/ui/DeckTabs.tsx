import type { Contact, Group } from "@cinderous/engine";
import { useI18n } from "../i18n.js";

export interface DeckTabsProps {
  open: string[];
  active: string | null;
  contacts: Contact[];
  groups: Group[];
  unread: Record<string, number>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

/** 三欄中欄的對話分頁列（ADR-0079 Q3）：每個開啟中的對話一個分頁，點選切換、× 關閉。 */
export function DeckTabs(props: DeckTabsProps): JSX.Element {
  const { t } = useI18n();
  const nameOf = (id: string): string => {
    const g = props.groups.find((x) => x.id === id);
    if (g) return g.name;
    return props.contacts.find((c) => c.pubkey === id)?.name ?? `${id.slice(0, 8)}…`;
  };
  const isGroup = (id: string): boolean => props.groups.some((g) => g.id === id);
  return (
    <div className="dtabs" role="tablist" data-testid="deck-tabs">
      {props.open.map((id) => (
        <div
          key={id}
          role="tab"
          aria-selected={id === props.active}
          className={`dtabs__tab${id === props.active ? " on" : ""}`}
          data-testid="deck-tab"
          onClick={() => props.onActivate(id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") props.onActivate(id);
          }}
          tabIndex={0}
        >
          {isGroup(id) ? <span className="dtabs__hash" aria-hidden="true">#</span> : null}
          <span className="dtabs__name">{nameOf(id)}</span>
          {props.unread[id] ? <span className="unread-badge">{props.unread[id]}</span> : null}
          <button
            type="button"
            className="dtabs__x"
            aria-label={t("convo_close")}
            data-testid="deck-tab-close"
            onClick={(e) => {
              e.stopPropagation();
              props.onClose(id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
