// 自繪標題列按鈕設定（ADR-0150，模型 v2 於 ADR-0151）：左右兩條按鈕帶，⚙ 設定鈕也是
// 可拖的一顆控制項；`autoHide`＝平時隱藏、滑鼠碰到標題列才顯示。
// 設定存 localStorage（純本地 UI 偏好，不上雲、不隨快照）；解析永遠回有效值——
// 設定損壞時視窗仍要有可用的關閉鈕，這裡不能丟例外。v1（side/order）自動遷移。

export type ControlId = "settings" | "min" | "max" | "close";

export interface TitlebarControls {
  /** 標題列左端的按鈕（由左至右）。 */
  left: ControlId[];
  /** 標題列右端的按鈕（由左至右）。 */
  right: ControlId[];
  /** 平時隱藏按鈕，滑鼠移到標題列才顯示（ADR-0151）。 */
  autoHide: boolean;
}

export const CONTROL_IDS: readonly ControlId[] = ["settings", "min", "max", "close"];

/** 缺漏補回時各控制項的預設帶：⚙ 靠左（Telegram 風），視窗控制靠右（Windows 慣例）。 */
const DEFAULT_SIDE: Record<ControlId, "left" | "right"> = { settings: "left", min: "right", max: "right", close: "right" };

export const DEFAULT_TITLEBAR_CONTROLS: TitlebarControls = {
  left: ["settings"],
  right: ["min", "max", "close"],
  autoHide: false,
};

/** localStorage 鍵。 */
export const TITLEBAR_CONTROLS_KEY = "nb.titlebarControls";

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
    const v = JSON.parse(raw) as { side?: unknown; order?: unknown; left?: unknown; right?: unknown; autoHide?: unknown };
    if (typeof v !== "object" || v === null) return DEFAULT_TITLEBAR_CONTROLS;
    const seen = new Set<ControlId>();
    let left: ControlId[];
    let right: ControlId[];
    if (v.left !== undefined || v.right !== undefined) {
      left = scanStrip(v.left, seen);
      right = scanStrip(v.right, seen);
    } else {
      // v1 遷移：order 放在原本的 side；當時尚無 ⚙ → 明確補到**對側**（避免擠在視窗控制旁）。
      const order = scanStrip(v.order, seen);
      const opposite: ControlId[] = [];
      left = v.side === "left" ? order : opposite;
      right = v.side === "left" ? opposite : order;
      if (!seen.has("settings")) {
        seen.add("settings");
        opposite.push("settings");
      }
    }
    for (const id of CONTROL_IDS) {
      if (seen.has(id)) continue;
      (DEFAULT_SIDE[id] === "left" ? left : right).push(id);
    }
    return { left, right, autoHide: v.autoHide === true };
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
