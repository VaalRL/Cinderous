// 網址衛生（ADR-0038）：追蹤參數清除 + 本地啟發式高風險評估。
// 全部純函式、零網路；規則採「精確名單＋站點範圍」壓低誤清風險。

/** 全域追蹤參數：前綴比對。 */
const TRACK_PREFIXES = ["utm_"];

/** 全域追蹤參數：精確名稱。 */
const TRACK_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "igsh",
  "ttclid",
  "twclid",
  "yclid",
  "wbraid",
  "gbraid",
  "spm",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "oly_enc_id",
  "oly_anon_id",
  "mkt_tok",
  "ck_subscriber_id",
  "fb_action_ids",
  "fb_action_types",
  "fb_ref",
  "fb_source",
  "_ga",
  "_gl",
]);

/** 站點範圍規則：參數語意依站而異者，只在該站清除。 */
const DOMAIN_RULES: ReadonlyArray<{
  host: RegExp;
  params?: string[];
  prefixes?: string[];
  /** 清除路徑段（如 Amazon 的 /ref=…）。 */
  path?: RegExp;
}> = [
  { host: /(^|\.)youtube\.com$|^youtu\.be$/, params: ["si", "pp", "feature"] },
  { host: /(^|\.)spotify\.com$/, params: ["si"] },
  {
    host: /(^|\.)bilibili\.com$/,
    params: ["vd_source", "share_source", "share_medium", "share_plat", "share_session_id", "from_source", "spm_id_from"],
  },
  {
    host: /(^|\.)amazon\.[a-z.]+$/,
    prefixes: ["pd_rd_", "pf_rd_"],
    params: ["linkCode", "ascsubtag", "ref_"],
    path: /\/ref=[^/?#]+$/,
  },
  { host: /(^|\.)aliexpress\.[a-z.]+$/, prefixes: ["aff_"], params: ["spm", "scm", "pdp_npi"] },
];

/** 已知 redirect 包裝：目標網址藏在 query 參數裡（ADR-0038 後續：拆殼）。 */
const REDIRECTS: ReadonlyArray<{ host: RegExp; path?: RegExp; params: string[] }> = [
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/url$/, params: ["q", "url"] },
  { host: /^(l|lm)\.facebook\.com$/, path: /^\/l\.php$/, params: ["u"] },
  { host: /^l\.instagram\.com$/, params: ["u"] },
  { host: /(^|\.)youtube\.com$/, path: /^\/redirect$/, params: ["q"] },
  { host: /^out\.reddit\.com$/, params: ["url"] },
  { host: /^t\.umblr\.com$/, path: /^\/redirect$/, params: ["z"] },
  { host: /^vk\.com$/, path: /^\/away\.php$/, params: ["to"] },
  { host: /^steamcommunity\.com$/, path: /^\/linkfilter\/?$/, params: ["url", "u"] },
];

/** 拆殼遞迴上限（巢狀包裝）。 */
const MAX_UNWRAP_DEPTH = 3;

/** hash 片段長得像參數列（k=v&k=v）才視為可清理；SPA 路由（含 /）與 #:~:text= 不動。 */
const HASH_PAIRS_RE = /^[A-Za-z0-9_.~-]+=[^&#/]*(?:&[A-Za-z0-9_.~-]+=[^&#/]*)*$/;

const isTracked = (name: string, extra?: { params?: string[]; prefixes?: string[] }): boolean => {
  const lower = name.toLowerCase();
  if (TRACK_PARAMS.has(lower)) return true;
  if (TRACK_PREFIXES.some((p) => lower.startsWith(p))) return true;
  if (extra?.params?.some((p) => p.toLowerCase() === lower)) return true;
  if (extra?.prefixes?.some((p) => lower.startsWith(p.toLowerCase()))) return true;
  return false;
};

/**
 * 清除單一網址的追蹤參數；無可清除（或解析失敗）時**原樣**回傳，
 * 避免 URL 正規化造成無謂改寫。
 */
export function cleanUrl(raw: string, depth = 0): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return raw;
  const host = url.hostname.toLowerCase();

  // Redirect 拆殼：以真正目的地取代包裝，再走一輪清理（巢狀有深度上限）。
  if (depth < MAX_UNWRAP_DEPTH) {
    const wrap = REDIRECTS.find((r) => r.host.test(host) && (!r.path || r.path.test(url.pathname)));
    const target = wrap?.params.map((p) => url.searchParams.get(p)).find((v) => v && /^https?:\/\//i.test(v));
    if (target) return cleanUrl(target, depth + 1);
  }

  const rule = DOMAIN_RULES.find((r) => r.host.test(host));
  let changed = false;
  for (const name of [...url.searchParams.keys()]) {
    if (isTracked(name, rule)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (rule?.path && rule.path.test(url.pathname)) {
    url.pathname = url.pathname.replace(rule.path, "");
    changed = true;
  }
  // hash 片段追蹤碼（ADR-0038 後續）：只在 hash 是 k=v&k=v 形式時清理。
  const hash = url.hash.slice(1);
  if (hash && HASH_PAIRS_RE.test(hash)) {
    const hp = new URLSearchParams(hash);
    let hashChanged = false;
    for (const name of [...hp.keys()]) {
      if (isTracked(name, rule)) {
        hp.delete(name);
        hashChanged = true;
      }
    }
    if (hashChanged) {
      const rest = hp.toString();
      url.hash = rest ? `#${rest}` : "";
      changed = true;
    }
  }
  if (!changed) return raw;
  let out = url.toString();
  // searchParams 清空後殘留的 '?' 去除
  if (url.searchParams.size === 0) out = out.replace(/\?(?=#|$)/, "");
  return out;
}

// 網址只含 ASCII 可見字元（非 ASCII 應為 percent-encoded）；全形標點/中文自然斷開。
const URL_RE = /https?:\/\/[^\s<>"')\]\u0080-\uffff]+/g;
/** 網址尾端常見、屬於句子的標點（不視為網址一部分）。 */
const TRAIL_PUNCT = /[.,;:!?]+$/;

/** 清除文字中所有網址的追蹤參數；回傳新文字與被清理的網址數。 */
export function cleanText(text: string): { text: string; cleaned: number } {
  let cleaned = 0;
  const out = text.replace(URL_RE, (m) => {
    const trail = m.match(TRAIL_PUNCT)?.[0] ?? "";
    const core = trail ? m.slice(0, -trail.length) : m;
    const next = cleanUrl(core);
    if (next !== core) cleaned += 1;
    return next + trail;
  });
  return { text: out, cleaned };
}

// ── 高風險評估 ──

export type UrlRiskReason =
  | "text-mismatch"
  | "userinfo"
  | "punycode"
  | "ip-host"
  | "odd-port"
  | "http"
  | "shortener"
  | "unparsable";

export interface UrlRisk {
  level: "ok" | "caution" | "danger";
  reasons: UrlRiskReason[];
}

const DANGER: ReadonlySet<UrlRiskReason> = new Set(["text-mismatch", "userinfo", "punycode", "ip-host", "known-malicious"]);

/** 已知短網址服務（無法預覽目的地 → 提示級）。 */
const SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "is.gd",
  "ow.ly",
  "buff.ly",
  "cutt.ly",
  "rb.gy",
  "t.ly",
  "s.id",
  "reurl.cc",
  "lihi.cc",
  "ppt.cc",
  "pse.is",
]);

const stripWww = (h: string): string => h.replace(/^www\./, "");

/** 兩個主機名是否屬於同一站（相等或互為子網域）。 */
const sameSite = (a: string, b: string): boolean => {
  const x = stripWww(a.toLowerCase());
  const y = stripWww(b.toLowerCase());
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
};

/** 連結顯示文字中「長得像網址」的主機名；沒有則回傳 undefined。 */
function hostnameInText(text: string): string | undefined {
  const m = text.trim().match(/^(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/:?#]|$)/i);
  return m?.[1];
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 本地啟發式風險評估（ADR-0038）。`linkText` 為 Markdown 連結的顯示文字，
 * 用於偵測「文字偽裝成另一個網址」。
 */
export function assessUrl(href: string, linkText?: string): UrlRisk {
  const reasons: UrlRiskReason[] = [];
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { level: "caution", reasons: ["unparsable"] };
  }
  const host = url.hostname.toLowerCase();

  if (url.username !== "" || url.password !== "") reasons.push("userinfo");
  if (host.split(".").some((label) => label.startsWith("xn--"))) reasons.push("punycode");
  if (IPV4_RE.test(host) || host.startsWith("[")) reasons.push("ip-host");
  if (url.port !== "" && url.port !== "80" && url.port !== "443") reasons.push("odd-port");
  if (url.protocol === "http:") reasons.push("http");
  if (SHORTENERS.has(stripWww(host))) reasons.push("shortener");

  if (linkText !== undefined) {
    const textHost = hostnameInText(linkText);
    if (textHost && !sameSite(textHost, host)) reasons.push("text-mismatch");
  }

  const level = reasons.some((r) => DANGER.has(r)) ? "danger" : reasons.length > 0 ? "caution" : "ok";
  return { level, reasons };
}

// ── 設定開關（ADR-0038 後續）──

const CLEAN_KEY = "nb.urlHygiene.cleanOnPaste";

/** 貼上時清除追蹤參數是否啟用（預設開）。 */
export function cleanOnPasteEnabled(): boolean {
  try {
    return localStorage.getItem(CLEAN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setCleanOnPasteEnabled(on: boolean): void {
  try {
    localStorage.setItem(CLEAN_KEY, on ? "1" : "0");
  } catch {
    /* 不可用時維持預設 */
  }
}
