// 貼圖編輯器的筆劃模型（ADR-0033）：純資料 + 純函式，React 元件只是薄殼。
//
// 輸出為 256×256 viewBox 的 SVG；產物必須通過 validateStickerSvg
// （sticker-editor-model.test.ts 釘住此不變式），再走 ADR-0032 管線入庫。

/** 畫布邏輯尺寸（viewBox 邊長）。 */
export const CANVAS_SIZE = 256;

/** 取樣最小距離（邏輯座標）：小於此距離的 pointer 移動不記點。 */
export const MIN_SAMPLE_DISTANCE = 1.5;

export interface Stroke {
  color: string;
  width: number;
  points: ReadonlyArray<readonly [number, number]>;
}

export interface EditorState {
  /** 底圖（已通過驗證的貼圖 SVG）；編輯自製貼圖時嵌入輸出最底層。 */
  base?: string | undefined;
  strokes: Stroke[];
  /** 被 undo 掉、可 redo 的筆劃（新筆劃會清空）。 */
  undone: Stroke[];
}

export function emptyEditor(base?: string): EditorState {
  return { base, strokes: [], undone: [] };
}

/** 距離門檻取樣：夠遠才收點，維持 path 資料量小。 */
export function appendPoint(
  points: ReadonlyArray<readonly [number, number]>,
  x: number,
  y: number,
): ReadonlyArray<readonly [number, number]> {
  const r = (n: number) => Math.round(n * 10) / 10;
  const last = points[points.length - 1];
  if (last && Math.hypot(x - last[0], y - last[1]) < MIN_SAMPLE_DISTANCE) return points;
  return [...points, [r(x), r(y)]];
}

export function addStroke(state: EditorState, stroke: Stroke): EditorState {
  if (stroke.points.length === 0) return state;
  return { ...state, strokes: [...state.strokes, stroke], undone: [] };
}

export function undo(state: EditorState): EditorState {
  const last = state.strokes[state.strokes.length - 1];
  if (!last) return state;
  return { ...state, strokes: state.strokes.slice(0, -1), undone: [...state.undone, last] };
}

export function redo(state: EditorState): EditorState {
  const last = state.undone[state.undone.length - 1];
  if (!last) return state;
  return { ...state, strokes: [...state.strokes, last], undone: state.undone.slice(0, -1) };
}

export function clearStrokes(state: EditorState): EditorState {
  if (state.strokes.length === 0) return state;
  return { ...state, strokes: [], undone: [] };
}

/**
 * 筆劃 → path `d`：二次貝茲中點平滑；單點退化為零長度線段
 * （配合 stroke-linecap:round 呈現圓點）。
 */
export function strokeToPath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return "";
  const [x0, y0] = points[0]!;
  if (points.length === 1) return `M${x0} ${y0}l0 0`;
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    const mx = Math.round(((cx + nx) / 2) * 10) / 10;
    const my = Math.round(((cy + ny) / 2) * 10) / 10;
    d += `Q${cx} ${cy} ${mx} ${my}`;
  }
  const [lx, ly] = points[points.length - 1]!;
  d += `L${lx} ${ly}`;
  return d;
}

function strokeElement(s: Stroke): string {
  return (
    `<path d="${strokeToPath(s.points)}" fill="none" stroke="${s.color}" ` +
    `stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** 嵌套底圖的開頭標籤：剝除原 width/height 後統一為畫布尺寸（避免屬性重複）。 */
function normalizeBase(base: string): string {
  return base.replace(/^<svg([^>]*)>/i, (_m, attrs: string) => {
    const rest = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    return `<svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}"${rest}>`;
  });
}

/** 序列化為貼圖 SVG；底圖以嵌套 <svg> 原樣置於最底層（ADR-0033）。 */
export function serializeEditor(state: EditorState): string {
  const base = state.base ? normalizeBase(state.base) : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">` +
    base +
    state.strokes.map(strokeElement).join("") +
    `</svg>`
  );
}
