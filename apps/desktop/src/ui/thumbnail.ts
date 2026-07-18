// 圖片縮圖產生（ADR-0102）：把圖片縮到小尺寸的衍生預覽圖，供相簿與聊天內嵌縮圖**跨 session 存活**。
//
// 重要界線：這**不是**在保存檔案本身（ADR-0093 的裁示不變）——原檔位元組依然不落地，
// 收到的檔案仍是另存到使用者選定路徑。縮圖只是一張幾十 KB 的預覽圖。
//
// 政策常數（尺寸/品質/上限/允許 mime）一律取自 @cinderous/engine，避免桌面與行動端各自漂移。

import { isThumbnailable, THUMB_MAX_BYTES, THUMB_MAX_EDGE, THUMB_QUALITY } from "@cinderous/engine";

/**
 * 由圖片位元組產生縮圖 data URL；不是可縮圖的 mime、解碼失敗、或超過上限時回 null
 * （寧可沒縮圖，也不讓儲存膨脹）。
 */
export async function makeThumbnail(bytes: Uint8Array, mime: string): Promise<string | null> {
  if (!isThumbnailable(mime)) return null;
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return null;

  const blob = new Blob([bytes as BlobPart], { type: mime });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null; // 壞圖/不支援的編碼：不產縮圖，不讓它變成錯誤
  }

  try {
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // 透明底（PNG）轉 JPEG 會變黑 → 先鋪白底。
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", THUMB_QUALITY);
    return url.length > THUMB_MAX_BYTES ? null : url;
  } finally {
    bitmap.close();
  }
}
