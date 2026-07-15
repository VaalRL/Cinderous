// 本地個人化儲存（ADR-0077）：頭像／每對話背景／對話框尺寸純存 localStorage，
// 不廣播、不進 Nostr 事件、不進雲端快照或備份。圖片一律本機縮圖壓縮成 data URI。
//
// 對話背景的**純資料與純函式**（預設漸層、CSS 產生、儲存鍵、尺寸上限）自 ADR-0134 起下沉
// `@cinder/theme`，桌面與行動端共用一份。這裡沿用同一組並 re-export，桌面既有 import 不變。

import {
  BG_PRESETS,
  CHATBG_MAX_EDGE,
  CHATBG_PREFIX,
  chatBgCss,
  type ChatBg,
  presetCss,
} from "@cinder/theme";
export { BG_PRESETS, CHATBG_MAX_EDGE, chatBgCss, type ChatBg, presetCss };

const AVATAR_PREFIX = "nb.avatar.";
const CONVO_SIZE_KEY = "nb.convoSize";

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
/** 寫入；成功回 true，配額超限（QuotaExceeded）等失敗回 false 供上層提示。 */
function lsSet(key: string, val: string): boolean {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch {
    return false;
  }
}
function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

// ── 變更通知（讓 <Avatar>／背景於同分頁即時更新，免手動穿 props）──────────────
const listeners = new Set<() => void>();
let tick = 0;
/** 個人化變更序號；訂閱者以其變化觸發重繪。 */
export function personalizeTick(): number {
  return tick;
}
/** 訂閱個人化變更；回傳取消訂閱。 */
export function subscribePersonalize(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
function notify(): void {
  tick++;
  for (const l of listeners) l();
}

// ── O1 對話框尺寸（全域一個偏好）──────────────────────────────────────────────
export interface ConvoSize {
  w: number;
  h: number;
}
export function getConvoSize(): ConvoSize | null {
  const raw = lsGet(CONVO_SIZE_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as ConvoSize;
    if (typeof o?.w === "number" && typeof o?.h === "number" && o.w > 0 && o.h > 0) return o;
  } catch {
    /* 忽略壞值 */
  }
  return null;
}
export function setConvoSize(size: ConvoSize): void {
  lsSet(CONVO_SIZE_KEY, JSON.stringify({ w: Math.round(size.w), h: Math.round(size.h) }));
}

// ── O2 本地頭像：pubkey → data URI ───────────────────────────────────────────
export function getAvatar(pubkey: string): string | null {
  return lsGet(AVATAR_PREFIX + pubkey);
}
export function setAvatar(pubkey: string, dataUri: string): boolean {
  const ok = lsSet(AVATAR_PREFIX + pubkey, dataUri);
  if (ok) notify();
  return ok;
}
export function removeAvatar(pubkey: string): void {
  lsRemove(AVATAR_PREFIX + pubkey);
  notify();
}

// ── O3 每對話背景：preset id 或圖片 data URI（型別/預設/CSS 產生見 @cinder/theme）──────────
export function getChatBg(pubkey: string): ChatBg | null {
  const raw = lsGet(CHATBG_PREFIX + pubkey);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as ChatBg;
    if ((o?.type === "preset" || o?.type === "image") && typeof o.value === "string") return o;
  } catch {
    /* 忽略壞值 */
  }
  return null;
}
export function setChatBg(pubkey: string, bg: ChatBg): boolean {
  const ok = lsSet(CHATBG_PREFIX + pubkey, JSON.stringify(bg));
  if (ok) notify();
  return ok;
}
export function removeChatBg(pubkey: string): void {
  lsRemove(CHATBG_PREFIX + pubkey);
  notify();
}

/**
 * 本機縮圖（O2/O3）：讀 File → 等比縮到 maxEdge → JPEG data URI（壓縮）。
 * 需 DOM（瀏覽器/webview）；解碼或無 canvas 時 reject。
 */
export async function downscaleImage(file: File, maxEdge: number, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("無 2D 繪圖環境");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close?.();
  }
}

/** 頭像縮圖邊長上限（px）。 */
export const AVATAR_MAX_EDGE = 128;
// 背景縮圖邊長上限 CHATBG_MAX_EDGE 已下沉 @cinder/theme（上方 re-export）。
