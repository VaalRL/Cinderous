// 對話背景 token（ADR-0077 O3／0134）：預設漸層、CSS 產生器、儲存鍵——跨前端共用一份。
//
// 背景是**本地個人化**：純存 localStorage，不廣播、不進 Nostr 事件、不進雲端快照或備份
// （ADR-0077）。這裡只放**純資料與純函式**（無 DOM）；平台各自的儲存讀寫與圖片壓縮留在 app 端。

/** 對話背景：內建預設 id，或使用者上傳圖片的 data URI。 */
export type ChatBg = { type: "preset"; value: string } | { type: "image"; value: string };

/** 內建背景預設：id → CSS background 值。淡色漸層＋一組深色；訊息泡泡自帶底色故仍易讀。 */
export interface BgPreset {
  id: string;
  css: string;
}
export const BG_PRESETS: BgPreset[] = [
  { id: "sky", css: "linear-gradient(160deg,#eaf3ff,#d3e6ff)" },
  { id: "mint", css: "linear-gradient(160deg,#e9f7ef,#cfeede)" },
  { id: "dusk", css: "linear-gradient(160deg,#efe6ff,#ffe6f2)" },
  { id: "sand", css: "linear-gradient(160deg,#faf3e6,#f1e4c9)" },
  { id: "rose", css: "linear-gradient(160deg,#ffe9ec,#ffd6de)" },
  { id: "graphite", css: "linear-gradient(160deg,#2b2f38,#1c2027)" },
];
export function presetCss(id: string): string | undefined {
  return BG_PRESETS.find((p) => p.id === id)?.css;
}

/**
 * 把 ChatBg 轉成 CSS `background` **簡寫字串**（桌面用：`style={{ background }}`）。
 * 未設或壞的 preset 回 undefined（＝不套、用預設面板色）。
 */
export function chatBgCss(bg: ChatBg | null): string | undefined {
  if (!bg) return undefined;
  if (bg.type === "image") return `center / cover no-repeat url("${bg.value}")`;
  return presetCss(bg.value);
}

/**
 * 把 ChatBg 轉成**樣式物件**（行動端用：react-native-web 會把 `backgroundImage` 等原樣送進 DOM
 * inline style，包含漸層與 `url()`）。未設或壞的 preset 回 undefined。
 */
export function chatBgStyle(bg: ChatBg | null): Record<string, string> | undefined {
  if (!bg) return undefined;
  if (bg.type === "image") {
    return { backgroundImage: `url("${bg.value}")`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  const css = presetCss(bg.value);
  return css ? { backgroundImage: css } : undefined;
}

/** localStorage 鍵前綴：`nb.chatbg.<pubkey|groupId>`。桌面與行動端同一鍵，各存各的裝置。 */
export const CHATBG_PREFIX = "nb.chatbg.";
/** 背景縮圖邊長上限（px）。 */
export const CHATBG_MAX_EDGE = 900;
