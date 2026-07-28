// 對話中的日期偵測（ADR-0263 §1.6／ADR-0264 階段四）：把訊息或草稿裡的「下週三 3 點」
// 認出來，讓 UI 能**提示**（氣泡內可點標記／composer 建議列），由使用者決定要不要開行程。
//
// ## 這個模組刻意不做的事
//
// **不自動導覽、不代替使用者行動**（ADR-0263 §1.6 已定）。它只回傳「哪一段文字看起來是什麼
// 時間」，其餘由 UI 決定。與 `calc.ts`（算式偵測）、`sticker-triggers.ts`（尾端比對）同一
// 家族：純函式、可測、零副作用。
//
// **絕不外送**：偵測在本機對**已解密的明文**進行，結果不進任何事件、不寫入 rumor、
// 不同步到其他裝置。
//
// ## 偽陽性才是常態
//
// 中文的日期樣式大量出現在「不是在約時間」的語境：「我**昨天**看到」「**三月**的時候」
// 「等一下」。ADR-0037 為文字觸發貼圖立過的規則（長度 ≥2、中文無空白分隔不能以詞切）在這裡
// **更需要**，因為誤判會讓使用者看到一個沒意義的標記。故本模組的取捨一律偏向**少報**：
//
// - **過去的日期不報**（「我昨天看到」——約時間不會約在昨天）；
// - 純數字要有明確分隔（`3/15`、`3-15`）才算，裸的「315」不算；
// - 相對詞要完整（「下週三」算，單獨的「下」不算）。

/** 偵測到的一段時間。 */
export interface DetectedDate {
  /** 原文中的起訖（`text.slice(start, end)` 即命中片段）。 */
  start: number;
  end: number;
  /** 命中的原文。 */
  text: string;
  /** 解析出的時間（unix 秒，本機時區）。 */
  at: number;
  /** 是否解析到明確時刻（否＝只有日期，UI 可預設一個時間）。 */
  hasTime: boolean;
}

const DAY = 86_400_000;

/** 當天 00:00（本機時區）。 */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * 中文數字轉阿拉伯數字（一～十二，供「三月」「十一點」用）。非中文數字回 NaN。
 * 只做到 12，因為月份與 12 小時制就是這個範圍——做更大只會擴大誤判面。
 */
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
  七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
};

function cnNum(s: string): number {
  return CN_NUM[s] ?? Number.NaN;
}

/** 週幾（0=日）；`日`／`天` 皆為週日。 */
const CN_WEEKDAY: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
};

/** 把「時、分」套進某一天；`hour` 為 24 小時制。 */
function withTime(day: Date, hour: number, minute: number): Date {
  const x = new Date(day);
  x.setHours(hour, minute, 0, 0);
  return x;
}

/** 解析可選的時刻後綴（「下午3點」「15:30」「晚上七點半」）。回傳消耗的長度與時分。 */
function parseTimeSuffix(text: string, from: number): { len: number; hour: number; minute: number } | undefined {
  const rest = text.slice(from);
  // `15:30` / `3:05`
  const colon = /^\s*([0-9]{1,2}):([0-9]{2})/.exec(rest);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    if (h <= 23 && m <= 59) return { len: colon[0].length, hour: h, minute: m };
  }
  // 「早上/上午/中午/下午/晚上」＋「N 點」＋可選「半」；N 可為中文數字
  const cn = /^\s*(早上|上午|中午|下午|晚上|傍晚)?\s*([0-9]{1,2}|十[一二]?|[一二兩三四五六七八九])\s*點(半)?/.exec(rest);
  if (cn) {
    const perRaw = cn[1];
    const numRaw = cn[2]!;
    let h = /^[0-9]+$/.test(numRaw) ? Number(numRaw) : cnNum(numRaw);
    if (!Number.isFinite(h) || h > 24) return undefined;
    // 12 小時制轉換：下午/晚上/傍晚 → +12（12 點本身不加）；中午 12 點；早上/上午維持。
    if ((perRaw === "下午" || perRaw === "晚上" || perRaw === "傍晚") && h < 12) h += 12;
    if (perRaw === "中午" && h === 12) h = 12;
    if (h === 24) h = 0;
    return { len: cn[0].length, hour: h, minute: cn[3] ? 30 : 0 };
  }
  // 英文 `3pm` / `10:30am`（`10:30` 已由 colon 分支處理，這裡處理裸的 `3pm`）
  const en = /^\s*([0-9]{1,2})\s*(am|pm)/i.exec(rest);
  if (en) {
    let h = Number(en[1]);
    if (h > 12) return undefined;
    const pm = en[2]!.toLowerCase() === "pm";
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    return { len: en[0].length, hour: h, minute: 0 };
  }
  return undefined;
}

/** 一個候選匹配器：從 `text` 的 `m` 位置嘗試解析出日期，回傳命中長度與日期（尚未套時刻）。 */
type DayMatcher = (text: string, now: Date) => { index: number; len: number; day: Date }[];

/** 相對日：今天/明天/後天/大後天/昨天…（過去的一律不報，見檔頭）。 */
const relativeDay: DayMatcher = (text, now) => {
  const table: [RegExp, number][] = [
    [/大後天/g, 3],
    [/後天/g, 2],
    [/明天|明日/g, 1],
    [/今天|今日/g, 0],
    [/tomorrow/gi, 1],
    [/today/gi, 0],
  ];
  const out: { index: number; len: number; day: Date }[] = [];
  for (const [re, offset] of table) {
    for (const m of text.matchAll(re)) {
      out.push({ index: m.index, len: m[0].length, day: new Date(startOfDay(now).getTime() + offset * DAY) });
    }
  }
  return out;
};

/**
 * 週幾：「這週三」「下週三」「週五」「禮拜天」「next Friday」。
 *
 * 無前綴的「週三」＝**下一個**週三（含今天則取今天）——這是口語的意思，
 * 「週三見」不會是指上週三。
 */
const weekday: DayMatcher = (text, now) => {
  const out: { index: number; len: number; day: Date }[] = [];
  // 「上」「上上」必須列進前綴：少了它們，`上週三` 會從第 2 個字開始比對成「週三」＝
  // 把過去的事報成未來的約定。過去一律不報（見檔頭），故比對到就跳過。
  const re = /(這|本|下|下下|上|上上)?(?:週|周|星期|禮拜)([日天一二三四五六])/g;
  for (const m of text.matchAll(re)) {
    const target = CN_WEEKDAY[m[2]!];
    if (target === undefined) continue;
    const prefix = m[1];
    if (prefix === "上" || prefix === "上上") continue; // 過去
    const today = startOfDay(now);
    let delta = (target - today.getDay() + 7) % 7;
    if (prefix === "下") delta += 7;
    else if (prefix === "下下") delta += 14;
    out.push({ index: m.index, len: m[0].length, day: new Date(today.getTime() + delta * DAY) });
  }
  // `last` 同理必須認得才擋得掉（否則從 `friday` 起算成未來）。
  const enRe = /(next\s+|last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/gi;
  const EN_DAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (const m of text.matchAll(enRe)) {
    if (m[1] && /last/i.test(m[1])) continue; // 過去
    const target = EN_DAY.indexOf(m[2]!.toLowerCase());
    const today = startOfDay(now);
    let delta = (target - today.getDay() + 7) % 7;
    if (m[1]) delta += 7;
    out.push({ index: m.index, len: m[0].length, day: new Date(today.getTime() + delta * DAY) });
  }
  return out;
};

/**
 * 明確日期：「3/15」「3-15」「3月15日」「12月1號」。
 *
 * **年份一律推導**：沒寫年就取「今年，若已過就明年」——約時間不會約在過去。
 * 裸數字（如 `315`）不算，必須有分隔符或「月/日」字樣。
 */
const explicitDate: DayMatcher = (text, now) => {
  const out: { index: number; len: number; day: Date }[] = [];
  const push = (index: number, len: number, month: number, date: number): void => {
    if (month < 1 || month > 12 || date < 1 || date > 31) return;
    const today = startOfDay(now);
    let year = today.getFullYear();
    let day = new Date(year, month - 1, date);
    if (day.getMonth() !== month - 1) return; // 2/30 這種不存在的日期
    if (day.getTime() < today.getTime()) {
      year += 1;
      day = new Date(year, month - 1, date);
    }
    out.push({ index, len, day });
  };
  for (const m of text.matchAll(/([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*[日號]?/g)) {
    push(m.index, m[0].length, Number(m[1]), Number(m[2]));
  }
  // `3/15`、`3-15`：前後不得緊鄰其他數字或斜線（擋掉 `1/2/3`、`2026/3/15` 的片段誤判）
  for (const m of text.matchAll(/(?<![0-9/\-])([0-9]{1,2})[/-]([0-9]{1,2})(?![0-9/\-])/g)) {
    push(m.index, m[0].length, Number(m[1]), Number(m[2]));
  }
  return out;
};

const MATCHERS: DayMatcher[] = [relativeDay, weekday, explicitDate];

/**
 * 偵測文字裡的日期。回傳依出現順序、**互不重疊**的結果（長的優先，故「下週三」不會被
 * 「週三」蓋掉）。過去的時間一律不報。
 *
 * `now` 可注入以利測試；預設為現在。
 */
export function detectDates(text: string, now: Date = new Date()): DetectedDate[] {
  if (!text) return [];
  const raw = MATCHERS.flatMap((m) => m(text, now));
  // 長的優先、同長度取先出現的 → 貪婪去重疊（「下週三」勝過其中的「週三」）
  raw.sort((a, b) => b.len - a.len || a.index - b.index);

  const taken: DetectedDate[] = [];
  const overlaps = (i: number, len: number): boolean =>
    taken.some((t) => i < t.end && i + len > t.start);

  for (const c of raw) {
    if (overlaps(c.index, c.len)) continue;
    const after = c.index + c.len;
    const time = parseTimeSuffix(text, after);
    const when = time ? withTime(c.day, time.hour, time.minute) : c.day;
    // 過去的不報：日期本身是今天但時刻已過（「今天 9 點」而現在 10 點）也不報。
    if (when.getTime() < now.getTime()) continue;
    const end = time ? after + time.len : after;
    taken.push({
      start: c.index,
      end,
      text: text.slice(c.index, end),
      at: Math.floor(when.getTime() / 1000),
      hasTime: time !== undefined,
    });
  }
  return taken.sort((a, b) => a.start - b.start);
}

/**
 * composer 用：**只看游標前的尾端**是否剛打完一個日期（同 ADR-0037 的尾端比對語意）。
 *
 * 為什麼不用整句偵測：使用者還在打字，句中早先的日期已經看過了；只有**剛打完的那個**
 * 才值得跳建議。回 undefined＝不跳。
 */
export function detectDateAtEnd(draft: string, now: Date = new Date()): DetectedDate | undefined {
  const hits = detectDates(draft, now);
  const last = hits.at(-1);
  return last && last.end === draft.length ? last : undefined;
}
