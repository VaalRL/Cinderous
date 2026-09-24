// 開發者文件（ADR-0368）：給要把應用接到 Cinderous 中繼車道的第三方開發者。
//
// 版面仿 Material for MkDocs 的文件站：左側分節導覽、中間內文、右側「本頁內容」目錄、
// 底部上一頁／下一頁。每一頁都是獨立的預渲染 URL（`/developers/<slug>/`），
// 爬蟲與不執行 JS 的讀者看得到完整內容。
//
// 中繼站拒絕連線時的 NOTICE 就指向這裡的總覽頁（`relay/src/host-config.ts` 的
// `DEVELOPER_DOCS_URL`），所以總覽頁的網址不能隨便改。

import type { Locale } from "@cinderous/i18n";
import type { MouseEvent, ReactNode } from "react";
import { GITHUB_URL } from "../App.js";
import { devDocsFor, type Block, type DevDocs } from "../devdocs/content.js";
import { DEV_DOC_SECTIONS, neighborsOf, type DevDocSlug } from "../devdocs/structure.js";
import { routeHref, VIEWS, type Route, type View } from "../routes.js";

type Navigate = (route: Route) => void;

function docRoute(locale: Locale, doc: DevDocSlug | undefined): Route {
  return doc === undefined ? { view: "developers", locale } : { view: "developers", locale, doc };
}

/** 內容裡的連結標記 → 真正的網址與（站內時）路由。 */
function resolveHref(href: string, locale: Locale): { url: string; route?: Route } {
  if (href.startsWith("doc:")) {
    const slug = href.slice(4);
    const route = docRoute(locale, slug === "" ? undefined : (slug as DevDocSlug));
    return { url: routeHref(route), route };
  }
  if (href.startsWith("view:")) {
    const view = href.slice(5);
    const route: Route = { view: (VIEWS as readonly string[]).includes(view) ? (view as View) : "home", locale };
    return { url: routeHref(route), route };
  }
  if (href === "repo:issues") return { url: `${GITHUB_URL}/issues` };
  if (href.startsWith("repo:")) return { url: `${GITHUB_URL}/blob/main/${href.slice(5)}` };
  return { url: href };
}

/** 站內連結：`<a href>` 給爬蟲與另開分頁，左鍵點擊則交給 SPA 導覽（同 `App.tsx` 的 NavLink）。 */
function InternalLink({
  route,
  onNavigate,
  className,
  children,
  testId,
}: {
  route: Route;
  onNavigate?: Navigate | undefined;
  className?: string | undefined;
  children: ReactNode;
  testId?: string | undefined;
}): JSX.Element {
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (!onNavigate || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(route);
  };
  return (
    <a className={className} href={routeHref(route)} onClick={onClick} data-testid={testId}>
      {children}
    </a>
  );
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|\[([^\]]+)\]\(([^)]+)\)/g;

/** 行內標記：`` `code` ``、`**粗體**`、`[文字](href)`。 */
function Inline({ text, locale, onNavigate }: { text: string; locale: Locale; onNavigate?: Navigate | undefined }): JSX.Element {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push(<code key={key++}>{m[1].slice(1, -1)}</code>);
    } else if (m[2] !== undefined) {
      out.push(
        <strong key={key++}>
          <Inline text={m[2].slice(2, -2)} locale={locale} onNavigate={onNavigate} />
        </strong>,
      );
    } else {
      const label = <Inline text={m[3] ?? ""} locale={locale} onNavigate={onNavigate} />;
      const { url, route } = resolveHref(m[4] ?? "", locale);
      out.push(
        route ? (
          <InternalLink key={key++} route={route} onNavigate={onNavigate}>
            {label}
          </InternalLink>
        ) : (
          <a key={key++} href={url} target="_blank" rel="noreferrer">
            {label}
          </a>
        ),
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function BlockView({ block, locale, onNavigate }: { block: Block; locale: Locale; onNavigate?: Navigate | undefined }): JSX.Element {
  const inline = (t: string): JSX.Element => <Inline text={t} locale={locale} onNavigate={onNavigate} />;
  if ("p" in block) return <p>{inline(block.p)}</p>;
  if ("note" in block) return <p className="docs__note">{inline(block.note)}</p>;
  if ("code" in block) {
    return (
      <pre className="code">
        <code>{block.code}</code>
      </pre>
    );
  }
  if ("list" in block) {
    return (
      <ul>
        {block.list.map((item) => (
          <li key={item}>{inline(item)}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="docs__table">
      <table className="cmp">
        <thead>
          <tr>
            {block.table.head.map((h, i) => (
              <th key={i}>{inline(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i}>{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function titleOf(docs: DevDocs, doc: DevDocSlug | undefined): string {
  return docs.pages[doc ?? "overview"].title;
}

export function Developers({
  locale,
  doc,
  onNavigate,
}: {
  locale: Locale;
  doc?: DevDocSlug | undefined;
  onNavigate?: Navigate | undefined;
}): JSX.Element {
  const docs = devDocsFor(locale);
  const page = docs.pages[doc ?? "overview"];
  const { prev, next } = neighborsOf(doc);

  return (
    <section className="docs" data-testid="developers">
      <div className="docs__wrap">
        <nav className="docs__nav" aria-label={docs.navTitle}>
          <p className="docs__navtitle">{docs.navTitle}</p>
          <ul>
            <li>
              <InternalLink
                route={docRoute(locale, undefined)}
                onNavigate={onNavigate}
                className={doc === undefined ? "on" : undefined}
              >
                {docs.overviewLabel}
              </InternalLink>
            </li>
          </ul>
          {DEV_DOC_SECTIONS.map((section) => (
            <div key={section.id}>
              <p className="docs__navsec">{docs.sectionTitles[section.id]}</p>
              <ul>
                {section.pages.map((slug) => (
                  <li key={slug}>
                    <InternalLink
                      route={docRoute(locale, slug)}
                      onNavigate={onNavigate}
                      className={slug === doc ? "on" : undefined}
                    >
                      {docs.pages[slug].title}
                    </InternalLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <article className="docs__main">
          <h1>{page.title}</h1>
          <p className="docs__lead">
            <Inline text={page.lead} locale={locale} onNavigate={onNavigate} />
          </p>
          {page.sections.map((section) => (
            <div key={section.id}>
              <h2 id={section.id}>
                <a className="docs__anchor" href={`#${section.id}`} aria-hidden="true">
                  #
                </a>
                {section.title}
              </h2>
              {section.blocks.map((block, i) => (
                <BlockView key={i} block={block} locale={locale} onNavigate={onNavigate} />
              ))}
            </div>
          ))}

          <div className="docs__pager">
            {prev !== null ? (
              <InternalLink route={docRoute(locale, prev)} onNavigate={onNavigate} className="docs__prev" testId="doc-prev">
                <span>{docs.prevLabel}</span>
                {titleOf(docs, prev)}
              </InternalLink>
            ) : (
              <span />
            )}
            {next !== null ? (
              <InternalLink route={docRoute(locale, next)} onNavigate={onNavigate} className="docs__next" testId="doc-next">
                <span>{docs.nextLabel}</span>
                {titleOf(docs, next)}
              </InternalLink>
            ) : null}
          </div>
        </article>

        <aside className="docs__toc" aria-label={docs.tocLabel}>
          <p className="docs__navtitle">{docs.tocLabel}</p>
          <ul>
            {page.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
