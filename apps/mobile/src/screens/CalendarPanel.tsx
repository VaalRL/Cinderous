// 行動端「行程」分頁（ADR-0261）：桌面 `apps/desktop/src/ui/CalendarPanel.tsx` 的行動端版。
//
// ## 與桌面同的部分（**刻意逐條對齊**）
//
// 權威呈現、RSVP 選項、只列要來與也許、過去的退到背景、取消要二次確認——三層一致
// （core／engine／UI）的 UI 那一層在兩端必須是同一套規則，否則「桌面改不動、手機改得動」
// 這種話就有人會信。
//
// ## 與桌面不同的部分：時間輸入
//
// 桌面用 `<input type="datetime-local">`。**行動端沒有這個東西**——`react-native-web` 的
// `TextInput` 型別（本 repo 的 ambient 宣告，為日後上真 RN 而刻意收斂）不吃 `type`，
// 而真 RN 更沒有。硬要使用者在手機上打 `2026-08-01T09:00` 是最糟的選擇。
//
// 故改為**相對調整**：顯示一個人看得懂的時間，用 ↑↓ 鈕以「天／時／分」為級距調整，
// 長度用 chip 選（不設／1 小時／2 小時／整天）。這在拇指操作下比任何文字輸入都快，
// 而且**最常見的路徑根本不用調**——從對話中點日期進來時開始時間已經是對的。

import type { CalendarEventInput, RsvpStatus, StoredCalendarEvent } from "@cinderous/engine";
import { type Locale, type MessageKey, translate } from "@cinderous/i18n";
import type { ThemeTokens } from "@cinderous/theme";
import { useState, type JSX } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native-web";

export interface CalendarPanelProps {
  /** 本對話的行程（呼叫端已依對話篩選）。 */
  events: StoredCalendarEvent[];
  selfPubkey: string;
  /** 建立或修改；`eventId` 有值＝修改。 */
  onPublish: (input: CalendarEventInput, opts?: { eventId?: string }) => void;
  /** 取消行程（僅主揪）。**破壞性，本元件負責二次確認**——呼叫端不必再問一次。 */
  onCancel: (eventId: string) => void;
  onRsvp: (eventId: string, status: RsvpStatus) => void;
  /** pubkey → 顯示名（列出誰要來）。 */
  nameFor: (pubkey: string) => string;
  /**
   * 由對話中的日期標記帶進來的預填（ADR-0260 階段四）：`nonce` 變動即開啟新建表單並帶入時間。
   * **一律由使用者點擊觸發**——本元件不會自己冒出表單（ADR-0259 §1.6 否決自動導覽）。
   */
  draft?: { at: number; nonce: number } | undefined;
  tk: ThemeTokens;
  locale?: Locale;
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

/** 時間調整級距：與長度 chip 一起構成完整的時間輸入（見檔頭）。 */
const STEPS: { key: string; label: string; delta: number }[] = [
  { key: "day", label: "天", delta: DAY },
  { key: "hour", label: "時", delta: HOUR },
  { key: "min", label: "分", delta: 15 * MIN },
];

const DURATIONS: { key: MessageKey; secs: number | undefined }[] = [
  { key: "cal_durNone", secs: undefined },
  { key: "cal_dur1h", secs: HOUR },
  { key: "cal_dur2h", secs: 2 * HOUR },
  { key: "cal_durAllDay", secs: 12 * HOUR },
];

const RSVP_CHOICES: { status: RsvpStatus; key: MessageKey }[] = [
  { status: "accepted", key: "cal_rsvpYes" },
  { status: "tentative", key: "cal_rsvpMaybe" },
  { status: "declined", key: "cal_rsvpNo" },
];

/** 行程時間的人類可讀顯示（本機時區）——與桌面同一套格式。 */
function formatRange(start: number, end: number | undefined, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  const s = new Date(start * 1000).toLocaleString(locale, opts);
  if (end === undefined) return s;
  const sameDay = new Date(start * 1000).toDateString() === new Date(end * 1000).toDateString();
  const e = new Date(end * 1000).toLocaleString(locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : opts);
  return `${s} – ${e}`;
}

function makeStyles(tk: ThemeTokens) {
  return StyleSheet.create({
    wrap: { gap: 8 },
    newBtn: {
      backgroundColor: tk.surface2,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 10,
      paddingVertical: 9,
      alignItems: "center",
    },
    newText: { color: tk.accent, fontSize: 14, fontWeight: "700" },
    form: { gap: 8, backgroundColor: tk.surface2, borderRadius: 10, padding: 10 },
    input: {
      backgroundColor: tk.field,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: tk.ink,
      fontSize: 14,
    },
    desc: { minHeight: 56 },
    whenBox: { backgroundColor: tk.field, borderWidth: 1, borderColor: tk.border, borderRadius: 8, padding: 8, gap: 6 },
    whenText: { color: tk.ink, fontSize: 15, fontWeight: "700", textAlign: "center" },
    steps: { flexDirection: "row", justifyContent: "center", gap: 6 },
    step: { alignItems: "center", gap: 2 },
    stepBtn: {
      backgroundColor: tk.surface2,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 6,
      paddingHorizontal: 12,
      paddingVertical: 3,
    },
    stepBtnText: { color: tk.accent, fontSize: 13, fontWeight: "700" },
    stepLabel: { color: tk.muted, fontSize: 11 },
    hint: { color: tk.muted, fontSize: 11, textAlign: "center" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
    chipsLabel: { color: tk.muted, fontSize: 12 },
    chip: {
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: tk.field,
    },
    chipOn: { borderColor: tk.accent, backgroundColor: tk.surface2 },
    chipText: { color: tk.muted, fontSize: 12 },
    chipTextOn: { color: tk.accent, fontWeight: "700" },
    formBtns: { flexDirection: "row", gap: 8 },
    save: { flex: 1, backgroundColor: tk.accent, borderRadius: 8, paddingVertical: 9, alignItems: "center" },
    saveOff: { opacity: 0.45 },
    saveText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
    ghost: {
      flex: 1,
      borderWidth: 1,
      borderColor: tk.border,
      borderRadius: 8,
      paddingVertical: 9,
      alignItems: "center",
    },
    ghostText: { color: tk.muted, fontSize: 14 },
    empty: { color: tk.muted, fontSize: 13, paddingVertical: 10, textAlign: "center" },
    item: {
      backgroundColor: tk.surface2,
      borderRadius: 10,
      padding: 10,
      gap: 3,
      borderLeftWidth: 3,
      borderLeftColor: tk.accent,
    },
    itemPast: { opacity: 0.5, borderLeftColor: tk.border },
    when: { color: tk.accent, fontSize: 12, fontWeight: "700" },
    name: { color: tk.ink, fontSize: 15, fontWeight: "700" },
    meta: { color: tk.muted, fontSize: 12 },
    going: { color: tk.ink, fontSize: 12 },
    acts: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
    act: { borderWidth: 1, borderColor: tk.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
    actText: { color: tk.muted, fontSize: 12 },
    danger: { borderColor: "#e5484d" },
    dangerText: { color: "#e5484d", fontSize: 12 },
    rsvpOn: { borderColor: tk.accent, backgroundColor: tk.field },
    rsvpOnText: { color: tk.accent, fontSize: 12, fontWeight: "700" },
  });
}

/** 建立/編輯表單。`initial` 有值＝編輯既有行程。 */
function EventForm({
  initial,
  startAt,
  onSubmit,
  onDismiss,
  styles,
  tk,
  t,
  locale,
}: {
  initial?: StoredCalendarEvent | undefined;
  /** 新建時的預設開始時間（unix 秒）；來自對話中被點擊的日期。 */
  startAt?: number | undefined;
  onSubmit: (input: CalendarEventInput) => void;
  onDismiss: () => void;
  styles: ReturnType<typeof makeStyles>;
  tk: ThemeTokens;
  t: (k: MessageKey, p?: Record<string, string | number>) => string;
  locale: Locale;
}): JSX.Element {
  const [title, setTitle] = useState(initial?.title ?? "");
  // 預設開始時間＝下一個整點，省去使用者每次都要調（新建時才用）。
  const [start, setStart] = useState(initial?.start ?? startAt ?? Math.ceil(Date.now() / 1000 / HOUR) * HOUR);
  // 長度而非絕對結束時間：改開始時間時結束會跟著走，不會留下「結束早於開始」的壞狀態。
  const [dur, setDur] = useState<number | undefined>(
    initial?.end !== undefined ? initial.end - initial.start : undefined,
  );
  const [location, setLocation] = useState(initial?.location ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  const valid = title.trim().length > 0;

  return (
    <View style={styles.form} testID="cal-form">
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder={t("cal_title")}
        placeholderTextColor={tk.muted}
        aria-label={t("cal_title")}
        testID="cal-title"
      />

      <View style={styles.whenBox}>
        <Text style={styles.whenText} testID="cal-when">
          {formatRange(start, dur === undefined ? undefined : start + dur, locale)}
        </Text>
        <View style={styles.steps}>
          {STEPS.map((s) => (
            <View key={s.key} style={styles.step}>
              <Pressable
                style={styles.stepBtn}
                accessibilityRole="button"
                aria-label={`+1 ${s.label}`}
                testID={`cal-plus-${s.key}`}
                onPress={() => setStart((v) => v + s.delta)}
              >
                <Text style={styles.stepBtnText}>▲</Text>
              </Pressable>
              <Text style={styles.stepLabel}>{s.label}</Text>
              <Pressable
                style={styles.stepBtn}
                accessibilityRole="button"
                aria-label={`-1 ${s.label}`}
                testID={`cal-minus-${s.key}`}
                onPress={() => setStart((v) => v - s.delta)}
              >
                <Text style={styles.stepBtnText}>▼</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <Text style={styles.hint}>{t("cal_adjHint")}</Text>
      </View>

      <View style={styles.chips}>
        <Text style={styles.chipsLabel}>{t("cal_durLabel")}</Text>
        {DURATIONS.map((d) => {
          const on = dur === d.secs;
          return (
            <Pressable
              key={d.key}
              style={[styles.chip, on ? styles.chipOn : null]}
              accessibilityRole="button"
              aria-label={t(d.key)}
              testID={`cal-dur-${d.key}`}
              onPress={() => setDur(d.secs)}
            >
              <Text style={on ? styles.chipTextOn : styles.chipText}>{t(d.key)}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        style={styles.input}
        value={location}
        onChangeText={setLocation}
        placeholder={t("cal_location")}
        placeholderTextColor={tk.muted}
        aria-label={t("cal_location")}
        testID="cal-location"
      />
      <TextInput
        style={[styles.input, styles.desc]}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder={t("cal_desc")}
        placeholderTextColor={tk.muted}
        aria-label={t("cal_desc")}
        testID="cal-desc"
      />

      <View style={styles.formBtns}>
        <Pressable
          style={[styles.save, valid ? null : styles.saveOff]}
          accessibilityRole="button"
          disabled={!valid}
          testID="cal-save"
          onPress={() => {
            if (!valid) return;
            onSubmit({
              title: title.trim(),
              start,
              ...(dur !== undefined ? { end: start + dur } : {}),
              ...(location.trim() ? { location: location.trim() } : {}),
              ...(description.trim() ? { description: description.trim() } : {}),
            });
          }}
        >
          <Text style={styles.saveText}>{t("cal_save")}</Text>
        </Pressable>
        <Pressable style={styles.ghost} accessibilityRole="button" testID="cal-dismiss" onPress={onDismiss}>
          <Text style={styles.ghostText}>{t("cal_dismiss")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function CalendarPanel(props: CalendarPanelProps): JSX.Element {
  const locale = props.locale ?? "zh-Hant";
  const t = (k: MessageKey, p?: Record<string, string | number>): string => translate(locale, k, p);
  const styles = makeStyles(props.tk);
  /** `null`＝沒在編輯；`""`＝新建；其餘＝正在編輯該 id。 */
  const [editing, setEditing] = useState<string | null>(props.draft ? "" : null);
  /**
   * 取消的二次確認（ADR-0234 的行動端模式）：手機沒有 hover，也沒有桌面的對話框元件——
   * 沿用「再按一次才真的執行」的既有行動端做法，破壞性動作絕不一按就發生。
   */
  const [cancelAsk, setCancelAsk] = useState<string | null>(null);
  const nowSec = Math.floor(Date.now() / 1000);

  // 對話中的日期被點擊 → 開新建表單並帶入時間。**在 render 期間調整 state**（同桌面）而非
  // `useEffect`：少一次 paint，且 SSR 走得到——effect 在 `renderToStaticMarkup` 下不執行，
  // 用 effect 就等於這段行為沒有測試覆蓋。
  const draftNonce = props.draft?.nonce;
  const [seenNonce, setSeenNonce] = useState(draftNonce);
  if (draftNonce !== seenNonce) {
    setSeenNonce(draftNonce);
    if (draftNonce !== undefined) setEditing("");
  }

  const sorted = [...props.events].sort((a, b) => a.start - b.start);

  return (
    <View style={styles.wrap} testID="aux-calendar">
      {editing === null ? (
        <Pressable style={styles.newBtn} accessibilityRole="button" testID="cal-new" onPress={() => setEditing("")}>
          <Text style={styles.newText}>＋ {t("cal_new")}</Text>
        </Pressable>
      ) : (
        <EventForm
          key={editing || `new-${draftNonce ?? 0}`}
          {...(editing ? { initial: sorted.find((e) => e.id === editing) } : {})}
          {...(!editing && props.draft ? { startAt: props.draft.at } : {})}
          styles={styles}
          tk={props.tk}
          t={t}
          locale={locale}
          onDismiss={() => setEditing(null)}
          onSubmit={(input) => {
            props.onPublish(input, editing ? { eventId: editing } : undefined);
            setEditing(null);
          }}
        />
      )}

      {sorted.length === 0 ? (
        <Text style={styles.empty}>{t("cal_none")}</Text>
      ) : (
        <ScrollView contentContainerStyle={{ gap: 8 }}>
          {sorted.map((e) => {
            const mine = e.organizer === props.selfPubkey;
            const past = (e.end ?? e.start) < nowSec;
            const myRsvp = e.rsvps?.[props.selfPubkey]?.status;
            // 只列「要來」與「也許」——不列缺席者（那是噪音，且會把「明說不來」與「還沒回覆」
            // 混在一起看）。
            const going = Object.entries(e.rsvps ?? {}).filter(([, r]) => r.status !== "declined");
            return (
              // 過去的行程另給 testID：RN-web 把 opacity 編成雜湊 class 名，斷言不到樣式本身。
              <View
                key={e.id}
                style={[styles.item, past ? styles.itemPast : null]}
                testID={past ? "cal-item-past" : "cal-item"}
              >
                <Text style={styles.when}>{formatRange(e.start, e.end, locale)}</Text>
                <Text style={styles.name}>{e.title}</Text>
                {e.location ? <Text style={styles.meta}>📍 {e.location}</Text> : null}
                {e.description ? <Text style={styles.meta}>{e.description}</Text> : null}
                <Text style={styles.meta}>
                  {mine ? t("cal_byYou") : t("cal_by", { name: props.nameFor(e.organizer) })}
                </Text>

                {going.length > 0 ? (
                  <Text style={styles.going} testID="cal-going">
                    {going.map(([pk, r]) => `${props.nameFor(pk)}${r.status === "tentative" ? "?" : ""}`).join("、")}
                  </Text>
                ) : null}

                {/* 主揪權威（ADR-0259 §1.7）：非主揪連按鈕都不出現，不是按了才被拒。 */}
                {mine ? (
                  <View style={styles.acts}>
                    <Pressable
                      style={styles.act}
                      accessibilityRole="button"
                      testID="cal-edit"
                      onPress={() => setEditing(e.id)}
                    >
                      <Text style={styles.actText}>{t("cal_edit")}</Text>
                    </Pressable>
                    {cancelAsk === e.id ? (
                      <>
                        <Pressable
                          style={[styles.act, styles.danger]}
                          accessibilityRole="button"
                          aria-label={t("cal_cancelConfirm", { title: e.title })}
                          testID="cal-cancel-confirm"
                          onPress={() => {
                            setCancelAsk(null);
                            props.onCancel(e.id);
                          }}
                        >
                          <Text style={styles.dangerText}>{t("cal_cancelConfirm", { title: e.title })}</Text>
                        </Pressable>
                        <Pressable
                          style={styles.act}
                          accessibilityRole="button"
                          testID="cal-cancel-abort"
                          onPress={() => setCancelAsk(null)}
                        >
                          <Text style={styles.actText}>{t("cal_dismiss")}</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        style={[styles.act, styles.danger]}
                        accessibilityRole="button"
                        testID="cal-cancel"
                        onPress={() => setCancelAsk(e.id)}
                      >
                        <Text style={styles.dangerText}>{t("cal_cancelEvent")}</Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <View style={styles.acts}>
                    {RSVP_CHOICES.map((c) => {
                      const on = myRsvp === c.status;
                      return (
                        <Pressable
                          key={c.status}
                          style={[styles.act, on ? styles.rsvpOn : null]}
                          accessibilityRole="button"
                          aria-label={t(c.key)}
                          testID={`cal-rsvp-${c.status}`}
                          onPress={() => props.onRsvp(e.id, c.status)}
                        >
                          <Text style={on ? styles.rsvpOnText : styles.actText}>{t(c.key)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
