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

/** 將訊息文字渲染為支援行內 Markdown（粗體/斜體/刪除線/行內碼/連結）的節點。 */
export function renderMarkdown(text: string): ReactNode {
  return text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {parseInline(line, String(i))}
    </Fragment>
  ));
}
