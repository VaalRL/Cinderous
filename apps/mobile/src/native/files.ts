// 行動端檔案平台縫（ADR-0100）：選檔與收檔另存。
//
// 這是**唯一**碰平台 API 的地方——UI 只呼叫這兩個函式，不直接碰 DOM。
// 目前行動端跑在 react-native-web（DOM），故用 <input type="file"> 與瀏覽器下載實作。
// 移植到真正的 React Native 時只需換掉本檔內部：
//   - pickFile  → expo-document-picker（或 react-native-document-picker）
//   - saveFile  → expo-file-system + Sharing
// 介面與呼叫端皆不變（比照桌面的 native/save-file.ts）。

import type { OutgoingFile } from "@cinderous/core";
import { isThumbnailable, THUMB_MAX_BYTES, THUMB_MAX_EDGE, THUMB_QUALITY } from "@cinderous/engine";

/** 讓使用者選一個檔案；取消回 null。 */
export async function pickFile(): Promise<OutgoingFile | null> {
  if (typeof document === "undefined") return null;
  return await new Promise<OutgoingFile | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";
    input.onchange = () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) {
        resolve(null);
        return;
      }
      void f.arrayBuffer().then((buf) =>
        resolve({ name: f.name, mime: f.type || "application/octet-stream", bytes: new Uint8Array(buf) }),
      );
    };
    // 使用者取消時 change 不會觸發；靠 cancel 事件收尾（不支援的瀏覽器就讓它留著，無害）。
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * 由圖片位元組產生縮圖 data URL（ADR-0102）——衍生的小預覽圖，**不是原檔**（原檔位元組仍不保存）。
 * 政策常數取自 @cinderous/engine，與桌面同一份，不會漂移。
 * 移植真 RN：改用 expo-image-manipulator（介面不變）。
 */
export async function makeThumbnail(bytes: Uint8Array, mime: string): Promise<string | null> {
  if (!isThumbnailable(mime)) return null;
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  } catch {
    return null;
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
    ctx.fillStyle = "#ffffff"; // 透明底轉 JPEG 會變黑
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", THUMB_QUALITY);
    return url.length > THUMB_MAX_BYTES ? null : url;
  } finally {
    bitmap.close();
  }
}

/** 收檔另存（ADR-0093：App 不保管位元組）。回傳可再下載的 URL；無 DOM 時回 null。 */
export function saveFile(name: string, mime: string, bytes: Uint8Array): string | null {
  if (typeof document === "undefined") return null;
  const blob = new Blob([bytes as BlobPart], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}
