import { useEffect, useState } from "react";
import type { Theme } from "@cinderous/theme";
import { CinderMark } from "./Brand.js";
import { useCopy } from "./copy.js";
import { Faq } from "./pages/Faq.js";
import { Home } from "./pages/Home.js";
import { Node } from "./pages/Node.js";
import { Roadmap } from "./pages/Roadmap.js";
import { parseRoute, routeHref, type Route, type View } from "./routes.js";
import { Tech } from "./pages/Tech.js";
// 透明度頁暫時下架（保留 pages/Transparency.tsx 與 tr_* 文案，還原＝復原此 import＋nav＋路由）
// import { Transparency } from "./pages/Transparency.js";

export const GITHUB_URL = "https://github.com/VaalRL/Cinderous";
// 官方網頁版（瀏覽器 app）入口（ADR-0209）：與官網分 origin（ADR-0090/0147），只是一條跨 origin 連結。
// 暫用 Cloudflare Worker 預設網址；日後綁自訂網域（cinderous.propfolk.com）只改這一行。
export const WEBAPP_URL = "https://cinderous.cinderous1.workers.dev";

function initialTheme(): Theme {
  return "dark"; // 夜森林為預設身分；使用者仍可切白日
}

/**
 * 導覽連結——**必須是 `<a href>`**（ADR-0235 SEO-1）。
 *
 * 修正前這裡是 `<button onClick={() => setView(v)}>`：對使用者一樣能點，但對爬蟲是**死路**
 * ——沒有 `href` 就沒有可跟隨的連結，`tech`／`node`／`roadmap` 三頁等於不存在於索引中。
 * `onClick` 只是加速（避免整頁重載）；按住 Ctrl／中鍵／右鍵另開分頁等原生行為一律保留。
 */
function NavLink({
  route,
  current,
  label,
  onNavigate,
}: {
  route: Route;
  current: View;
  label: string;
  onNavigate: (route: Route) => void;
}): JSX.Element {
  return (
    <a
      className={`nav__link${current === route.view ? " on" : ""}`}
      href={routeHref(route)}
      aria-current={current === route.view ? "page" : undefined}
      onClick={(e) => {
        // 修飾鍵／非左鍵：交還給瀏覽器（另開分頁、下載…）。
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onNavigate(route);
      }}
    >
      {label}
    </a>
  );
}

export function App({ route: initialRoute }: { route: Route }): JSX.Element {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const c = useCopy(route.locale);
  const { view, locale } = route;

  // 開機時才讀系統偏好：SSR 期間沒有 window，讀了會在預渲染階段炸掉。
  useEffect(() => {
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) setTheme("light");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // 上一頁／下一頁：真實 URL 帶來的真實歷史（修正前 useState 切頁完全沒有歷史）。
  useEffect(() => {
    const onPop = (): void => setRoute(parseCurrent());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (next: Route): void => {
    window.history.pushState(null, "", routeHref(next));
    setRoute(next);
    window.scrollTo(0, 0);
  };

  // 語言切換也是**一條真實連結**（ADR-0235 SEO-3）：換 URL 而非換 state，
  // 否則 hreflang 指向的頁面根本不存在。
  const otherLocale = locale === "zh-Hant" ? "en" : "zh-Hant";
  const localeHref = routeHref({ view, locale: otherLocale });

  return (
    <>
      <nav className="nav">
        <div className="nav__inner">
          <a
            className="nav__brand"
            href={routeHref({ view: "home", locale })}
            style={{ textDecoration: "none", color: "inherit" }}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              navigate({ view: "home", locale });
            }}
          >
            <CinderMark size={28} theme={theme} /> Cinderous
          </a>
          <span className="nav__spacer" />
          <NavLink route={{ view: "home", locale }} current={view} label={c.nav_home} onNavigate={navigate} />
          <NavLink route={{ view: "tech", locale }} current={view} label={c.nav_tech} onNavigate={navigate} />
          <NavLink route={{ view: "node", locale }} current={view} label={c.nav_node} onNavigate={navigate} />
          <NavLink route={{ view: "roadmap", locale }} current={view} label={c.nav_roadmap} onNavigate={navigate} />
          <NavLink route={{ view: "faq", locale }} current={view} label={c.nav_faq} onNavigate={navigate} />
          <a className="nav__toggle" href={localeHref} hrefLang={otherLocale} rel="alternate">
            {locale === "zh-Hant" ? "EN" : "繁中"}
          </a>
          <button type="button" className="nav__toggle" aria-label="theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <a className="nav__cta" href={`${GITHUB_URL}/releases`} target="_blank" rel="noreferrer">
            {c.nav_download}
          </a>
        </div>
      </nav>

      {view === "home" ? (
        <Home
          c={c}
          theme={theme}
          onNode={() => navigate({ view: "node", locale })}
          onTech={() => navigate({ view: "tech", locale })}
        />
      ) : view === "tech" ? (
        <Tech c={c} />
      ) : view === "roadmap" ? (
        <Roadmap c={c} />
      ) : view === "faq" ? (
        <Faq c={c} />
      ) : (
        <Node c={c} />
      )}

      <footer className="footer">
        <div className="wrap">{c.footer_privacy}</div>
      </footer>
    </>
  );
}

/** 由目前網址解析路由（掛載與 popstate 用）。 */
export function parseCurrent(): Route {
  return parseRoute(window.location.pathname);
}
