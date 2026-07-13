// 對話用算式計算（ADR-0097）：把一段文字判定為算式並求值。純函式、零網路、零 AI——
// 只在**本機草稿/輸入**階段運作，明文不外流（與 ADR-0060 的 AI 改寫性質完全不同）。
//
// 安全紅線：**絕不使用 `eval` / `new Function`**。這是加密通訊 App，把使用者輸入丟進 JS 執行器
// 等於開一個任意程式碼執行面。這裡用自己的 tokenizer + 遞迴下降 parser，只吃白名單文法，
// 並對長度與括號深度設硬上限（防爆堆疊/病態輸入）。

/** 輸入長度上限（超過即不視為算式；防病態輸入）。 */
const MAX_LEN = 64;
/** 括號巢狀深度上限（防遞迴下降爆堆疊）。 */
const MAX_DEPTH = 32;

/** 全形 → 半形（繁中輸入法常打出全形運算子與數字）。 */
function normalize(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    // 全形數字 ０-９ → 0-9
    if (code >= 0xff10 && code <= 0xff19) {
      out += String.fromCharCode(code - 0xff10 + 0x30);
      continue;
    }
    switch (ch) {
      case "＋": out += "+"; break;
      case "－": // 全形減號
      case "−": // U+2212 MINUS SIGN
        out += "-";
        break;
      case "×": case "＊": out += "*"; break;
      case "÷": case "／": out += "/"; break;
      case "（": out += "("; break;
      case "）": out += ")"; break;
      case "．": out += "."; break;
      case "％": out += "%"; break;
      case "＾": out += "^"; break;
      case " ": case "\t": break; // 空白忽略
      default: out += ch;
    }
  }
  return out;
}

type Token = { t: "num"; v: number } | { t: "op"; v: string };

/** 斷詞；遇到白名單以外的字元回 null（＝不是算式）。 */
function tokenize(s: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch >= "0" && ch <= "9") {
      let j = i;
      let dots = 0;
      while (j < s.length && ((s[j]! >= "0" && s[j]! <= "9") || s[j] === ".")) {
        if (s[j] === ".") dots += 1;
        j += 1;
      }
      if (dots > 1) return null; // 1.2.3 這種不是數字（版號）
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) return null;
      tokens.push({ t: "num", v });
      i = j;
      continue;
    }
    if (ch === ".") {
      // .5 這種開頭小數
      let j = i + 1;
      while (j < s.length && s[j]! >= "0" && s[j]! <= "9") j += 1;
      if (j === i + 1) return null;
      tokens.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    if ("+-*/%^()".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i += 1;
      continue;
    }
    return null; // 白名單以外 → 不是算式
  }
  return tokens;
}

/**
 * 遞迴下降求值。文法（優先序由低到高）：
 *   expr   := term (('+'|'-') term)*
 *   term   := unary (('*'|'/'|'%') unary)*
 *   unary  := ('+'|'-') unary | power
 *   power  := primary ('^' unary)?        // 右結合
 *   primary:= number | '(' expr ')'
 */
class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token | undefined {
    return this.toks[this.i];
  }
  private eatOp(v: string): boolean {
    const tk = this.peek();
    if (tk && tk.t === "op" && tk.v === v) {
      this.i += 1;
      return true;
    }
    return false;
  }

  parse(): number | null {
    const v = this.expr(0);
    if (v === null || this.i !== this.toks.length) return null; // 有殘留 token＝語法不完整
    return v;
  }

  private expr(depth: number): number | null {
    if (depth > MAX_DEPTH) return null;
    let left = this.term(depth);
    if (left === null) return null;
    for (;;) {
      if (this.eatOp("+")) {
        const r = this.term(depth);
        if (r === null) return null;
        left += r;
      } else if (this.eatOp("-")) {
        const r = this.term(depth);
        if (r === null) return null;
        left -= r;
      } else {
        return left;
      }
    }
  }

  private term(depth: number): number | null {
    let left = this.unary(depth);
    if (left === null) return null;
    for (;;) {
      if (this.eatOp("*")) {
        const r = this.unary(depth);
        if (r === null) return null;
        left *= r;
      } else if (this.eatOp("/")) {
        const r = this.unary(depth);
        if (r === null) return null;
        left /= r; // 除以零 → Infinity，最後由 finite 檢查擋掉
      } else if (this.eatOp("%")) {
        const r = this.unary(depth);
        if (r === null) return null;
        left %= r;
      } else {
        return left;
      }
    }
  }

  private unary(depth: number): number | null {
    if (this.eatOp("-")) {
      const v = this.unary(depth);
      return v === null ? null : -v;
    }
    if (this.eatOp("+")) return this.unary(depth);
    return this.power(depth);
  }

  private power(depth: number): number | null {
    const base = this.primary(depth);
    if (base === null) return null;
    if (this.eatOp("^")) {
      const exp = this.unary(depth); // 右結合：2^3^2 = 2^(3^2)
      if (exp === null) return null;
      return base ** exp;
    }
    return base;
  }

  private primary(depth: number): number | null {
    if (depth > MAX_DEPTH) return null;
    const tk = this.peek();
    if (!tk) return null;
    if (tk.t === "num") {
      this.i += 1;
      return tk.v;
    }
    if (tk.t === "op" && tk.v === "(") {
      this.i += 1;
      const v = this.expr(depth + 1);
      if (v === null || !this.eatOp(")")) return null;
      return v;
    }
    return null;
  }
}

/**
 * 看起來像日期/電話 → 不當算式（避免誤判擾民）。
 *
 * 只擋**明確**的樣式：三段、同一分隔符（`/` 或 `-`），且「有補零段」或「首段是年份」。
 * 這樣 `2024/01/02`、`2024/1/2`、`02-1234-5678` 會被擋，但 `10-2-3`、`100/4/5` 這種
 * 正常的連續加減/除法**仍可計算**（過度攔截會把真正的算式也殺掉）。
 * 版號 `1.2.3` 不需在此處理——斷詞階段就會因「一個數字裡兩個小數點」而拒絕。
 */
function looksLikeDateOrPhone(s: string): boolean {
  const m = /^(\d+)([/-])(\d+)\2(\d+)$/.exec(s);
  if (!m) return false;
  const segs = [m[1]!, m[3]!, m[4]!];
  const zeroPadded = segs.some((x) => x.length >= 2 && x.startsWith("0"));
  const yearish = segs[0]!.length === 4 && Number(segs[0]) >= 1900 && Number(segs[0]) <= 2099;
  return zeroPadded || yearish;
}

/** 格式化結果：抹掉浮點毛邊（0.1+0.2 → 0.3），去除尾隨零。 */
function format(n: number): string {
  const rounded = Number(n.toPrecision(12));
  return String(rounded);
}

/** 求值結果（供 UI 顯示與插入）。 */
export interface CalcResult {
  /** 正規化後的算式（全形已轉半形、空白已去除）。 */
  expr: string;
  /** 格式化後的結果字串。 */
  result: string;
  /** 數值結果。 */
  value: number;
}

/**
 * 把一段輸入判定為算式並求值；**不是算式就回 null**（UI 據此決定顯不顯示預覽）。
 *
 * 觸發條件刻意保守（誤判擾民比漏判更糟）：
 *  - 整串（trim 後）必須完全符合文法——**不抓子字串**（「我 1+1 對嗎」不會觸發）
 *  - 至少一個運算子（純數字「42」不觸發）
 *  - 結果必須是有限數（除以零不顯示）
 *  - 排除日期/版號/電話樣式（`2024/01/02`、`1.2.3`、`02-1234-5678`）
 */
export function calcPreview(input: string): CalcResult | null {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > MAX_LEN) return null;

  const expr = normalize(raw);
  if (expr.length === 0) return null;
  if (looksLikeDateOrPhone(expr)) return null;

  const toks = tokenize(expr);
  if (!toks) return null;
  // 需至少一個「運算子」（括號不算）——否則純數字也會被當算式。
  if (!toks.some((t) => t.t === "op" && "+-*/%^".includes(t.v))) return null;

  const value = new Parser(toks).parse();
  if (value === null || !Number.isFinite(value)) return null;

  return { expr, result: format(value), value };
}
