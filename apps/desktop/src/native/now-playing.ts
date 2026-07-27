// 正在聽自動偵測（ADR-0252）：Tauri 專用——Rust 端 GSMTC 讀系統媒體工作階段，
// 純本機查詢、零網路。瀏覽器無此能力（navigator.mediaSession 只能發布自己的播放資訊，
// 讀不到系統/其他分頁）→ 一律 null，UI 據此不顯示切換鈕。
import { invoke, isTauri } from "@tauri-apps/api/core";

/** 目前播放中的曲目（「演出者 — 曲名」）；無播放／暫停／非 Tauri／失敗＝null。 */
export async function detectNowPlaying(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return ((await invoke("now_playing_detect")) as string | null) ?? null;
  } catch {
    return null;
  }
}

/** 自動偵測開關的裝置層儲存鍵（偵測是「這台裝置在播什麼」→ 裝置偏好、不隨身分）。 */
export const NP_AUTO_KEY = "nb.npAuto";

/** 自動偵測是否開啟（opt-in，預設關——自動廣播聽歌內容是新的隱私面，ADR-0252）。 */
export function npAutoEnabled(): boolean {
  try {
    return localStorage.getItem(NP_AUTO_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNpAutoEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(NP_AUTO_KEY, "1");
    else localStorage.removeItem(NP_AUTO_KEY);
  } catch {
    /* localStorage 不可用時忽略 */
  }
}
