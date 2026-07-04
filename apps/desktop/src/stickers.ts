// 貼圖（Sticker，M7）：以 `pack/id` 參照內建貼圖包，客戶端渲染。
//
// 貼圖走既有加密訊息通道——訊息內容為 `nb-sticker:v1:<pack>/<id>` 標記，收件端
// 解析後渲染對應的內建向量圖，而非文字。因此持久化、回應、收回、限時皆自然沿用。
// 內建圖為原創簡易 SVG（避開任何商標素材）。

import { clampStickerLabel } from "./ui/sticker-svg.js";

/** 貼圖參照的內容前綴。 */
export const STICKER_PREFIX = "nb-sticker:v1:";

/** 自製貼圖（內容隨訊息）的前綴（ADR-0032）。 */
export const CUSTOM_STICKER_PREFIX = "nb-sticker:v2:";

/** 組出一則貼圖訊息的內容字串。 */
export function formatSticker(pack: string, id: string): string {
  return `${STICKER_PREFIX}${pack}/${id}`;
}

/** 自製貼圖負載：內容隨訊息送達，id 由收端以內容雜湊自算。 */
export interface CustomStickerPayload {
  label: string;
  svg: string;
}

/** 組出一則自製貼圖訊息的內容字串（v2，JSON 內嵌 SVG）。 */
export function formatCustomSticker(payload: CustomStickerPayload): string {
  return `${CUSTOM_STICKER_PREFIX}${JSON.stringify(payload)}`;
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

/** 解析自製貼圖訊息（v2）；非自製貼圖或格式錯誤回傳 null。 */
export function parseCustomSticker(content: string): CustomStickerPayload | null {
  if (!content.startsWith(CUSTOM_STICKER_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(content.slice(CUSTOM_STICKER_PREFIX.length));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as CustomStickerPayload).label === "string" &&
      typeof (parsed as CustomStickerPayload).svg === "string"
    ) {
      const { label, svg } = parsed as CustomStickerPayload;
      // 收端防禦：夾住標籤字數，避免對端手工塞超長標籤膨脹渲染（ADR-0042）。
      return { label: clampStickerLabel(label), svg };
    }
  } catch {
    /* 非法 JSON */
  }
  return null;
}

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

/**
 * 動態貼圖：CSS keyframes 內嵌於 SVG（`<img>` 中可播放，JS 被停用故安全）。
 * `.a` 元素以 fill-box 為變換原點；`prefers-reduced-motion` 時停用動畫（無障礙）。
 * 見 docs/adr/0031。
 */
const anim = (keyframes: string, body: string): string =>
  svg(
    "<style>" +
      ".a{transform-box:fill-box;transform-origin:center}" +
      keyframes +
      "@media(prefers-reduced-motion:reduce){.a{animation:none!important}}" +
      "</style>" +
      body,
  );

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
  mood: {
    laugh: {
      label: "大笑",
      svg: svg(
        '<circle cx="50" cy="50" r="38" fill="#ffd84d"/>' +
          '<path d="M34 42 Q40 36 46 42 M54 42 Q60 36 66 42" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>' +
          '<path d="M34 60 Q50 78 66 60 Z" fill="#8a3b3b"/>',
      ),
    },
    love: {
      label: "喜歡",
      svg: svg(
        '<circle cx="50" cy="50" r="38" fill="#ffd84d"/>' +
          '<path d="M32 42 c4 -6 12 -6 8 2 c-2 4 -8 6 -8 6 c0 0 -6 -2 -8 -6 c-4 -8 4 -8 8 -2 Z" fill="#e8567a"/>' +
          '<path d="M60 42 c4 -6 12 -6 8 2 c-2 4 -8 6 -8 6 c0 0 -6 -2 -8 -6 c-4 -8 4 -8 8 -2 Z" fill="#e8567a"/>' +
          '<path d="M38 62 Q50 72 62 62" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>',
      ),
    },
    angry: {
      label: "生氣",
      svg: svg(
        '<circle cx="50" cy="50" r="38" fill="#ef7a6d"/>' +
          '<path d="M32 40 L46 46 M68 40 L54 46" stroke="#333" stroke-width="3" stroke-linecap="round"/>' +
          '<circle cx="40" cy="52" r="4" fill="#333"/><circle cx="60" cy="52" r="4" fill="#333"/>' +
          '<path d="M38 68 Q50 60 62 68" stroke="#333" stroke-width="3" fill="none" stroke-linecap="round"/>',
      ),
    },
    ok: {
      label: "OK",
      svg: svg(
        '<circle cx="50" cy="50" r="38" fill="#7fd07f"/>' +
          '<path d="M32 52 L44 64 L70 36" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      ),
    },
    question: {
      label: "疑問",
      svg: svg(
        '<circle cx="50" cy="50" r="38" fill="#8fb8e8"/>' +
          '<path d="M40 40 Q40 30 50 30 Q62 30 62 42 Q62 50 52 54 L52 60" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>' +
          '<circle cx="52" cy="70" r="4.5" fill="#fff"/>',
      ),
    },
    thumbsup: {
      label: "讚",
      svg: svg(
        '<circle cx="50" cy="50" r="38" fill="#ffd84d"/>' +
          '<path d="M42 48 L42 70 L60 70 Q66 70 67 64 L70 54 Q71 48 64 48 L54 48 L57 38 Q58 30 50 32 Q46 33 46 40 L42 48 Z" fill="#fff" stroke="#c99a1f" stroke-width="2" stroke-linejoin="round"/>' +
          '<rect x="34" y="48" width="8" height="22" rx="2" fill="#fff" stroke="#c99a1f" stroke-width="2"/>',
      ),
    },
  },
  motion: {
    wave: {
      label: "揮手",
      svg: anim(
        "@keyframes wv{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(16deg)}}.a{animation:wv 1s ease-in-out infinite}",
        '<g class="a">' +
          '<rect x="40" y="34" width="26" height="42" rx="13" fill="#f7c873"/>' +
          '<rect x="32" y="42" width="10" height="22" rx="5" fill="#f7c873"/>' +
          '<path d="M46 36 v-8 M53 34 v-10 M60 36 v-8" stroke="#e0a94f" stroke-width="4" stroke-linecap="round"/>' +
          "</g>",
      ),
    },
    bounce: {
      label: "彈跳",
      svg: anim(
        "@keyframes bnc{0%,100%{transform:translateY(-24px)}50%{transform:translateY(6px)}}.a{animation:bnc .8s ease-in-out infinite}",
        '<ellipse cx="50" cy="84" rx="18" ry="4" fill="#00000022"/>' +
          '<circle class="a" cx="50" cy="52" r="18" fill="#5fb0e8"/>',
      ),
    },
    spin: {
      label: "轉星",
      svg: anim(
        "@keyframes spn{to{transform:rotate(360deg)}}.a{animation:spn 3s linear infinite}",
        '<path class="a" d="M50 12 L61 40 L92 42 L67 61 L76 91 L50 73 L24 91 L33 61 L8 42 L39 40 Z" fill="#f5c518"/>',
      ),
    },
    beat: {
      label: "心跳",
      svg: anim(
        "@keyframes bt{0%,100%{transform:scale(1)}25%{transform:scale(1.18)}50%{transform:scale(1)}}.a{animation:bt 1s ease-in-out infinite}",
        '<path class="a" d="M50 82 C10 54 22 22 50 40 C78 22 90 54 50 82 Z" fill="#e8567a"/>',
      ),
    },
  },
};

/** 貼圖包的顯示資訊；order 決定分頁排列，cover 作為分頁圖示。 */
export interface StickerPackMeta {
  title: string;
  cover: string;
}

export const STICKER_PACK_META: Record<string, StickerPackMeta> = {
  buddy: { title: "夥伴", cover: "cat" },
  mood: { title: "心情", cover: "laugh" },
  motion: { title: "動態", cover: "wave" },
};

/** 貼圖包顯示順序（僅列出有 metadata 者，過濾未知包）。 */
export const STICKER_PACK_ORDER: string[] = Object.keys(STICKER_PACK_META).filter(
  (p) => p in STICKER_PACKS,
);

/** 解析貼圖參照為其資料；找不到（包或 id 已不存在）回傳 undefined。 */
export function resolveSticker(pack: string, id: string): { label: string; svg: string } | undefined {
  return STICKER_PACKS[pack]?.[id];
}

/** 取得貼圖的 SVG（找不到回傳 undefined）。 */
export function stickerSvg(pack: string, id: string): string | undefined {
  return STICKER_PACKS[pack]?.[id]?.svg;
}

/** 把 SVG 轉為可放進 `<img src>` 的 data URI。 */
export function svgToDataUri(svgText: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svgText)}`;
}
