// UI 尺寸（ADR-0253）：五檔縮放，裝置層偏好（nb.uiScale）。
// - Tauri：原生 `webview.setZoom()`（Chromium 瀏覽器級縮放）——座標系不變，拖曳/縮放把手零校正。
// - 瀏覽器版：退 CSS `zoom`（根元素）——viewport 座標（clientX）與縮放後的版面 px 差一個係數，
//   拖曳數學需除以 `cssZoomFactor()`（useFloatingWindow／對話視窗縮放把手已套用）。
import { isTauri } from "@tauri-apps/api/core";

export const UI_SCALE_KEY = "nb.uiScale";

/** 可選檔位（90%–150%；1＝預設）。離散檔位而非滑桿：可測、好復現、避免奇異值。 */
export const UI_SCALE_STEPS = [0.9, 1, 1.15, 1.3, 1.5] as const;

/** 目前儲存的 UI 尺寸；非法/未設＝1。 */
export function getUiScale(): number {
  try {
    const v = Number(localStorage.getItem(UI_SCALE_KEY));
    if ((UI_SCALE_STEPS as readonly number[]).includes(v)) return v;
  } catch {
    /* localStorage 不可用時忽略 */
  }
  return 1;
}

/** 套用縮放（不落地）：Tauri 走原生 setZoom、瀏覽器走根元素 CSS zoom。 */
export async function applyUiScale(scale: number): Promise<void> {
  if (isTauri()) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(scale);
    } catch {
      /* 核心不支援 setZoom 時靜默（設定仍落地，升級後生效） */
    }
    return;
  }
  // CSS zoom（Chromium/WebKit/Firefox 126+ 皆已標準化）；1＝清掉屬性完全無痕。
  const st = document.documentElement.style as CSSStyleDeclaration & { zoom: string };
  st.zoom = scale === 1 ? "" : String(scale);
  // 視口單位校正（審查修正）：CSS zoom 不會縮放 vh——版面高度吃 `--viewport-h: 100vh`，
  // 90% 檔位時 .deck 只有視窗的 90% 高（底部露出空白）、放大檔位則溢出捲軸。
  // 以 calc(100vh / zoom) 覆寫還原「佔滿視窗」語意；Tauri 走原生縮放無此問題（且其
  // 自繪外框另管 --viewport-h，本分支僅瀏覽器會執行、不互踩）。
  if (scale === 1) st.removeProperty("--viewport-h");
  else st.setProperty("--viewport-h", `calc(100vh / ${scale})`);
}

/** 設定並套用（落地為裝置偏好）。 */
export async function setUiScale(scale: number): Promise<void> {
  const v = (UI_SCALE_STEPS as readonly number[]).includes(scale) ? scale : 1;
  try {
    if (v === 1) localStorage.removeItem(UI_SCALE_KEY);
    else localStorage.setItem(UI_SCALE_KEY, String(v));
  } catch {
    /* 忽略 */
  }
  await applyUiScale(v);
}

/**
 * 拖曳數學的校正係數：滑鼠座標（viewport px）→ 縮放後版面 px 需除以此值。
 * Tauri＝1（原生縮放不影響座標對映）；瀏覽器＝目前 CSS zoom 檔位。
 */
export function cssZoomFactor(): number {
  return isTauri() ? 1 : getUiScale();
}
