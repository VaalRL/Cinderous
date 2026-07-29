// 送出圖片的中繼資料清除（ADR-0273）。
//
// ## 為什麼要有這支
//
// 在此之前，送檔路徑是**原檔位元組直送**——傳一張照片會連 GPS 座標、拍攝時間、裝置型號
// 一併送出。這與本專案藏元資料的整個立場（Gift Wrap 藏寄件者、presence jitter、
// 威脅情報純本地比對）**直接衝突**：訊息內容加密了，照片卻把你在哪拍的交出去。
//
// ## 為什麼是 canvas 重編碼而不是解析 EXIF
//
// canvas 只保留**像素**——所有中繼資料（EXIF／XMP／IPTC／各家私有 MakerNote）隨編碼一起消失，
// 不必去信任某個 EXIF 解析器有沒有漏掉哪個私有欄位。順帶把大圖壓小（記憶體、頻寬、
// P2P 傳輸時間、離線信箱配額一併受益）。
//
// ## 刻意的例外
//
// - **GIF 不動**：重編碼會把動畫壓成單張，而 ADR-0222 明確支援動畫 GIF。
// - **SVG 不動**：可執行標記，不餵 canvas（同 ADR-0102 的既有理由）。
// - **非圖片不動**：PDF 等無法安全重寫。
// - **失敗即原樣送出**：不因為清不掉中繼資料就讓使用者送不出檔案（可用性優先）。

import { isSanitizable, SEND_MAX_EDGE, SEND_QUALITY } from "./storage/types.js";

/** 重編碼後的結果；`changed=false` 代表原樣返回（不適用或失敗）。 */
export interface SanitizedImage {
  bytes: Uint8Array;
  mime: string;
  changed: boolean;
}

/** data URL → 位元組（canvas.toDataURL 的輸出恆為 base64）。 */
function dataUrlToBytes(url: string): Uint8Array | null {
  const at = url.indexOf(",");
  if (at < 0) return null;
  try {
    const bin = atob(url.slice(at + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * 清除圖片中繼資料並限制尺寸（ADR-0273）。
 *
 * 不適用（GIF／SVG／非圖片）、無 DOM、或任何解碼／編碼失敗時，**原樣返回**
 * （`changed:false`）——送不出檔案比送出含 GPS 的檔案更糟的情境並不存在，
 * 但「因為清不掉就整個擋下」會讓使用者連正常檔案都傳不了。
 */
export async function sanitizeImage(bytes: Uint8Array, mime: string): Promise<SanitizedImage> {
  const asis: SanitizedImage = { bytes, mime, changed: false };
  if (!isSanitizable(mime)) return asis;
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return asis;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  } catch {
    return asis; // 格式異常／解碼失敗
  }
  try {
    const scale = Math.min(1, SEND_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return asis;
    ctx.fillStyle = "#ffffff"; // 透明底轉 JPEG 會變黑（同縮圖路徑）
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", SEND_QUALITY);
    const out = dataUrlToBytes(url);
    if (!out || out.length === 0) return asis;
    return { bytes: out, mime: "image/jpeg", changed: true };
  } catch {
    return asis;
  } finally {
    bitmap.close();
  }
}

/**
 * 檔名配合重編碼後的格式改副檔名（`IMG_1234.heic` → `IMG_1234.jpg`）；
 * 未變更則原樣返回。避免收件端看到 `.png` 卻是 JPEG 位元組。
 */
export function sanitizedFileName(name: string, changed: boolean): string {
  if (!changed) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.jpg`;
}
