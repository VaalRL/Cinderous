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

/** raster data URI 是否結構合法（宣告圖片型別＋合法 base64）。raster 無腳本面，以型別＋尺寸把關。 */
export function isValidRasterDataUri(dataUri: string): boolean {
  return RASTER_DATA_URI.test(dataUri);
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
  | { type: "emoji"; shortcode: string; label: string; svg: string; format?: "raster" };

/**
 * 把含 `:shortcode:` 的文字切成片段序列。`resolve` 由呼叫端提供（通常＝本則清單優先、
 * 其次本機庫）；解析不到的短碼保留為字面文字。相鄰文字自動合併。
 */
export function resolveInlineEmoji(
  text: string,
  resolve: (shortcode: string) => { label: string; svg: string; format?: "raster" } | undefined,
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
    segs.push({
      type: "emoji",
      shortcode: code,
      label: asset.label,
      svg: asset.svg,
      ...(asset.format === "raster" ? { format: "raster" as const } : {}),
    });
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
