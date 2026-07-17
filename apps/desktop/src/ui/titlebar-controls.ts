// 自繪標題列按鈕設定（ADR-0150，模型 v2 於 ADR-0151）：左右兩條按鈕帶，⚙ 設定鈕也是
// 可拖的一顆控制項；`autoHide`＝平時隱藏、滑鼠碰到標題列才顯示。
// 設定存 localStorage（純本地 UI 偏好，不上雲、不隨快照）；解析永遠回有效值——
// 設定損壞時視窗仍要有可用的關閉鈕，這裡不能丟例外。v1（side/order）自動遷移。

export type ControlId = "settings" | "min" | "max" | "close";

/**
 * 標題列按鈕風格（ADR-0167）：外框按鈕的視覺呈現。
 * - `flat`：簡約現代扁平（ADR-0150 原樣，方形、close 懸停轉紅）
 * - `rounded`：圓角按鈕（懸停底色為圓角膠囊）
 * - `mac`：紅黃綠交通燈圓點（macOS 風；close 紅、min 黃、max 綠、⚙ 灰）
 * - `compact`：較小、低調（適合窄視窗）
 */
export type TitlebarStyle = "flat" | "rounded" | "mac" | "compact";
export const TITLEBAR_STYLES: readonly TitlebarStyle[] = ["flat", "rounded", "mac", "compact"];
export const DEFAULT_TITLEBAR_STYLE: TitlebarStyle = "flat";

export interface TitlebarControls {
  /** 標題列左端的按鈕（由左至右）。 */
  left: ControlId[];
  /** 標題列右端的按鈕（由左至右）。 */
  right: ControlId[];
  /** 平時隱藏按鈕，滑鼠移到標題列才顯示（ADR-0151）。 */
  autoHide: boolean;
  /** 按鈕風格（ADR-0167）；未設＝flat。 */
  style: TitlebarStyle;
}

export const CONTROL_IDS: readonly ControlId[] = ["settings", "min", "max", "close"];

/** 預設（ADR-0152 修正）：⚙ 貼在最小化左側，與視窗控制同一條右帶（Windows 慣例）。 */
export const DEFAULT_TITLEBAR_CONTROLS: TitlebarControls = {
  left: [],
  right: ["settings", "min", "max", "close"],
  autoHide: false,
  style: DEFAULT_TITLEBAR_STYLE,
};

/** 依身分覆寫的儲存 suffix（ADR-0167）：實際鍵為 `nb.<pubkey>.titlebarControls` 或裝置層 `nb.titlebarControls`。 */
export const TITLEBAR_CONTROLS_SUFFIX = "titlebarControls";

function parseStyle(x: unknown): TitlebarStyle {
  return (TITLEBAR_STYLES as readonly unknown[]).includes(x) ? (x as TitlebarStyle) : DEFAULT_TITLEBAR_STYLE;
}

function isControlId(x: unknown): x is ControlId {
  return (CONTROL_IDS as readonly unknown[]).includes(x);
}

/** 掃一條帶：剔除未知/重複（`seen` 跨帶共用，左帶先掃＝左優先）。 */
function scanStrip(raw: unknown, seen: Set<ControlId>): ControlId[] {
  const out: ControlId[] = [];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (isControlId(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * 解析設定：壞 JSON／非物件 → 預設；v1（ADR-0150 `{side, order}`）遷移＝order 落在原側、
 * ⚙ 補到對側；v2 正規化＝未知剔除、跨帶去重、缺漏補回各自預設帶；autoHide 只認 `true`。
 */
export function parseTitlebarControls(raw: string | null | undefined): TitlebarControls {
  if (!raw) return DEFAULT_TITLEBAR_CONTROLS;
  try {
    const v = JSON.parse(raw) as { side?: unknown; order?: unknown; left?: unknown; right?: unknown; autoHide?: unknown; style?: unknown };
    if (typeof v !== "object" || v === null) return DEFAULT_TITLEBAR_CONTROLS;
    const style = parseStyle(v.style); // ADR-0167：按鈕風格（未知/缺 → flat）
    const seen = new Set<ControlId>();
    let left: ControlId[];
    let right: ControlId[];
    if (v.left !== undefined || v.right !== undefined) {
      left = scanStrip(v.left, seen);
      right = scanStrip(v.right, seen);
    } else {
      // v1 遷移：order 放在原本的 side；當時尚無 ⚙ → 補在該帶**最前**（貼最小化左側，ADR-0152）。
      const order = scanStrip(v.order, seen);
      left = v.side === "left" ? order : [];
      right = v.side === "left" ? [] : order;
      if (!seen.has("settings")) {
        seen.add("settings");
        (v.side === "left" ? left : right).unshift("settings");
      }
    }
    for (const id of CONTROL_IDS) {
      if (seen.has(id)) continue;
      // 缺漏補回（ADR-0152）：⚙ 補右帶最前（貼視窗控制左側）、其餘視窗控制補右帶尾。
      if (id === "settings") right.unshift("settings");
      else right.push(id);
    }
    // ADR-0152：0151 的舊預設（⚙ 獨佔左帶、右帶恰為 ─ □ ✕）視為未自訂 → 轉新預設；
    // autoHide 是獨立偏好，照舊保留。順序不同＝使用者拖過，不動。
    if (left.length === 1 && left[0] === "settings" && right.join() === "min,max,close") {
      return { ...DEFAULT_TITLEBAR_CONTROLS, autoHide: v.autoHide === true, style };
    }
    return { left, right, autoHide: v.autoHide === true, style };
  } catch {
    return DEFAULT_TITLEBAR_CONTROLS;
  }
}

export function serializeTitlebarControls(c: TitlebarControls): string {
  return JSON.stringify(c);
}

/**
 * 拖放（ADR-0151）：把 `id` 放到 `side` 帶的 `beforeId` 之前；`beforeId` 為 null 或不在該帶
 * ＝附加到帶尾。拖到自己身上 no-op。不就地改。
 */
export function placeControl(
  c: TitlebarControls,
  id: ControlId,
  side: "left" | "right",
  beforeId: ControlId | null,
): TitlebarControls {
  if (id === beforeId) return c;
  const left = c.left.filter((x) => x !== id);
  const right = c.right.filter((x) => x !== id);
  const target = side === "left" ? left : right;
  const at = beforeId ? target.indexOf(beforeId) : -1;
  if (at >= 0) target.splice(at, 0, id);
  else target.push(id);
  return { ...c, left, right };
}
