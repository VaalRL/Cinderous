import type { Theme } from "@cinderous/theme";
import type { Copy } from "../copy.js";
import { CinderMark } from "../Brand.js";
import { OFFICIAL_DONATIONS } from "../donations.js";
import { GITHUB_URL, WEBAPP_URL } from "../App.js";
import { AppleIcon, GitHubIcon, GlobeIcon, MobileIcon, WindowsIcon } from "../icons.js";

// 首頁（ADR-0187）：闡述核心價值觀與「取回通訊自主權」的願景。技術細節移至技術原理頁。
export function Home({
  c,
  theme,
  onNode,
  onTech,
}: {
  c: Copy;
  theme: Theme;
  onNode: () => void;
  onTech: () => void;
}): JSX.Element {
  const values = [
    { t: c.val_autonomy_t, b: c.val_autonomy_b },
    { t: c.val_privacy_t, b: c.val_privacy_b },
    { t: c.val_decentral_t, b: c.val_decentral_b },
    { t: c.val_free_t, b: c.val_free_b },
  ];
  return (
    <>
      <header className="hero">
        <div className="wrap">
          <div className="hero__mark">
            <CinderMark size={84} theme={theme} />
          </div>
          <p className="eyebrow">{c.hero_eyebrow}</p>
          <h1>{c.hero_title}</h1>
          <p className="hero__sub">{c.hero_subtitle}</p>
          {/* hero icon 按鈕列（ADR-0229）：下載分平台（Windows 可用、macOS／行動版即將推出）＋
              網頁版與 GitHub 入口。tooltip hover 顯示；手機（≤640px）改顯示可見標籤。 */}
          <div className="cta cta--icons">
            <a
              className="iconbtn iconbtn--primary"
              href={`${GITHUB_URL}/releases`}
              target="_blank"
              rel="noreferrer"
              aria-label={c.hero_tip_windows}
            >
              <WindowsIcon />
              <span className="iconbtn__label">{c.hero_ic_windows}</span>
              <span className="iconbtn__tip">{c.hero_tip_windows}</span>
            </a>
            <button
              type="button"
              className="iconbtn iconbtn--disabled"
              aria-disabled="true"
              aria-label={`${c.hero_ic_mac}－${c.hero_soon}`}
            >
              <AppleIcon />
              <span className="iconbtn__label">{c.hero_ic_mac}</span>
              <span className="iconbtn__tip">{c.hero_soon}</span>
            </button>
            <button
              type="button"
              className="iconbtn iconbtn--disabled"
              aria-disabled="true"
              aria-label={`${c.hero_ic_mobile}－${c.hero_soon}`}
            >
              <MobileIcon />
              <span className="iconbtn__label">{c.hero_ic_mobile}</span>
              <span className="iconbtn__tip">{c.hero_soon}</span>
            </button>
            <a
              className="iconbtn"
              href={WEBAPP_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={c.hero_webapp}
            >
              <GlobeIcon />
              <span className="iconbtn__label">{c.hero_ic_web}</span>
              <span className="iconbtn__tip">{c.hero_webapp}</span>
            </a>
            <a
              className="iconbtn"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={c.hero_github}
            >
              <GitHubIcon />
              <span className="iconbtn__label">{c.hero_ic_github}</span>
              <span className="iconbtn__tip">{c.hero_github}</span>
            </a>
          </div>
          {/* 「看技術原理」保留文字連結（ADR-0229）。 */}
          <div className="cta" style={{ marginTop: 14 }}>
            <button type="button" className="btn" onClick={onTech}>
              {c.hero_tech} →
            </button>
          </div>
        </div>
      </header>

      <section className="sec">
        <div className="wrap">
          <h2>{c.vision_title}</h2>
          <p className="sec__lead" style={{ maxWidth: 760 }}>
            {c.vision_body}
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2>{c.values_title}</h2>
          <div className="grid grid--4">
            {values.map((v) => (
              <div className="card" key={v.t}>
                <div className="card__ember" />
                <h3>{v.t}</h3>
                <p>{v.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2>{c.store_title}</h2>
          <p className="sec__lead" style={{ maxWidth: 760 }}>
            {c.store_lead}
          </p>
          <div className="grid">
            {[
              { t: c.store_desktop_t, b: c.store_desktop_b },
              { t: c.store_web_t, b: c.store_web_b },
              // 行動版尚未推出：暫時不顯示此卡（copy 鍵保留於 copy.ts，推出後把此列加回即可）。
            ].map((s) => (
              <div className="card" key={s.t}>
                <div className="card__ember" />
                <h3>{s.t}</h3>
                <p>{s.b}</p>
              </div>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            <strong>{c.store_relay_t}</strong> — {c.store_relay_b}
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2>{c.node_title}</h2>
          <p className="sec__lead">{c.node_intro}</p>
          <button type="button" className="btn" onClick={onNode}>
            {c.nav_node} →
          </button>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <h2>{c.donate_title}</h2>
          <p className="sec__lead">{c.donate_intro}</p>
          <div className="chips">
            {OFFICIAL_DONATIONS.map((d) => (
              <a className="btn" key={d.channel} href={d.url} target="_blank" rel="noreferrer">
                {d.label}
              </a>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            {c.donate_disclaimer}
          </p>
        </div>
      </section>
    </>
  );
}
