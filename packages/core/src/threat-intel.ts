// 本地威脅情報比對（ADR-0231）：分來源保留命中出處（供遮罩顯示「被哪個來源警示」）。
// 純函式、零網路——絕不送 URL/host 給任何伺服器。實際網域資料於 P2 落地；此處定義結構與比對。

/** 情報來源 metadata（供遮罩顯示）。 */
export interface ThreatSource {
  id: string;
  /** 顯示名稱（如 "URLhaus"、"我的封鎖清單"）。 */
  name: string;
  /** 來源網址（可選，供「了解更多」）。 */
  url?: string;
}

/** 威脅情報 DB：來源清單 ＋ 每來源的網域集合（registrable domain，小寫、去 www.）。 */
export interface ThreatDb {
  sources: ThreatSource[];
  /** sourceId → 網域集合。 */
  domains: Map<string, Set<string>>;
}

/** 從 URL 取可比對的主機（小寫、去 www.）；非 http(s)／無法解析回 null。 */
export function urlHost(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** 官網部署的 snapshot JSON 形狀（ADR-0231 P2）；`updated`／額外欄位僅供人讀，解析忽略。 */
export interface ThreatSnapshot {
  updated?: string;
  sources: ThreatSource[];
  domains: Record<string, string[]>;
}

/**
 * 解析 snapshot JSON → ThreatDb（ADR-0231 P2）：驗證形狀、網域正規化（小寫、去 www.）。
 * 格式不符／無任何有效來源回 null（呼叫端靜默退回既有 db）。純函式。
 */
export function parseThreatSnapshot(data: unknown): ThreatDb | null {
  if (typeof data !== "object" || data === null) return null;
  const { sources, domains } = data as { sources?: unknown; domains?: unknown };
  if (!Array.isArray(sources) || typeof domains !== "object" || domains === null) return null;
  const outSources: ThreatSource[] = [];
  const outDomains = new Map<string, Set<string>>();
  for (const s of sources) {
    if (typeof s !== "object" || s === null) continue;
    const { id, name, url } = s as { id?: unknown; name?: unknown; url?: unknown };
    if (typeof id !== "string" || id === "" || typeof name !== "string" || name === "") continue;
    const set = new Set<string>();
    const list = (domains as Record<string, unknown>)[id];
    if (Array.isArray(list)) {
      for (const d of list) {
        if (typeof d === "string" && d !== "") set.add(d.toLowerCase().replace(/^www\./, ""));
      }
    }
    outSources.push(typeof url === "string" && url !== "" ? { id, name, url } : { id, name });
    outDomains.set(id, set);
  }
  if (outSources.length === 0) return null;
  return { sources: outSources, domains: outDomains };
}

/**
 * 比對主機是否命中威脅情報（ADR-0231）：檢查該主機及其上層網域（子網域也算命中母網域，
 * 如 a.b.evil.com → evil.com），回命中的來源集（供遮罩顯示）；未命中回 []。
 * 只比對「尾端連續」網域，故 evil.com.attacker.net 不會命中 evil.com。純函式。
 */
export function matchThreat(db: ThreatDb, host: string): ThreatSource[] {
  const h = host.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  const candidates: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) candidates.push(parts.slice(i).join("."));
  const hit: ThreatSource[] = [];
  for (const src of db.sources) {
    const set = db.domains.get(src.id);
    if (set && candidates.some((c) => set.has(c))) hit.push(src);
  }
  return hit;
}
