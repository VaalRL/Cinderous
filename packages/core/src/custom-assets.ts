// 統一自訂資產（emoji＋貼圖）的行內清單與短碼解析（ADR-0220）。
//
// 自訂 emoji 走既有加密訊息通道——與自製貼圖（ADR-0032 `nb-sticker:v2:`）同源，
// 差別只在「用法」：貼圖是整則大圖，emoji 是行內小圖，打 `:shortcode:` 插入。
// 去中心化沒有中央目錄，故訊息文字尾端附一段「本則引用資產清單」`nb-assets:v1:`，
// 收端解析後行內渲染並可自動收藏；解析序＝本則清單 → 本機庫 → 保留原字（優雅退化）。
// 全純函式，可於 node 環境完整測試。

import { contentHash } from "./event.js";
import { clampStickerLabel, validateStickerSvg } from "./sticker-svg.js";

/** 行內資產清單前綴（附於訊息文字尾端，只帶本則引用的資產）。 */
export const ASSET_MANIFEST_PREFIX = "nb-assets:v1:";

/** 清單總位元組上限（ADR-0220）：落在 NIP-44 明文上限（65535）內，且限制群組扇出放大。 */
export const ASSET_MANIFEST_MAX_BYTES = 48 * 1024;

/** 單則訊息內嵌資產數量上限（防一則塞爆扇出）。 */
export const ASSET_MANIFEST_MAX_COUNT = 24;

/** 自訂資產種類（ADR-0220）。 */
export type CustomAssetKind = "sticker" | "emoji" | "both";

/**
 * 自訂資產（本機庫模型）：`id` 為 SVG 內容雜湊（`contentHash`）作去重；
 * emoji 用途需有 `shortcode`（打 `:shortcode:` 插入）。
 */
export interface CustomAsset {
  id: string;
  label: string;
  svg: string;
  kind: CustomAssetKind;
  shortcode?: string;
}

/** 行內清單負載（隨訊息）：shortcode → { 標籤, SVG }。 */
export type AssetManifest = Record<string, { label: string; svg: string }>;

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
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (count >= ASSET_MANIFEST_MAX_COUNT) break;
    if (!isValidShortcode(key)) continue;
    if (!val || typeof val !== "object") continue;
    const label = (val as { label?: unknown }).label;
    const svg = (val as { svg?: unknown }).svg;
    if (typeof label !== "string" || typeof svg !== "string") continue;
    if (!validateStickerSvg(svg).ok) continue;
    out[key] = { label: clampStickerLabel(label), svg };
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
  | { type: "emoji"; shortcode: string; label: string; svg: string };

/**
 * 把含 `:shortcode:` 的文字切成片段序列。`resolve` 由呼叫端提供（通常＝本則清單優先、
 * 其次本機庫）；解析不到的短碼保留為字面文字。相鄰文字自動合併。
 */
export function resolveInlineEmoji(
  text: string,
  resolve: (shortcode: string) => { label: string; svg: string } | undefined,
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
  let m: RegExpExecArray | null;
  while ((m = SHORTCODE_TOKEN.exec(text)) !== null) {
    const code = m[1];
    if (code === undefined) continue;
    const asset = resolve(code);
    if (!asset) continue; // 未解析：併入後續文字（不移動 last）
    pushText(text.slice(last, m.index));
    segs.push({ type: "emoji", shortcode: code, label: asset.label, svg: asset.svg });
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return segs;
}

/** 由清單一筆造出 emoji 用途的 `CustomAsset`（id＝內容雜湊，供去重）。 */
export function assetFromManifestEntry(
  shortcode: string,
  entry: { label: string; svg: string },
): CustomAsset {
  return {
    id: contentHash(entry.svg),
    label: clampStickerLabel(entry.label),
    svg: entry.svg,
    kind: "emoji",
    shortcode,
  };
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
    fresh.push(a);
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
