// 右欄「行程」分頁（ADR-0259 實作階段三）：每個對話的共享行程。
//
// ## 這個面板只做兩件事
//
// 1. **主揪**（建立者）看得到「編輯／取消」——ADR-0259 §1.7 的權威模型在 UI 的體現。
//    非主揪連按鈕都不出現，不是按了才被拒（引擎與 core 仍各有一道，這裡是可用性不是安全性）。
// 2. **其他人**看得到「參加／也許／不參加」。RSVP 是每人對自己狀態的宣告，誰都能改自己的。
//
// 時間全部是本機時區的顯示與輸入；行程本身存 unix 秒。**提醒是本機的事**（ADR-0259 §1.4
// 紅線：零中繼成本），本面板不排任何遠端觸發。

import type { CalendarEventInput, RsvpStatus, StoredCalendarEvent } from "@cinderous/engine";
import type { MessageKey } from "@cinderous/i18n";
import { useState, type JSX } from "react";
import { useI18n } from "../i18n.js";
import { useDialog } from "./Dialog.js";

export interface CalendarPanelProps {
  /** 本對話的行程（呼叫端已依對話篩選）。 */
  events: StoredCalendarEvent[];
  selfPubkey: string;
  /** 建立或修改；`eventId` 有值＝修改。 */
  onPublish: (input: CalendarEventInput, opts?: { eventId?: string }) => void;
  /** 取消行程（僅主揪；破壞性，呼叫端不必再確認——本元件已確認過）。 */
  onCancel: (eventId: string) => void;
  onRsvp: (eventId: string, status: RsvpStatus) => void;
  /**
   * 設定本機提醒（ADR-0262）；`undefined`＝不提醒。**未提供＝不顯示提醒選單**
   * （後端無此能力）。純本機、零中繼流量，其他參與者不會知道。
   */
  onRemind?: (eventId: string, lead: number | undefined) => void;
  /** pubkey → 顯示名（列出誰要來）。 */
  nameFor: (pubkey: string) => string;
  /**
   * 由對話中的日期標記帶進來的預填（ADR-0260 階段四）：`nonce` 變動即開啟新建表單並帶入時間。
   * **一律由使用者點擊觸發**——本元件不會自己冒出表單（ADR-0259 §1.6 否決自動導覽）。
   */
  draft?: { at: number; nonce: number } | undefined;
}

/** unix 秒 → `datetime-local` 需要的本機時間字串（`YYYY-MM-DDTHH:mm`）。 */
function toLocalInput(sec: number): string {
  const d = new Date(sec * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` 字串 → unix 秒；空字串或不合法回 undefined。 */
function fromLocalInput(v: string): number | undefined {
  if (!v) return undefined;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/** 行程時間的人類可讀顯示（本機時區）。 */
function formatRange(start: number, end: number | undefined, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  const s = new Date(start * 1000).toLocaleString(locale, opts);
  if (end === undefined) return s;
  const sameDay = new Date(start * 1000).toDateString() === new Date(end * 1000).toDateString();
  const e = new Date(end * 1000).toLocaleString(
    locale,
    sameDay ? { hour: "2-digit", minute: "2-digit" } : opts,
  );
  return `${s} – ${e}`;
}

/**
 * 提醒選項（ADR-0262）。`undefined`＝不提醒。順序即選單順序，預設值在 `CALENDAR_REMINDER_LEADS`
 * 之外另有 `CALENDAR_REMINDER_DEFAULT_LEAD`——但**沒選過就是不提醒**：預設值只在使用者
 * 主動打開提醒時當起始選擇，不會替他決定要被吵。
 */
const REMIND_CHOICES: { lead: number | undefined; key: MessageKey }[] = [
  { lead: undefined, key: "cal_remindOff" },
  { lead: 0, key: "cal_remindNow" },
  { lead: 5 * 60, key: "cal_remind5m" },
  { lead: 15 * 60, key: "cal_remind15m" },
  { lead: 60 * 60, key: "cal_remind1h" },
  { lead: 24 * 3600, key: "cal_remind1d" },
];

const RSVP_CHOICES: { status: RsvpStatus; key: "cal_rsvpYes" | "cal_rsvpMaybe" | "cal_rsvpNo" }[] = [
  { status: "accepted", key: "cal_rsvpYes" },
  { status: "tentative", key: "cal_rsvpMaybe" },
  { status: "declined", key: "cal_rsvpNo" },
];

/** 建立/編輯表單。`initial` 有值＝編輯既有行程。 */
function EventForm({
  initial,
  startAt,
  onSubmit,
  onDismiss,
}: {
  initial?: StoredCalendarEvent | undefined;
  /** 新建時的預設開始時間（unix 秒）；來自對話中被點擊的日期。 */
  startAt?: number | undefined;
  onSubmit: (input: CalendarEventInput) => void;
  onDismiss: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [title, setTitle] = useState(initial?.title ?? "");
  // 預設開始時間＝下一個整點，省去使用者每次都要挑（新建時才用）。
  const [start, setStart] = useState(
    toLocalInput(initial?.start ?? startAt ?? Math.ceil(Date.now() / 1000 / 3600) * 3600),
  );
  const [end, setEnd] = useState(initial?.end !== undefined ? toLocalInput(initial.end) : "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  const startSec = fromLocalInput(start);
  const endSec = fromLocalInput(end);
  // 標題與開始時間是最低要求；結束時間若早於開始就當沒填（不擋送出，但也不存錯的值）。
  const valid = title.trim().length > 0 && startSec !== undefined;

  return (
    <form
      className="cal__form"
      data-testid="cal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({
          title: title.trim(),
          start: startSec,
          ...(endSec !== undefined && endSec > startSec ? { end: endSec } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        });
      }}
    >
      <input
        className="cal__in"
        data-testid="cal-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("cal_title")}
        aria-label={t("cal_title")}
        maxLength={80}
      />
      <label className="cal__lbl">
        {t("cal_start")}
        <input
          type="datetime-local"
          className="cal__in"
          data-testid="cal-start"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <label className="cal__lbl">
        {t("cal_end")}
        <input
          type="datetime-local"
          className="cal__in"
          data-testid="cal-end"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </label>
      <input
        className="cal__in"
        data-testid="cal-location"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder={t("cal_location")}
        aria-label={t("cal_location")}
        maxLength={120}
      />
      <textarea
        className="cal__in cal__desc"
        data-testid="cal-desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("cal_desc")}
        aria-label={t("cal_desc")}
        maxLength={500}
      />
      <div className="cal__formbtns">
        <button type="submit" className="cal__save" data-testid="cal-save" disabled={!valid}>
          {t("cal_save")}
        </button>
        <button type="button" className="cal__ghost" data-testid="cal-dismiss" onClick={onDismiss}>
          {t("cal_dismiss")}
        </button>
      </div>
    </form>
  );
}

export function CalendarPanel(props: CalendarPanelProps): JSX.Element {
  const { t, locale } = useI18n();
  const { confirm } = useDialog();
  /**
   * `null`＝沒在編輯；`""`＝新建；其餘＝正在編輯該 id。
   *
   * **掛載時就帶著 draft ＝直接開表單**：實際流程是「點對話裡的日期 → 右欄切到行程分頁 →
   * 本元件才掛載」，所以第一次 render 就已經有 draft 了，不能當成「已看過」。
   */
  const [editing, setEditing] = useState<string | null>(props.draft ? "" : null);
  const nowSec = Math.floor(Date.now() / 1000);
  // 對話中的日期被點擊 → 開新建表單並帶入時間。依 nonce 觸發（同 App 既有的 pendingInsert 模式），
  // 這樣「點同一個日期兩次」也會重新開啟。
  //
  // **在 render 期間調整 state**（React 官方的 derived-state-from-props 模式），不是 useEffect：
  // 少一次 paint，且伺服器端渲染（測試用 renderToStaticMarkup）也走得到——effect 在 SSR 不執行。
  const draftNonce = props.draft?.nonce;
  const [seenNonce, setSeenNonce] = useState(draftNonce);
  if (draftNonce !== seenNonce) {
    setSeenNonce(draftNonce);
    if (draftNonce !== undefined) setEditing("");
  }

  const sorted = [...props.events].sort((a, b) => a.start - b.start);

  return (
    <div className="cal" data-testid="aux-calendar">
      {editing === null ? (
        <button type="button" className="cal__new" data-testid="cal-new" onClick={() => setEditing("")}>
          ＋ {t("cal_new")}
        </button>
      ) : (
        <EventForm
          {...(editing ? { initial: sorted.find((e) => e.id === editing) } : {})}
          {...(!editing && props.draft ? { startAt: props.draft.at } : {})}
          onDismiss={() => setEditing(null)}
          onSubmit={(input) => {
            props.onPublish(input, editing ? { eventId: editing } : undefined);
            setEditing(null);
          }}
        />
      )}

      {sorted.length === 0 ? (
        <div className="daux__empty">{t("cal_none")}</div>
      ) : (
        <ul className="cal__list">
          {sorted.map((e) => {
            const mine = e.organizer === props.selfPubkey;
            const past = (e.end ?? e.start) < nowSec;
            const myRsvp = e.rsvps?.[props.selfPubkey]?.status;
            // 只列「要來」與「也許」——不列缺席者（那是噪音，且對沒回覆的人不公平）。
            const going = Object.entries(e.rsvps ?? {}).filter(([, r]) => r.status !== "declined");
            return (
              <li className={`cal__item${past ? " cal__item--past" : ""}`} key={e.id} data-testid="cal-item">
                <div className="cal__when">{formatRange(e.start, e.end, locale)}</div>
                <div className="cal__name">{e.title}</div>
                {e.location ? <div className="cal__loc">📍 {e.location}</div> : null}
                {e.description ? <div className="cal__descout">{e.description}</div> : null}
                <div className="cal__by">{mine ? t("cal_byYou") : t("cal_by", { name: props.nameFor(e.organizer) })}</div>

                {going.length > 0 ? (
                  <div className="cal__going" data-testid="cal-going">
                    {going
                      .map(([pk, r]) => `${props.nameFor(pk)}${r.status === "tentative" ? "?" : ""}`)
                      .join("、")}
                  </div>
                ) : null}

                {/* 提醒（ADR-0262）：**本機的**，其他參與者不會知道，也不產生任何中繼流量。
                    已過去的行程不顯示——提醒一個過去的時間沒有意義。 */}
                {props.onRemind && !past ? (
                  <label className="cal__remind" data-testid="cal-remind">
                    <span className="cal__remindlbl">🔔 {t("cal_remindLabel")}</span>
                    <select
                      className="cal__remindsel"
                      data-testid={`cal-remind-${e.id}`}
                      title={t("cal_remindHint")}
                      value={e.remindLead === undefined ? "" : String(e.remindLead)}
                      onChange={(ev) =>
                        props.onRemind?.(e.id, ev.target.value === "" ? undefined : Number(ev.target.value))
                      }
                    >
                      {REMIND_CHOICES.map((c) => (
                        <option key={c.key} value={c.lead === undefined ? "" : String(c.lead)}>
                          {t(c.key)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {/* 主揪權威（§1.7）：非主揪連按鈕都不出現。 */}
                {mine ? (
                  <div className="cal__acts">
                    <button type="button" className="cal__ghost" data-testid="cal-edit" onClick={() => setEditing(e.id)}>
                      {t("cal_edit")}
                    </button>
                    <button
                      type="button"
                      className="cal__danger"
                      data-testid="cal-cancel"
                      onClick={() => {
                        void confirm(t("cal_cancelConfirm", { title: e.title })).then((ok) => {
                          if (ok) props.onCancel(e.id);
                        });
                      }}
                    >
                      {t("cal_cancelEvent")}
                    </button>
                  </div>
                ) : (
                  <div className="cal__acts">
                    {RSVP_CHOICES.map((c) => (
                      <button
                        type="button"
                        key={c.status}
                        className={`cal__rsvp${myRsvp === c.status ? " on" : ""}`}
                        data-testid={`cal-rsvp-${c.status}`}
                        aria-pressed={myRsvp === c.status}
                        onClick={() => props.onRsvp(e.id, c.status)}
                      >
                        {t(c.key)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
