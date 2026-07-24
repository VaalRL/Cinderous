// 每頁 SEO／GEO metadata（ADR-0235 SEO-4／SEO-5）。純函式：輸入路由，輸出 `<head>` 片段。
//
// ## 為什麼 GEO 需要這些
//
// Googlebot 會執行 JS（但有渲染佇列延遲與預算）；**GPTBot／ClaudeBot／PerplexityBot 等
// 生成式引擎的索引路徑基本上不執行 JS**。修正前整站是空的 `<div id="root">` ＋一支 module
// script——這些引擎看到的是一個沒有內容的殼，於是 Cinderous 的所有主張（開源、永久免費、
// 端對端加密、零伺服器狀態）對答案引擎**完全不存在**。
//
// 預渲染（entry-server）解決「內容看得到」；本檔解決「內容被正確理解與歸屬」：
//   - canonical：避免 `/tech` 與 `/tech/` 之類被判重複
//   - hreflang：讓中英文互為替代版本而非彼此的重複內容
//   - Open Graph／Twitter Card：分享出去有預覽卡（修正前是光禿禿一條連結）
//   - JSON-LD：`SoftwareApplication` ＋ `Organization` ＋ `FAQPage` 是答案引擎最容易正確
//     擷取的格式——比從 HTML 猜語意可靠得多

import type { Locale } from "@cinderous/i18n";
import { type Copy } from "./copy.js";
import { alternates, DEFAULT_LOCALE, routeUrl, SITE_ORIGIN, type Route } from "./routes.js";

/** 品牌名；title 統一以 `｜Cinderous` 收尾（首頁除外，避免重複）。 */
export const BRAND = "Cinderous";

/** OG 圖（build 時由 `scripts/og-image.mjs` 產生於 dist 根）。 */
export const OG_IMAGE_PATH = "og.png";
export const OG_IMAGE_W = 1200;
export const OG_IMAGE_H = 630;

/** hreflang 代碼：`zh-Hant` 直接可用；`x-default` 指向預設語言版本。 */
function hreflangOf(locale: Locale): string {
  return locale;
}

/** HTML 屬性值跳脫（預渲染時我們自己組字串，不能靠 React escape）。 */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  lang: Locale;
}

/**
 * 每頁的 title／description。
 *
 * 首頁 H1 與 title 刻意**帶關鍵字**而非只有品牌名——修正前 `<h1>` 就是 `"Cinderous"`，
 * 那是頁面最強的語意訊號，只放一個沒人認識的品牌名等於整條浪費掉（ADR-0235 SEO-5）。
 */
export function pageMeta(route: Route, c: Copy): PageMeta {
  const canonical = routeUrl(route);
  const zh = route.locale === "zh-Hant";
  const byView: Record<Route["view"], { title: string; description: string }> = {
    home: {
      title: zh
        ? `${BRAND} — 開源、端對端加密的去中心化即時通訊`
        : `${BRAND} — Open-source, end-to-end encrypted decentralized messaging`,
      description: zh
        ? "Cinderous 是開源、永久免費、隱私優先的去中心化即時通訊軟體。訊息端對端加密（NIP-44／Gift Wrap），本地優先儲存，中繼站零伺服器狀態——明文與私鑰永不離開你的裝置。"
        : "Cinderous is open-source, forever-free, privacy-first decentralized messaging. End-to-end encrypted (NIP-44 / Gift Wrap), local-first storage, zero server state — plaintext and private keys never leave your device.",
    },
    tech: {
      title: zh ? `技術原理：Nostr ＋ WebRTC 雙軌加密通訊｜${BRAND}` : `How it works: Nostr + WebRTC｜${BRAND}`,
      description: zh
        ? "Cinderous 如何運作：Nostr 中繼負責離線留言與信令、WebRTC 走 P2P 直連，內容以 NIP-44 加密並用 NIP-17／59 Gift Wrap 隱藏寄件人，中繼站無法從訊息層重建「誰傳給誰」。"
        : "How Cinderous works: Nostr relays carry offline messages and signaling, WebRTC handles P2P; content is NIP-44 encrypted and wrapped with NIP-17/59 Gift Wrap that hides message senders, so relays cannot reconstruct who messages whom.",
    },
    node: {
      title: zh ? `自架節點：企業與家用中繼站｜${BRAND}` : `Self-hosting: run your own relay｜${BRAND}`,
      description: zh
        ? "自架 Cinderous 中繼站：Cloudflare Workers、Docker 或樹莓派皆可執行同一套 RelayCore。企業可用 allowlist 建立封閉節點，資料完全留在自己的基礎設施。"
        : "Self-host a Cinderous relay: the same RelayCore runs on Cloudflare Workers, Docker, or a Raspberry Pi. Enterprises can run a closed node via allowlist and keep data on their own infrastructure.",
    },
    enterprise: {
      title: zh ? `企業版：自架封閉節點與組織名冊｜${BRAND}` : `Enterprise: self-hosted closed relay & org roster｜${BRAND}`,
      description: zh
        ? "Cinderous 企業版：以 allowlist 自架封閉中繼、組織名冊與邀請碼入職、離職接管（無金鑰託管）、保留天數與強制 TURN 等公司政策，資料完全留在自己的基礎設施，中繼只見密文。"
        : "Cinderous Enterprise: a self-hosted closed relay via allowlist, org roster with invite-code onboarding, offboarding takeover (no key escrow), and company policy like retention and forced TURN — data stays on your own infrastructure and relays see only ciphertext.",
    },
    roadmap: {
      title: zh ? `產品路線圖：已完成與規劃中的功能｜${BRAND}` : `Roadmap: shipped and planned｜${BRAND}`,
      description: zh
        ? "Cinderous 的開發路線圖：已完成的端對端加密訊息、群組、語音視訊通話、檔案傳輸與企業模式，以及規劃中的行動端與桌面強化。"
        : "The Cinderous roadmap: shipped end-to-end encrypted messaging, groups, voice/video calls, file transfer and enterprise mode — plus what is planned next.",
    },
    faq: {
      title: zh ? `常見問題：Cinderous 是什麼、安全嗎、免費嗎？｜${BRAND}` : `FAQ: what is Cinderous, is it secure, is it free?｜${BRAND}`,
      description: zh
        ? "關於 Cinderous 的常見問題：它是什麼、訊息會被誰看到、需不需要手機號碼、與 Signal 有何不同、真的免費嗎、伺服器是誰在運作、換手機會不會丟訊息。"
        : "Common questions about Cinderous: what it is, who can read your messages, whether it needs a phone number, how it differs from Signal, whether it is really free, who runs the servers, and device migration.",
    },
  };
  const { title, description } = byView[route.view];
  // 文案缺漏時退回目錄值，確保永遠有非空的 description（空 description 比沒有更糟）。
  return { title, description: description || c.hero_subtitle, canonical, lang: route.locale };
}

/** 結構化資料（JSON-LD）：答案引擎最容易正確擷取的格式。 */
export function jsonLd(route: Route, meta: PageMeta, repoUrl: string, c?: Copy): string {
  const org = {
    "@type": "Organization",
    name: BRAND,
    url: `${SITE_ORIGIN}/Cinderous/`,
    sameAs: [repoUrl],
  };
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebSite",
      "@id": `${SITE_ORIGIN}/Cinderous/#website`,
      name: BRAND,
      url: `${SITE_ORIGIN}/Cinderous/`,
      inLanguage: route.locale,
      publisher: org,
    },
    {
      "@type": "WebPage",
      "@id": `${meta.canonical}#webpage`,
      url: meta.canonical,
      name: meta.title,
      description: meta.description,
      inLanguage: route.locale,
      isPartOf: { "@id": `${SITE_ORIGIN}/Cinderous/#website` },
    },
  ];
  // FAQ 頁宣告 FAQPage——問答對直接對應答案引擎的擷取格式。用**與可見內容相同**的 faqItems
  // （Google 政策：結構化資料須與頁面內容相符）。
  if (route.view === "faq" && c) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${meta.canonical}#faq`,
      inLanguage: route.locale,
      mainEntity: c.faqItems.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
  }
  // 首頁額外宣告這是一個軟體——這是「Cinderous 是什麼」這類提問的直接答案來源。
  if (route.view === "home") {
    graph.push({
      "@type": "SoftwareApplication",
      name: BRAND,
      applicationCategory: "CommunicationApplication",
      operatingSystem: "Windows, macOS, Linux, Web",
      description: meta.description,
      url: `${SITE_ORIGIN}/Cinderous/`,
      license: "https://www.gnu.org/licenses/agpl-3.0.html",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: org,
      codeRepository: repoUrl,
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}

/**
 * 組出該頁的完整 `<head>` 內容（不含 `<title>` 以外的 build 產物如 CSS／JS——那由 vite 注入）。
 * 回傳可直接塞進 HTML 模板的字串。
 */
export function headTags(route: Route, c: Copy, repoUrl: string): string {
  const meta = pageMeta(route, c);
  const ogImage = `${SITE_ORIGIN}/Cinderous/${OG_IMAGE_PATH}`;
  const lines = [
    `<title>${escapeAttr(meta.title)}</title>`,
    `<meta name="description" content="${escapeAttr(meta.description)}" />`,
    `<link rel="canonical" href="${escapeAttr(meta.canonical)}" />`,
  ];
  for (const alt of alternates(route)) {
    lines.push(`<link rel="alternate" hreflang="${escapeAttr(hreflangOf(alt.locale))}" href="${escapeAttr(alt.url)}" />`);
  }
  lines.push(
    `<link rel="alternate" hreflang="x-default" href="${escapeAttr(routeUrl({ view: route.view, locale: DEFAULT_LOCALE }))}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
    `<meta property="og:url" content="${escapeAttr(meta.canonical)}" />`,
    `<meta property="og:locale" content="${escapeAttr(route.locale === "en" ? "en_US" : "zh_TW")}" />`,
    `<meta property="og:image" content="${escapeAttr(ogImage)}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE_W}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_H}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(ogImage)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta name="theme-color" content="#f7f2ea" />`,
    // JSON-LD 內容是我們自己產的 JSON；`</script>` 序列在 JSON 字串中會被跳脫成 `<\/script>`
    // 以免提早關閉標籤。
    `<script type="application/ld+json">${jsonLd(route, meta, repoUrl, c).replace(/</g, "\\u003c")}</script>`,
  );
  return lines.join("\n    ");
}

/** `robots.txt` 內容。明確歡迎生成式引擎的爬蟲——它們才是 GEO 的流量來源。 */
export function robotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "",
    "# 生成式引擎爬蟲（GEO）：明確允許，避免被預設政策擋掉。",
    "User-agent: GPTBot",
    "Allow: /",
    "",
    "User-agent: ClaudeBot",
    "Allow: /",
    "",
    "User-agent: PerplexityBot",
    "Allow: /",
    "",
    `Sitemap: ${SITE_ORIGIN}/Cinderous/sitemap.xml`,
    "",
  ].join("\n");
}

/** `sitemap.xml` 內容（含 hreflang alternate，讓雙語版本正確配對）。 */
export function sitemapXml(routes: Route[]): string {
  const urls = routes
    .map((route) => {
      const alts = alternates(route)
        .map((a) => `    <xhtml:link rel="alternate" hreflang="${escapeAttr(a.locale)}" href="${escapeAttr(a.url)}"/>`)
        .join("\n");
      return [
        "  <url>",
        `    <loc>${escapeAttr(routeUrl(route))}</loc>`,
        alts,
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeAttr(
          routeUrl({ view: route.view, locale: DEFAULT_LOCALE }),
        )}"/>`,
        `    <changefreq>weekly</changefreq>`,
        `    <priority>${route.view === "home" ? "1.0" : "0.8"}</priority>`,
        "  </url>",
      ].join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}
