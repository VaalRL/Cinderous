// 剪貼簿（ADR-0132）：桌面的圖片分享＝快速複製。平台能力收在這裡，UI 只呼叫。
//
// - 複製圖片：一律轉 PNG——Chromium/WebView2 的 async clipboard 只收 `image/png`；直接寫其他
//   mime 會被拒。載入來源到 canvas → `toBlob("image/png")` → `ClipboardItem`。
// - 複製路徑：純文字，`writeText`。

/** 把來源圖片（blob: 或 data: URL）轉成 PNG Blob——供剪貼簿寫入。 */
async function toPngBlob(src: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((b) => resolve(b), "image/png");
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * 把圖片複製到剪貼簿（ADR-0132）。回 `true`＝成功。
 *
 * WebView2（Windows）與 Chromium 瀏覽器可靠；WKWebView（macOS）支援較弱 → best-effort，
 * 失敗回 `false` 讓 UI 給提示（不改用額外的 Tauri 剪貼簿外掛）。
 */
export async function copyImageFromUrl(src: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    const png = await toPngBlob(src);
    if (!png) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}

/** 把文字（如檔案路徑）複製到剪貼簿（ADR-0132）。回 `true`＝成功。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!text || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
