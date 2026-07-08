import { Fragment, type ReactNode } from "react";
import { useI18n } from "../i18n.js";
import { assessUrl, type UrlRisk, type UrlRiskReason } from "./url-hygiene.js";

interface Rule {
  name: "code" | "link" | "bold" | "strike" | "italic";
  re: RegExp;
}

// 順序即優先序：code 內容為字面值；bold 在 italic 之前以正確處理 **。
const RULES: Rule[] = [
  { name: "code", re: /`([^`]+)`/ },
  { name: "link", re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/ },
  { name: "bold", re: /\*\*(.+?)\*\*/ },
  { name: "strike", re: /~~(.+?)~~/ },
  { name: "italic", re: /\*(.+?)\*/ },
  { name: "italic", re: /_(.+?)_/ },
];

/** 高風險連結（ADR-0038）：⚠ 徽章 + 點擊確認（列出理由）後才開啟。 */
function RiskyLink({ href, risk, children }: { href: string; risk: UrlRisk; children: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const reasonText = (r: UrlRiskReason): string =>
    ({
      "text-mismatch": t("urlrisk_textMismatch"),
      userinfo: t("urlrisk_userinfo"),
      punycode: t("urlrisk_punycode"),
      "ip-host": t("urlrisk_ipHost"),
      "odd-port": t("urlrisk_oddPort"),
      http: t("urlrisk_http"),
      shortener: t("urlrisk_shortener"),
      unparsable: t("urlrisk_unparsable"),
    })[r];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`risklink risklink--${risk.level}`}
      data-testid="risk-link"
      onClick={(e) => {
        const msg = `${t("urlrisk_confirm", { url: href })}\n\n・${risk.reasons.map(reasonText).join("\n・")}`;
        if (!window.confirm(msg)) e.preventDefault();
      }}
    >
      <span className="risklink__badge" title={risk.reasons.map(reasonText).join("；")}>⚠</span>
      {children}
    </a>
  );
}

/** 將單行文字解析為帶有行內格式的 React 節點（信任邊界安全：不注入 HTML）。 */
function parseInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let counter = 0;

  while (rest.length > 0) {
    let best: { index: number; rule: Rule; match: RegExpExecArray } | null = null;
    for (const rule of RULES) {
      const match = rule.re.exec(rest);
      if (match && (best === null || match.index < best.index)) {
        best = { index: match.index, rule, match };
      }
    }
    if (!best) {
      nodes.push(rest);
      break;
    }

    if (best.index > 0) nodes.push(rest.slice(0, best.index));
    const inner = best.match[1] ?? "";
    const key = `${keyBase}-${counter++}`;

    switch (best.rule.name) {
      case "code":
        nodes.push(<code key={key}>{inner}</code>);
        break;
      case "link": {
        const href = best.match[2]!;
        // 高風險評估（ADR-0038）：連結顯示文字用於偵測「文字偽裝」。
        const risk = assessUrl(href, inner);
        nodes.push(
          risk.level === "ok" ? (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer">
              {parseInline(inner, key)}
            </a>
          ) : (
            <RiskyLink key={key} href={href} risk={risk}>
              {parseInline(inner, key)}
            </RiskyLink>
          ),
        );
        break;
      }
      case "bold":
        nodes.push(<strong key={key}>{parseInline(inner, key)}</strong>);
        break;
      case "strike":
        nodes.push(<s key={key}>{parseInline(inner, key)}</s>);
        break;
      case "italic":
        nodes.push(<em key={key}>{parseInline(inner, key)}</em>);
        break;
    }
    rest = rest.slice(best.index + best.match[0].length);
  }
  return nodes;
}

// ── 區塊級解析：圍欄程式碼（```）與巢狀清單（-/*/1.，tab 或每 2 空白 = 1 層）──

interface ListItem {
  text: string;
  depth: number;
  ordered: boolean;
}

type Block =
  | { type: "code"; content: string }
  | { type: "list"; items: ListItem[] }
  | { type: "quote"; lines: string[] }
  | { type: "para"; lines: string[] };

const LIST_RE = /^([ \t]*)([-*]|\d+\.)\s+(\S.*)$/;
/** Obsidian 風 callout 首行：`[!type] 標題`（`+`/`-` 摺疊記號接受但一律展開）。 */
const CALLOUT_RE = /^\[!([a-z]+)\][+-]?[ \t]*(.*)$/i;
/** 引言/callout 遞迴深度上限（防惡意深巢 `>>>…` 撐爆堆疊）。 */
const MAX_QUOTE_DEPTH = 3;

/** Callout 型別 → 圖示與色系；別名對應 Obsidian 慣例，未知型別退回 note。 */
const CALLOUT_SPECS: Record<string, { hue: string; icon: string }> = {
  note: { hue: "blue", icon: "📝" },
  abstract: { hue: "blue", icon: "📋" },
  summary: { hue: "blue", icon: "📋" },
  info: { hue: "blue", icon: "ℹ️" },
  todo: { hue: "blue", icon: "☑️" },
  tip: { hue: "green", icon: "💡" },
  hint: { hue: "green", icon: "💡" },
  important: { hue: "green", icon: "💡" },
  success: { hue: "green", icon: "✅" },
  check: { hue: "green", icon: "✅" },
  question: { hue: "amber", icon: "❓" },
  help: { hue: "amber", icon: "❓" },
  warning: { hue: "amber", icon: "⚠️" },
  caution: { hue: "amber", icon: "⚠️" },
  failure: { hue: "red", icon: "❌" },
  fail: { hue: "red", icon: "❌" },
  danger: { hue: "red", icon: "🔥" },
  error: { hue: "red", icon: "🔥" },
  bug: { hue: "red", icon: "🐛" },
  example: { hue: "purple", icon: "🧪" },
  quote: { hue: "grey", icon: "❝" },
  cite: { hue: "grey", icon: "❝" },
};

export function calloutSpec(type: string): { hue: string; icon: string } {
  return CALLOUT_SPECS[type.toLowerCase()] ?? CALLOUT_SPECS["note"]!;
}

/** 快速插入選單用的主要 callout 型別（ComposerInsert）。 */
export const CALLOUT_MENU = ["note", "info", "tip", "success", "question", "warning", "danger", "quote"] as const;

/** 縮排深度：1 個 tab 或每 2 個空白 = 1 層（上限 5，防惡意深巢）。 */
function indentDepth(ws: string): number {
  let depth = 0;
  let spaces = 0;
  for (const ch of ws) {
    if (ch === "\t") {
      depth += 1;
      spaces = 0;
    } else if (++spaces === 2) {
      depth += 1;
      spaces = 0;
    }
  }
  return Math.min(depth, 5);
}

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let para: string[] | null = null;
  const flushPara = (): void => {
    if (para) {
      blocks.push({ type: "para", lines: para });
      para = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      flushPara();
      const content: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        content.push(lines[i]!);
        i++;
      }
      blocks.push({ type: "code", content: content.join("\n") }); // 未閉合則取至結尾
      continue;
    }
    if (line.startsWith(">")) {
      flushPara();
      const body: string[] = [line.replace(/^>\s?/, "")];
      while (i + 1 < lines.length && lines[i + 1]!.startsWith(">")) {
        i++;
        body.push(lines[i]!.replace(/^>\s?/, ""));
      }
      blocks.push({ type: "quote", lines: body });
      continue;
    }
    const m = LIST_RE.exec(line);
    if (m) {
      flushPara();
      const item: ListItem = { text: m[3]!, depth: indentDepth(m[1]!), ordered: /\d/.test(m[2]!) };
      const last = blocks[blocks.length - 1];
      if (last?.type === "list") last.items.push(item);
      else blocks.push({ type: "list", items: [item] });
      continue;
    }
    if (para) para.push(line);
    else para = [line];
  }
  flushPara();
  return blocks;
}

/** 由攤平的清單項（含深度）遞迴組出巢狀 ul/ol；型別依該層第一項決定。 */
function buildList(items: ListItem[], pos: { i: number }, depth: number, keyBase: string): JSX.Element {
  const ordered = items[pos.i]!.ordered;
  const lis: ReactNode[][] = [];
  while (pos.i < items.length && items[pos.i]!.depth >= depth) {
    const it = items[pos.i]!;
    if (it.depth > depth) {
      const nested = buildList(items, pos, it.depth, `${keyBase}-${lis.length}n`);
      if (lis.length === 0) lis.push([]); // 首項就更深：容錯掛在空項下
      lis[lis.length - 1]!.push(nested);
    } else {
      pos.i += 1;
      lis.push([...parseInline(it.text, `${keyBase}-${lis.length}`)]);
    }
  }
  const children = lis.map((content, i) => <li key={i}>{content}</li>);
  return ordered ? (
    <ol className="md-list" key={keyBase}>{children}</ol>
  ) : (
    <ul className="md-list" key={keyBase}>{children}</ul>
  );
}

/** 多行文字以行內語法渲染（行間 <br>），不做區塊遞迴——供段落與超深引言退回使用。 */
function renderPlainLines(lines: string[], keyBase: string): ReactNode {
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {parseInline(line, `${keyBase}-${i}`)}
    </Fragment>
  ));
}

function renderBlocks(text: string, keyBase: string, depth: number): ReactNode[] {
  return parseBlocks(text).map((b, bi) => {
    const key = `${keyBase}${bi}`;
    if (b.type === "code") {
      return (
        <pre key={key} className="md-pre">
          <code>{b.content}</code>
        </pre>
      );
    }
    if (b.type === "list") {
      const pos = { i: 0 };
      const parts: ReactNode[] = [];
      while (pos.i < b.items.length) parts.push(buildList(b.items, pos, b.items[pos.i]!.depth, `${key}-${parts.length}`));
      return <Fragment key={key}>{parts}</Fragment>;
    }
    if (b.type === "quote") {
      const m = CALLOUT_RE.exec(b.lines[0] ?? "");
      if (m && depth < MAX_QUOTE_DEPTH) {
        // Obsidian 風 callout：圖示 + 標題（缺省為型別名）+ 遞迴渲染內文
        const type = m[1]!.toLowerCase();
        const spec = calloutSpec(type);
        const title = m[2]!.trim() || type.charAt(0).toUpperCase() + type.slice(1);
        const bodyText = b.lines.slice(1).join("\n");
        return (
          <div key={key} className={`md-callout md-callout--${spec.hue}`} data-testid="md-callout">
            <div className="md-callout__head">
              <span aria-hidden="true">{spec.icon}</span>
              <span>{parseInline(title, `${key}-t`)}</span>
            </div>
            {bodyText ? <div className="md-callout__body">{renderBlocks(bodyText, `${key}q`, depth + 1)}</div> : null}
          </div>
        );
      }
      return (
        <blockquote key={key} className="md-quote">
          {depth < MAX_QUOTE_DEPTH
            ? renderBlocks(b.lines.join("\n"), `${key}q`, depth + 1)
            : renderPlainLines(b.lines, key)}
        </blockquote>
      );
    }
    return <Fragment key={key}>{renderPlainLines(b.lines, key)}</Fragment>;
  });
}

/**
 * 將訊息文字渲染為 Markdown 節點（信任邊界安全：不注入 HTML）。
 * 行內：粗體/斜體/刪除線/行內碼/連結；區塊：``` 程式碼區塊（內容字面值）、
 * 「- 」「* 」「1. 」清單（可巢狀）、「>」引言與 Obsidian 風 callout（`> [!tip] 標題`）。
 */
export function renderMarkdown(text: string): ReactNode {
  return renderBlocks(text, "", 0);
}
