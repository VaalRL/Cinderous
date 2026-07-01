// 貼圖（Sticker，M7）：以 `pack/id` 參照內建貼圖包，客戶端渲染。
//
// 貼圖走既有加密訊息通道——訊息內容為 `nb-sticker:v1:<pack>/<id>` 標記，收件端
// 解析後渲染對應的內建向量圖，而非文字。因此持久化、回應、收回、限時皆自然沿用。
// 內建圖為原創簡易 SVG（避開任何商標素材）。

/** 貼圖參照的內容前綴。 */
export const STICKER_PREFIX = "nb-sticker:v1:";

/** 組出一則貼圖訊息的內容字串。 */
export function formatSticker(pack: string, id: string): string {
  return `${STICKER_PREFIX}${pack}/${id}`;
}

/** 解析訊息內容；非貼圖或格式錯誤回傳 null。 */
export function parseSticker(content: string): { pack: string; id: string } | null {
  if (!content.startsWith(STICKER_PREFIX)) return null;
  const rest = content.slice(STICKER_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  const pack = rest.slice(0, slash);
  const id = rest.slice(slash + 1);
  if (rest.indexOf("/", slash + 1) !== -1) return null; // 只允許單一 `/`
  return { pack, id };
}

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

/** 內建貼圖包：pack → id → { 標籤, SVG }。皆為原創簡易圖案。 */
export const STICKER_PACKS: Record<string, Record<string, { label: string; svg: string }>> = {
  buddy: {
    cat: {
      label: "貓咪",
      svg: svg(
        '<circle cx="50" cy="55" r="34" fill="#f7c873"/>' +
          '<path d="M22 32 L34 52 L16 50 Z M78 32 L66 52 L84 50 Z" fill="#f7c873"/>' +
          '<circle cx="38" cy="52" r="5" fill="#333"/><circle cx="62" cy="52" r="5" fill="#333"/>' +
          '<path d="M46 64 Q50 68 54 64" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>' +
          '<path d="M20 60 H36 M20 66 H36 M64 60 H80 M64 66 H80" stroke="#c9962f" stroke-width="2"/>',
      ),
    },
    heart: {
      label: "愛心",
      svg: svg(
        '<path d="M50 82 C10 54 22 22 50 40 C78 22 90 54 50 82 Z" fill="#e8567a"/>',
      ),
    },
    star: {
      label: "星星",
      svg: svg(
        '<path d="M50 12 L61 40 L92 42 L67 61 L76 91 L50 73 L24 91 L33 61 L8 42 L39 40 Z" fill="#f5c518"/>',
      ),
    },
    cry: {
      label: "哭哭",
      svg: svg(
        '<circle cx="50" cy="50" r="38" fill="#ffe08a"/>' +
          '<path d="M36 44 Q40 40 44 44 M56 44 Q60 40 64 44" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>' +
          '<path d="M40 62 Q50 54 60 62" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>' +
          '<path d="M38 50 q-4 10 0 14 q4 -4 0 -14 Z" fill="#5fb0e8"/>' +
          '<path d="M62 50 q4 10 0 14 q-4 -4 0 -14 Z" fill="#5fb0e8"/>',
      ),
    },
    party: {
      label: "慶祝",
      svg: svg(
        '<path d="M18 86 L44 40 L64 60 Z" fill="#8a5cf6"/>' +
          '<circle cx="70" cy="24" r="5" fill="#e8567a"/><circle cx="84" cy="40" r="4" fill="#f5c518"/>' +
          '<circle cx="60" cy="18" r="3" fill="#42b883"/><rect x="76" y="60" width="7" height="7" fill="#5fb0e8"/>',
      ),
    },
    sleep: {
      label: "想睡",
      svg: svg(
        '<circle cx="46" cy="54" r="34" fill="#bcd7f0"/>' +
          '<path d="M34 52 Q40 48 46 52 M52 52 Q58 48 64 52" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>' +
          '<path d="M40 66 Q46 70 52 66" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>' +
          '<text x="70" y="34" font-size="20" fill="#5b7fa6">z</text>' +
          '<text x="82" y="22" font-size="14" fill="#5b7fa6">z</text>',
      ),
    },
  },
};

/** 取得貼圖的 SVG（找不到回傳 undefined）。 */
export function stickerSvg(pack: string, id: string): string | undefined {
  return STICKER_PACKS[pack]?.[id]?.svg;
}

/** 把 SVG 轉為可放進 `<img src>` 的 data URI。 */
export function svgToDataUri(svgText: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svgText)}`;
}
