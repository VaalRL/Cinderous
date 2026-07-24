import { CinderMascot } from "@cinderous/brand";
import type { Copy } from "../copy.js";
import { BASE_PATH } from "../routes.js";

// 404 頁（ADR-0247）：GitHub Pages 對未匹配路徑服務 dist/404.html。自足靜態頁（預渲染時剝掉 app JS，
// 不 hydrate → 不會被 SPA 的 unknown→home 覆蓋）。熄滅營火意象＋大隻吉祥物＋回首頁連結。
export function NotFound({ c }: { c: Copy }): JSX.Element {
  return (
    <section className="sec sec--plain nf" style={{ paddingTop: 72 }} data-testid="notfound">
      <div className="wrap nf__inner">
        <CinderMascot size={132} />
        <p className="nf__code" aria-hidden="true">
          404
        </p>
        <h1 className="nf__title">{c.nf_title}</h1>
        <p className="sec__lead nf__lead">{c.nf_lead}</p>
        <a className="btn btn--primary" href={BASE_PATH}>
          {c.nf_home} →
        </a>
      </div>
    </section>
  );
}
