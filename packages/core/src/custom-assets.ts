// 統一自訂資產（emoji＋貼圖）的行內清單與短碼解析（ADR-0220）。
//
// 自訂 emoji 走既有加密訊息通道——與自製貼圖（ADR-0032 `nb-sticker:v2:`）同源，
// 差別只在「用法」：貼圖是整則大圖，emoji 是行內小圖，打 `:shortcode:` 插入。
// 去中心化沒有中央目錄，故訊息文字尾端附一段「本則引用資產清單」`nb-assets:v1:`，
// 收端解析後行內渲染並可自動收藏；渲染解析序＝本則清單 → 保留原字（優雅退化）。
// 刻意不以本機庫回退渲染他人訊息——短碼非全域唯一，用本地同名短碼會渲染出與寄件者不同的圖（ADR-0221 L2）。
// 全純函式，可於 node 環境完整測試。

import { contentHash } from "./event.js";
import { clampStickerLabel, validateStickerSvg } from "./sticker-svg.js";

/** 行內資產清單前綴（附於訊息文字尾端，只帶本則引用的資產）。 */
export const ASSET_MANIFEST_PREFIX = "nb-assets:v1:";

/** 清單總位元組上限（ADR-0220）：落在 NIP-44 明文上限（65535）內，且限制群組扇出放大。 */
export const ASSET_MANIFEST_MAX_BYTES = 48 * 1024;

/** 單則訊息內嵌資產數量上限（防一則塞爆扇出）。 */
export const ASSET_MANIFEST_MAX_COUNT = 24;

/**
 * 單則訊息**渲染**的行內 emoji 數量上限（ADR-0221 H3）。清單有界，但可見文字可重複引用同一
 * 短碼無界；超過此數的 `:shortcode:` 一律留為字面文字，避免對端以重複引用觸發客戶端 DoS。
 */
export const INLINE_EMOJI_MAX = 50;

/** 單顆 raster 資產（data URI 字串）位元組上限（ADR-0222）：行內時須落在清單預算內。 */
export const RASTER_MAX_BYTES = 48 * 1024;

/** 合法 raster data URI：宣告為允許圖片型別（gif/png/webp/jpeg）＋合法 base64（ADR-0222）。 */
const RASTER_DATA_URI = /^data:image\/(gif|png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** 嗅探 raster data URI 的圖片型別；非合法（含非圖 MIME）回 null。 */
export function detectRasterType(dataUri: string): "gif" | "png" | "webp" | "jpeg" | null {
  const m = /^data:image\/(gif|png|webp|jpeg);base64,/.exec(dataUri);
  return m ? (m[1] as "gif" | "png" | "webp" | "jpeg") : null;
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * 解出 base64 字串的前 `want` 個 bytes（ADR-0225）。手寫極簡解碼、只解需要的前綴——
 * 不用 `atob`／`Buffer`（避免 node／瀏覽器環境差異），純函式可完整於 node 測試。
 * 遇 `=`（padding）或非法字元即停；不足 `want` 時回傳較短陣列。
 */
function firstBytes(b64: string, want: number): number[] {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of b64) {
    const v = B64_ALPHABET.indexOf(ch);
    if (v < 0) break; // padding 或非法字元
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
      if (out.length >= want) break;
    }
  }
  return out;
}

/**
 * raster 的 magic-byte 內容嗅探（ADR-0225）：解 base64 前 12 bytes，比對宣告型別的檔頭，
 * 要求**宣告 MIME 與實際位元組一致**。擋偽裝副檔名/MIME；型別無法辨識或檔頭不符即 false。
 */
export function rasterMagicOk(dataUri: string): boolean {
  const type = detectRasterType(dataUri);
  if (!type) return false;
  const comma = dataUri.indexOf(",");
  if (comma < 0) return false;
  const b = firstBytes(dataUri.slice(comma + 1), 12);
  switch (type) {
    case "gif": // "GIF8"（GIF87a/89a 共同前綴）
      return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
    case "png": // \x89 P N G
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case "jpeg": // FF D8 FF
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "webp": // "RIFF"…（byte 8–11）"WEBP"
      return (
        b[0] === 0x52 &&
        b[1] === 0x49 &&
        b[2] === 0x46 &&
        b[3] === 0x46 &&
        b[8] === 0x57 &&
        b[9] === 0x45 &&
        b[10] === 0x42 &&
        b[11] === 0x50
      );
    default:
      return false;
  }
}

/**
 * raster data URI 是否合法（ADR-0222 結構＋ADR-0225 內容）：宣告圖片型別＋合法 base64＋
 * **magic-byte 與宣告一致**。raster 無腳本面，以「型別內容一致＋尺寸」把關。
 */
export function isValidRasterDataUri(dataUri: string): boolean {
  return RASTER_DATA_URI.test(dataUri) && rasterMagicOk(dataUri);
}

/** 自訂資產種類（ADR-0220）。 */
export type CustomAssetKind = "sticker" | "emoji" | "both";

/**
 * 自訂資產（本機庫模型）：`id` 為 SVG 內容雜湊（`contentHash`）作去重；
 * emoji 用途需有 `shortcode`（打 `:shortcode:` 插入）。
 */
export interface CustomAsset {
  id: string;
  label: string;
  /** 渲染內容：`format="svg"`（預設）時為 SVG 原始碼；`format="raster"` 時為 `data:image/*` data URI。 */
  svg: string;
  kind: CustomAssetKind;
  shortcode?: string;
  /** 自建/自匯入（非收自他人）；LRU 淘汰時受保護（ADR-0221 M1）。 */
  mine?: boolean;
  /** 資產格式（ADR-0222）：`svg`（預設，向後相容）或 `raster`（動畫 GIF/WebP 等，直接 `<img>` 渲染）。 */
  format?: "svg" | "raster";
  /**
   * 內容定址參照（ADR-0223 Model B）：有值時渲染內容不在行內 `svg`，而在 blob 快取的 `data`
   * （`hash===ref`）。用於大動畫 GIF——圖走 out-of-band、庫只記參照。
   */
  ref?: string;
  /**
   * 加入／最後更新時間（毫秒；ADR-0224）：跨裝置庫合併的 LWW 比較基準，亦與墓碑 `at` 比大小
   * （資產較新＝復活、墓碑較新＝刪除）。舊資料可能缺 → 合併時視為 `0`（最舊）。
   */
  at?: number;
}

/** 內容定址 blob（ADR-0223）：`hash===contentHash(data)`；`data` 為 `data:image/*` data URI。 */
export interface AssetBlob {
  hash: string;
  data: string;
}

/** blob 快取上限（顆）；獨立於策展庫 LIBRARY_MAX，收到的大 emoji 存這裡不佔庫（ADR-0223）。 */
export const BLOB_CACHE_MAX = 64;

/** blob 整合性：`hash` 是否等於內容雜湊（ADR-0223；防惡意寄件者/中繼掉包）。 */
export function blobHashOk(hash: string, data: string): boolean {
  return contentHash(data) === hash;
}

/** blob 快取 LRU（ADR-0223）：incoming 置前（最新）、同 hash 去重、超過 max 尾端淘汰。純函式。 */
export function cacheBlobs(cache: AssetBlob[], incoming: AssetBlob[], max: number): AssetBlob[] {
  const inSeen = new Set<string>();
  const fresh: AssetBlob[] = [];
  for (const b of incoming) {
    if (inSeen.has(b.hash)) continue;
    inSeen.add(b.hash);
    fresh.push(b);
  }
  const kept = cache.filter((b) => !inSeen.has(b.hash));
  const result = [...fresh, ...kept];
  return result.length > max ? result.slice(0, max) : result;
}

/** 行內清單負載（隨訊息）：shortcode → { 標籤, SVG }。 */
export type AssetManifest = Record<string, { label: string; svg?: string; ref?: string; format?: "raster" }>;

/** 內容雜湊（sha256 hex）格式：64 個小寫十六進位。 */
const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * 短碼合法字元（Slack 風格）：字母數字開頭，後續可含 `_ + -`，總長 ≤32。
 * 刻意不收 Unicode，避免與一般中文文字的冒號用法混淆。
 */
const SHORTCODE_RE = /^[a-z0-9][a-z0-9_+-]{0,31}$/i;

/** 文字中的短碼 token（全域）：使用前務必重置 `lastIndex`。 */
const SHORTCODE_TOKEN = /:([a-z0-9][a-z0-9_+-]{0,31}):/gi;

/** 是否為合法短碼（不含前後冒號）。 */
export function isValidShortcode(code: string): boolean {
  return SHORTCODE_RE.test(code);
}

/** 組出行內資產清單字串（附於文字尾端）。 */
export function formatAssetManifest(manifest: AssetManifest): string {
  return ASSET_MANIFEST_PREFIX + JSON.stringify(manifest);
}

/**
 * 解析行內資產清單；逐筆防禦性驗證（短碼合法、SVG 過 `validateStickerSvg`、
 * 夾住標籤、限數量）；非法整筆丟棄，非法 JSON 回傳空清單。不信任對端手工訊息。
 */
export function parseAssetManifest(s: string): AssetManifest {
  if (!s.startsWith(ASSET_MANIFEST_PREFIX)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(s.slice(ASSET_MANIFEST_PREFIX.length));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: AssetManifest = {};
  let count = 0;
  let bytes = 0; // 收端亦擋總位元組（不信任對端，ADR-0221 L1）——與送出端上限一致。
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (count >= ASSET_MANIFEST_MAX_COUNT) break;
    if (!isValidShortcode(key)) continue;
    if (!val || typeof val !== "object") continue;
    const label = (val as { label?: unknown }).label;
    const svg = (val as { svg?: unknown }).svg;
    const ref = (val as { ref?: unknown }).ref;
    const raster = (val as { format?: unknown }).format === "raster";
    if (typeof label !== "string") continue;
    // 參照筆（ADR-0223）：blob 另傳，此處只驗 ref 為合法 hash＋raster；不含 svg。
    if (typeof ref === "string" && HASH_RE.test(ref)) {
      if (!raster) continue;
      bytes += ref.length + label.length;
      if (bytes > ASSET_MANIFEST_MAX_BYTES) break;
      out[key] = { label: clampStickerLabel(label), ref, format: "raster" };
      count++;
      continue;
    }
    if (typeof svg !== "string") continue;
    // raster：型別＋尺寸把關（無腳本面，不套 validateStickerSvg）；svg：拒收制驗證（ADR-0222）。
    if (raster ? !(isValidRasterDataUri(svg) && svg.length <= RASTER_MAX_BYTES) : !validateStickerSvg(svg).ok) continue;
    bytes += svg.length + label.length;
    if (bytes > ASSET_MANIFEST_MAX_BYTES) break;
    out[key] = raster ? { label: clampStickerLabel(label), svg, format: "raster" } : { label: clampStickerLabel(label), svg };
    count++;
  }
  return out;
}

/** 把資產清單接到文字尾端；空清單則原樣返回（不留痕跡）。 */
export function appendAssetManifest(text: string, manifest: AssetManifest): string {
  if (Object.keys(manifest).length === 0) return text;
  return `${text}\n${formatAssetManifest(manifest)}`;
}

/**
 * 從訊息內容拆出「可見文字」與「資產清單」。清單附於最後一行、以 `nb-assets:v1:`
 * 起頭；解析不出有效清單則整段視為文字（向後相容：舊版 client 直接顯示尾端字面）。
 */
export function splitAssetManifest(content: string): { text: string; manifest: AssetManifest } {
  const marker = `\n${ASSET_MANIFEST_PREFIX}`;
  const at = content.lastIndexOf(marker);
  if (at === -1) return { text: content, manifest: {} };
  const manifest = parseAssetManifest(content.slice(at + 1)); // 跳過換行
  if (Object.keys(manifest).length === 0) return { text: content, manifest: {} };
  return { text: content.slice(0, at), manifest };
}

/** 訊息可見文字內引用到的短碼（依出現序、去重）。供送出端據以組清單。 */
export function collectReferencedShortcodes(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  SHORTCODE_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SHORTCODE_TOKEN.exec(text)) !== null) {
    const code = m[1];
    if (code === undefined) continue;
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/** 行內解析後的片段：純文字或一顆 emoji。 */
export type InlineSegment =
  | { type: "text"; value: string }
  | { type: "emoji"; shortcode: string; label: string; svg: string; format?: "raster" }
  /** 參照筆但 blob 未到（ADR-0223）：呼叫端顯示占位並觸發 backfill。 */
  | { type: "emoji-pending"; shortcode: string; label: string; ref: string };

/**
 * 把含 `:shortcode:` 的文字切成片段序列。`resolve` 由呼叫端提供（通常＝本則清單優先、
 * 其次本機庫）；解析不到的短碼保留為字面文字。相鄰文字自動合併。
 */
export function resolveInlineEmoji(
  text: string,
  resolve: (
    shortcode: string,
  ) => { label: string; svg: string; format?: "raster" } | { label: string; pending: true; ref: string } | undefined,
  maxEmoji: number = INLINE_EMOJI_MAX,
): InlineSegment[] {
  const segs: InlineSegment[] = [];
  const pushText = (value: string): void => {
    if (!value) return;
    const prev = segs[segs.length - 1];
    if (prev && prev.type === "text") prev.value += value;
    else segs.push({ type: "text", value });
  };
  SHORTCODE_TOKEN.lastIndex = 0;
  let last = 0;
  let emojiCount = 0;
  let m: RegExpExecArray | null;
  while ((m = SHORTCODE_TOKEN.exec(text)) !== null) {
    const code = m[1];
    if (code === undefined) continue;
    if (emojiCount >= maxEmoji) continue; // 達渲染上限：其餘留為字面文字（ADR-0221 H3）
    const asset = resolve(code);
    if (!asset) continue; // 未解析：併入後續文字（不移動 last）
    pushText(text.slice(last, m.index));
    if ("pending" in asset) {
      segs.push({ type: "emoji-pending", shortcode: code, label: asset.label, ref: asset.ref });
    } else {
      segs.push({
        type: "emoji",
        shortcode: code,
        label: asset.label,
        svg: asset.svg,
        ...(asset.format === "raster" ? { format: "raster" as const } : {}),
      });
    }
    last = m.index + m[0].length;
    emojiCount++;
  }
  pushText(text.slice(last));
  return segs;
}

/** 由清單一筆造出 emoji 用途的 `CustomAsset`（id＝內容雜湊，供去重）。 */
export function assetFromManifestEntry(
  shortcode: string,
  entry: { label: string; svg?: string; ref?: string; format?: "raster" },
): CustomAsset {
  // 參照筆（ADR-0223）：內容在 blob 快取；id＝ref（＝blob 內容雜湊），svg 留空占位。
  if (entry.ref) {
    return {
      id: entry.ref,
      label: clampStickerLabel(entry.label),
      svg: "",
      kind: "emoji",
      shortcode,
      format: "raster",
      ref: entry.ref,
    };
  }
  return {
    id: contentHash(entry.svg ?? ""),
    label: clampStickerLabel(entry.label),
    svg: entry.svg ?? "",
    kind: "emoji",
    shortcode,
    ...(entry.format === "raster" ? { format: "raster" as const } : {}),
  };
}

/**
 * 把清單一筆解析為可渲染內容（ADR-0223）：行內→直接內容；參照→查 blob 快取取內容；
 * 參照但 blob 未到→`pending`（呼叫端據此顯示占位並觸發 backfill）。
 */
export function resolveManifestEntry(
  entry: { label: string; svg?: string; ref?: string; format?: "raster" },
  getBlob: (hash: string) => string | undefined,
): { label: string; svg: string; format?: "raster" } | { label: string; pending: true; ref: string } | undefined {
  if (entry.ref) {
    const data = getBlob(entry.ref);
    if (data === undefined) return { label: entry.label, pending: true, ref: entry.ref };
    return { label: entry.label, svg: data, format: "raster" };
  }
  if (typeof entry.svg === "string") {
    return { label: entry.label, svg: entry.svg, ...(entry.format === "raster" ? { format: "raster" as const } : {}) };
  }
  return undefined;
}

/** 資產清單序列化後的位元組數（供送出端檢查每則預算）。 */
export function assetManifestBytes(manifest: AssetManifest): number {
  return new TextEncoder().encode(formatAssetManifest(manifest)).length;
}

/**
 * 找出文字尾端「正在打的」自訂 emoji 短碼片段（供 `:` 自動補全；ADR-0220）。
 * 需 `:` 位於開頭或非英數字元之後（避免 `10:30` 之類誤觸），其後至少一個合法短碼字元、
 * 且尚未打出結尾 `:`。回傳 `{ query, start }`（start＝`:` 的索引）；不在補全情境回 null。
 */
export function activeEmojiQuery(text: string): { query: string; start: number } | null {
  const m = /(?:^|[^A-Za-z0-9])(:[A-Za-z0-9][A-Za-z0-9_+-]*)$/.exec(text);
  const token = m?.[1];
  if (token === undefined) return null;
  return { query: token.slice(1), start: text.length - token.length };
}

/**
 * 收到自動收藏＋LRU 淘汰（ADR-0220）。把 `incoming` 併入 `library`：最近收到者置於前端
 * （前＝最新），同 `id`（內容雜湊）者移到最前並刷新（保留 incoming 版本的標籤/短碼），
 * 不重複。超過 `max` 時，從尾端淘汰「未受保護」者；`protect`（通常＝最愛或自建）永不淘汰，
 * 即使因此超過 `max`。純函式，不變更輸入。單顆點擊收藏＝傳長度 1 的 `incoming`。
 */
export function acquireAssets(
  library: CustomAsset[],
  incoming: CustomAsset[],
  opts: { max: number; protect?: (a: CustomAsset) => boolean },
): CustomAsset[] {
  const protect = opts.protect ?? ((): boolean => false);
  // incoming 去重（保留首見）；置前＝最新。
  const inSeen = new Set<string>();
  const fresh: CustomAsset[] = [];
  for (const a of incoming) {
    if (inSeen.has(a.id)) continue;
    inSeen.add(a.id);
    // 本地已有同內容且已自訂 shortcode → 保留本地版本（不被對端覆蓋，ADR-0221 H2）。
    const local = library.find((x) => x.id === a.id);
    fresh.push(local && local.shortcode ? local : a);
  }
  const kept = library.filter((a) => !inSeen.has(a.id));
  let result = [...fresh, ...kept];
  // 尾端淘汰未受保護者，直到 ≤max 或只剩受保護者。
  while (result.length > opts.max) {
    let idx = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      const a = result[i];
      if (a && !protect(a)) {
        idx = i;
        break;
      }
    }
    if (idx === -1) break; // 全受保護：不淘汰（可超過 max）
    result = result.filter((_, i) => i !== idx);
  }
  return result;
}

/** 資產刪除墓碑（ADR-0224）：`id`＝內容雜湊、`at`＝刪除時間（毫秒）。隨庫一同跨裝置同步。 */
export interface AssetTombstone {
  id: string;
  at: number;
}

/** 墓碑保留上限（顆）；超過取新到舊前 N（ADR-0224）。 */
export const ASSET_TOMBSTONE_MAX = 128;

/** 取多組墓碑中每個 id 的最新（最大 `at`）。 */
function latestTombstones(...lists: AssetTombstone[][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const list of lists) {
    for (const t of list) {
      const prev = m.get(t.id);
      if (prev === undefined || t.at > prev) m.set(t.id, t.at);
    }
  }
  return m;
}

/**
 * 跨裝置庫合併（ADR-0224）：LWW＋墓碑，交換律（多台任意順序合併結果一致）。
 *
 * - 對每個 `id`：取資產的最大 `at` 版本；比對該 id 墓碑的最大 `at`——資產 `at` **嚴格大於**
 *   墓碑 `at` → 資產存活（含「重匯自動復活」）並丟棄該墓碑；否則資產出局、保留墓碑（刪除傳播）。
 * - 合併同 `id` 資產時 `shortcode`／`mine` **保留本地**（別台不覆蓋本地自訂/自建旗標，ADR-0221）。
 * - 存活資產按 `at` 新到舊（前＝最新），套 `max` LRU 淘汰（`protect` 永不淘汰）；
 *   墓碑按 `at` 新到舊取前 `tombstoneMax`。純函式，不變更輸入。
 */
export function mergeAssetLibrary(
  local: CustomAsset[],
  remote: CustomAsset[],
  localTombstones: AssetTombstone[],
  remoteTombstones: AssetTombstone[],
  opts: { max: number; tombstoneMax?: number; protect?: (a: CustomAsset) => boolean },
): { assets: CustomAsset[]; tombstones: AssetTombstone[] } {
  const protect = opts.protect ?? ((): boolean => false);
  const tombstoneMax = opts.tombstoneMax ?? ASSET_TOMBSTONE_MAX;
  const localById = new Map(local.map((a) => [a.id, a]));

  // 1) 併資產：對每個 id 取「最大 at 版本」為內容基底。
  const mergedById = new Map<string, CustomAsset>();
  const order: string[] = []; // 首見序（穩定輸出用）
  for (const a of [...local, ...remote]) {
    const existing = mergedById.get(a.id);
    if (!existing) {
      order.push(a.id);
      mergedById.set(a.id, a);
      continue;
    }
    mergedById.set(a.id, (a.at ?? 0) > (existing.at ?? 0) ? a : existing);
  }
  // 本地 shortcode/mine 保留＋取 at 最大值。
  for (const id of order) {
    const merged = mergedById.get(id);
    if (!merged) continue;
    const loc = localById.get(id);
    const at = Math.max(merged.at ?? 0, loc?.at ?? 0);
    mergedById.set(id, {
      ...merged,
      ...(loc?.shortcode ? { shortcode: loc.shortcode } : {}),
      ...(loc?.mine ? { mine: true } : {}),
      ...(at ? { at } : {}),
    });
  }

  // 2) 墓碑：每個 id 取最新 at。
  const tombAt = latestTombstones(localTombstones, remoteTombstones);

  // 3) 存活判定＋墓碑清理：資產 at 嚴格大於墓碑 at → 存活並丟棄墓碑；否則出局、留墓碑。
  const survivors: CustomAsset[] = [];
  for (const id of order) {
    const a = mergedById.get(id);
    if (!a) continue;
    const t = tombAt.get(id);
    if (t !== undefined && (a.at ?? 0) <= t) continue; // 出局（墓碑勝平手＝刪除優先）
    if (t !== undefined) tombAt.delete(id); // 復活：丟棄過時墓碑
    survivors.push(a);
  }

  // 4) 排序（at 新到舊，同 at 維持首見序）＋ max LRU 淘汰。
  const rank = new Map(order.map((id, i) => [id, i]));
  const ix = (id: string): number => rank.get(id) ?? 0;
  survivors.sort((x, y) => (y.at ?? 0) - (x.at ?? 0) || ix(x.id) - ix(y.id));
  let assets = survivors;
  while (assets.length > opts.max) {
    let idx = -1;
    for (let i = assets.length - 1; i >= 0; i--) {
      const a = assets[i];
      if (a && !protect(a)) {
        idx = i;
        break;
      }
    }
    if (idx === -1) break; // 全受保護：不淘汰
    assets = assets.filter((_, i) => i !== idx);
  }

  // 5) 墓碑輸出：新到舊、取前 tombstoneMax。
  const tombstones = [...tombAt.entries()]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at - a.at)
    .slice(0, tombstoneMax);

  return { assets, tombstones };
}
