import { useEffect, useState } from "react";
import type { Locale } from "@cinder/i18n";
import type { Theme } from "@cinder/theme";
import { CinderMark } from "./Brand.js";
import { useCopy } from "./copy.js";
import { Download } from "./pages/Download.js";
import { Home } from "./pages/Home.js";
import { Node } from "./pages/Node.js";
import { Transparency } from "./pages/Transparency.js";

export const GITHUB_URL = "https://github.com/VaalRL/Nostr-buddy";

type View = "home" | "download" | "node" | "transparency";

function initialTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "dark"; // 夜森林為預設身分；使用者仍可切白日
}

export function App(): JSX.Element {
  const [view, setView] = useState<View>("home");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [locale, setLocale] = useState<Locale>("zh-Hant");
  const c = useCopy(locale);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = locale;
  }, [theme, locale]);

  const link = (v: View, label: string) => (
    <button type="button" className={`nav__link${view === v ? " on" : ""}`} onClick={() => setView(v)}>
      {label}
    </button>
  );

  return (
    <>
      <nav className="nav">
        <div className="nav__inner">
          <button
            type="button"
            className="nav__brand"
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}
            onClick={() => setView("home")}
          >
            <CinderMark size={28} theme={theme} /> Cinder
          </button>
          <span className="nav__spacer" />
          {link("home", c.nav_home)}
          {link("node", c.nav_node)}
          {link("transparency", c.nav_transparency)}
          <button type="button" className="nav__toggle" onClick={() => setLocale(locale === "zh-Hant" ? "en" : "zh-Hant")}>
            {locale === "zh-Hant" ? "EN" : "繁中"}
          </button>
          <button type="button" className="nav__toggle" aria-label="theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button type="button" className="nav__cta" onClick={() => setView("download")}>
            {c.nav_download}
          </button>
        </div>
      </nav>

      {view === "home" ? (
        <Home c={c} theme={theme} onNode={() => setView("node")} onDownload={() => setView("download")} />
      ) : view === "download" ? (
        <Download c={c} onNode={() => setView("node")} />
      ) : view === "node" ? (
        <Node c={c} />
      ) : (
        <Transparency c={c} />
      )}

      <footer className="footer">
        <div className="wrap">{c.footer_privacy}</div>
      </footer>
    </>
  );
}
