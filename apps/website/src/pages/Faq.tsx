import type { Copy } from "../copy.js";

/**
 * 常見問題頁（ADR-0235 SEO-4）。內容取自 `c.faqItems`——**同一份資料**也餵給 `seo.ts` 的
 * FAQPage JSON-LD，確保結構化資料與可見內容一字不差（Google 的政策要求兩者相符）。
 *
 * 問題用 `<h2>`（語意標題，爬蟲據以理解結構），答案是可見文字段落——不是 `<details>` 收合，
 * 因為預設收合的內容在部分擷取器眼中權重較低，而 GEO 的重點就是讓答案「被看見、被引用」。
 */
export function Faq({ c }: { c: Copy }): JSX.Element {
  return (
    <section className="sec sec--plain" style={{ paddingTop: 56 }}>
      <div className="wrap">
        <h1 style={{ fontSize: 34, marginBottom: 8 }}>{c.faq_title}</h1>
        <p className="sec__lead">{c.faq_intro}</p>

        <div className="faq" style={{ marginTop: 28 }}>
          {c.faqItems.map((item) => (
            <div className="faq__item card" key={item.q} style={{ marginTop: 16 }}>
              <div className="card__ember" />
              <h2 className="faq__q" style={{ fontSize: 19, marginBottom: 8 }}>
                {item.q}
              </h2>
              <p className="faq__a">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
