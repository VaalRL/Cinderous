// 自製貼圖的 SVG 驗證（ADR-0032）：拒收制（reject），非清洗制。
//
// 渲染一律走 <img src=dataURI>（SVG 內 JS 與外部載入本已停用），本驗證為
// 縱深防禦第二層：匯入、fork、收端渲染前、點擊收藏時皆須通過。
// 純字串比對，可於 node 環境完整測試。

/** SVG 原始碼上限（bytes）：安全落在 NIP-44 明文上限（65535）內。 */
export const STICKER_SVG_MAX_BYTES = 32 * 1024;

/**
 * 自製貼圖標籤字數上限（ADR-0042）。標籤與 SVG 一同隨訊息扇出（ADR-0032/0027），
 * 若不設限會繞過 SVG 上限膨脹群組扇出的每份負載，故一併夾住。
 */
export const STICKER_LABEL_MAX = 48;

/** 夾住標籤：去頭尾空白、限制字數；空白時回傳空字串（呼叫端決定預設）。 */
export function clampStickerLabel(label: string): string {
  return label.trim().slice(0, STICKER_LABEL_MAX);
}

export type SvgVerdict = { ok: true } | { ok: false; reason: string };

/** 危險樣式（不分大小寫）：任一命中即整張拒收。 */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/<script/i, "script"],
  [/\son[a-z]+\s*=/i, "event-handler"],
  [/javascript:/i, "javascript-url"],
  [/<foreignobject/i, "foreignObject"],
  [/<iframe|<embed|<object/i, "embedded-document"],
  // 外部參照：http(s):// 或協定相對 //（含 href / xlink:href / url(...) / src=）
  [/(href|src)\s*=\s*["']?\s*(https?:)?\/\//i, "external-ref"],
  [/url\(\s*["']?\s*(https?:)?\/\//i, "external-url"],
  // data: 僅允許 data:image/*
  [/data:(?!image\/)/i, "data-non-image"],
];

/**
 * 驗證自製貼圖 SVG；不通過時回傳拒收原因（機器可讀短碼）。
 */
export function validateStickerSvg(svg: string): SvgVerdict {
  const trimmed = svg.trim();
  if (!/^<svg[\s>]/i.test(trimmed)) return { ok: false, reason: "not-svg" };
  if (!/<\/svg>\s*$/i.test(trimmed)) return { ok: false, reason: "not-svg" };
  if (new TextEncoder().encode(trimmed).length > STICKER_SVG_MAX_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  for (const [re, reason] of FORBIDDEN) {
    if (re.test(trimmed)) return { ok: false, reason };
  }
  return { ok: true };
}

/** 將 raster data URI（data:image/*）包成統一的 SVG 表示（ADR-0032）。 */
export function wrapRasterAsSvg(dataUri: string, size = 256): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    `<image href="${dataUri}" width="${size}" height="${size}"/></svg>`
  );
}
