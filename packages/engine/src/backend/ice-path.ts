// ICE 路徑判定（ADR-0344）：這條連線的位元組**是直連，還是經 TURN 中繼轉送**。
//
// ## 為什麼需要它
//
// ADR-0213 的標題列晶片只有兩態：資料通道開了（`connected=true`）或沒開。但「開了」底下藏著
// 兩種完全不同的現實——
//
//   - **直連**（host/srflx 配對）：位元組走兩端之間，**站方零成本**。
//   - **經 TURN 中繼**（任一端是 relay 候選）：位元組**整份**穿過 TURN 伺服器，**按流量計費**。
//
// ADR-0243 核可公共 TURN 的成本論證是**以通話為基礎**的（雙向 ~80 kbps，10 分鐘語音 ≈ 6 MB）。
// 但 `FILE_TRANSPORT_ORDER` 允許**檔案**走 TURN——同一條管子，一個大檔就是等量的計費流量，
// 而 ADR-0342 §2 已經自承「真正把上限釘死的只有帳單警示」。⇒ 要替大檔把關，第一步是
// **先有能力分辨自己在哪條路上**。在此之前程式根本不知道。
//
// ## 判定方式
//
// `RTCPeerConnection.getStats()` 吐出的 stats 圖裡找出**被選中的 candidate-pair**，再看它兩端
// 候選的 `candidateType`。**任一端是 `relay` 就是經中繼**——TURN 只要有一端在用，位元組就
// 必然流經那台伺服器。
//
// ## "unknown" 是誠實，不是失敗
//
// 判不出來時回 `"unknown"`，**不猜**。把「判定」與「政策」分開是刻意的：
// 這裡只回報看到什麼；至於「判不出來時該不該當成中繼來擋大檔」，那是呼叫端的決定
// （把關要保守 ⇒ 該把 `unknown` 當 `relay` 辦，見 ADR-0344 §後續行動）。

/** 這條連線的位元組實際走哪條路。 */
export type IcePath =
  /** 兩端直連（host/srflx/prflx 配對）——不經任何伺服器，站方零流量成本。 */
  | "direct"
  /** 經 TURN 中繼轉送（任一端為 relay 候選）——**按流量計費**，內容仍為 DTLS 密文。 */
  | "relay"
  /** 尚未探測、瀏覽器未提供 stats、或圖中資訊不足以斷定。**不代表沒連上。** */
  | "unknown";

/** 單筆 RTCStats 的最小讀取形狀（stats 來自瀏覽器＝外部輸入，一律防禦性讀取）。 */
export interface IceStatsEntry {
  readonly [key: string]: unknown;
}

/** 提供 `getStats()` 的來源（`RTCPeerConnection`；型別放寬以免綁死 lib.dom 版本差異）。 */
export interface IceStatsSource {
  getStats?: () => unknown;
}

/** 只取字串，其餘一律視為缺席。 */
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** 由 candidate id 取出該候選的 `candidateType`（`host`/`srflx`/`prflx`/`relay`）。 */
function candidateType(byId: Map<string, IceStatsEntry>, id: unknown): string | undefined {
  const key = str(id);
  if (key === undefined) return undefined;
  const entry = byId.get(key);
  if (!entry) return undefined;
  const type = str(entry["type"]);
  // 僅接受候選類報告，避免 id 撞名時誤讀成別種 stats。
  if (type !== "local-candidate" && type !== "remote-candidate") return undefined;
  return str(entry["candidateType"]);
}

/**
 * 找出被選中的 candidate-pair。依序嘗試四種來源——前兩種涵蓋實務上所有瀏覽器，
 * 後兩種是保險；**都不確定就回 undefined**（交給呼叫端當 `unknown` 處理）。
 */
function selectPair(
  byId: Map<string, IceStatsEntry>,
  pairs: IceStatsEntry[],
  transports: IceStatsEntry[],
): IceStatsEntry | undefined {
  // ① `transport.selectedCandidatePairId`（Chrome/Edge/Safari）。
  for (const transport of transports) {
    const id = str(transport["selectedCandidatePairId"]);
    if (id === undefined) continue;
    const pair = byId.get(id);
    if (pair && str(pair["type"]) === "candidate-pair") return pair;
  }
  // ② 配對自帶 `selected`（Firefox）。
  const selected = pairs.filter((p) => p["selected"] === true);
  if (selected.length === 1) return selected[0];
  // ③ 已提名且成功——唯一一組才採信（歷史上的 aggressive nomination 可能有多組）。
  const nominated = pairs.filter((p) => p["nominated"] === true && str(p["state"]) === "succeeded");
  if (nominated.length === 1) return nominated[0];
  // ④ 最後退路：整張圖只有一組成功配對，那它就是在用的那組。
  const succeeded = pairs.filter((p) => str(p["state"]) === "succeeded");
  if (succeeded.length === 1) return succeeded[0];
  return undefined;
}

/**
 * 從一批 RTCStats 報告判定 ICE 路徑。純函式、無副作用——輸入畸形一律回 `"unknown"`，
 * **不丟例外**（這是顯示與把關用的旁路資訊，絕不該拖垮連線）。
 */
export function classifyIcePath(reports: Iterable<IceStatsEntry> | null | undefined): IcePath {
  if (!reports) return "unknown";
  const byId = new Map<string, IceStatsEntry>();
  const pairs: IceStatsEntry[] = [];
  const transports: IceStatsEntry[] = [];
  for (const report of reports) {
    if (!report || typeof report !== "object") continue;
    const id = str(report["id"]);
    if (id !== undefined) byId.set(id, report);
    const type = str(report["type"]);
    if (type === "candidate-pair") pairs.push(report);
    else if (type === "transport") transports.push(report);
  }

  const pair = selectPair(byId, pairs, transports);
  if (!pair) return "unknown";

  const local = candidateType(byId, pair["localCandidateId"]);
  const remote = candidateType(byId, pair["remoteCandidateId"]);
  // 任一端是 relay ⇒ 位元組必經那台 TURN。只要看到一端就能下結論，不必兩端都解得出。
  if (local === "relay" || remote === "relay") return "relay";
  // 兩端都解出來且都不是 relay，才敢說直連；只解出一端＝資訊不足。
  if (local !== undefined && remote !== undefined) return "direct";
  return "unknown";
}

/**
 * 把 `getStats()` 的回傳正規化成一串報告。
 *
 * ⚠ `RTCStatsReport` 是 **maplike**——直接 `for...of` 迭代拿到的是 `[id, report]` **配對**，
 * 不是報告本身。必須走 `values()`。陣列（測試替身）剛好也有 `values()`，同一條路徑通吃。
 */
function toEntries(report: unknown): IceStatsEntry[] {
  if (!report || typeof report !== "object") return [];
  const source = report as {
    values?: () => Iterable<unknown>;
    forEach?: (cb: (value: unknown) => void) => void;
    [Symbol.iterator]?: () => Iterator<unknown>;
  };
  const out: IceStatsEntry[] = [];
  const push = (value: unknown): void => {
    if (value && typeof value === "object") out.push(value as IceStatsEntry);
  };
  if (typeof source.values === "function") {
    for (const value of source.values()) push(value);
    return out;
  }
  if (typeof source.forEach === "function") {
    source.forEach(push);
    return out;
  }
  if (typeof source[Symbol.iterator] === "function") {
    for (const value of source as Iterable<unknown>) push(value);
  }
  return out;
}

/**
 * 探測一條 `RTCPeerConnection` 目前的 ICE 路徑。
 *
 * **永不拋出**：沒有 `getStats`（舊 webview、測試替身）、呼叫失敗、或圖看不懂，一律 `"unknown"`。
 */
export async function probeIcePath(pc: IceStatsSource | null | undefined): Promise<IcePath> {
  const getStats = pc?.getStats;
  if (typeof getStats !== "function") return "unknown";
  try {
    const report: unknown = await Promise.resolve(getStats.call(pc));
    return classifyIcePath(toEntries(report));
  } catch {
    return "unknown";
  }
}
