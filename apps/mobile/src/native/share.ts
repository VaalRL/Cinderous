// 行動端圖片分享（ADR-0132）：走**原生分享選單**（Web Share API）——與其他手機 app 同一套體驗。
//
// 這是唯一碰平台 API 的地方（比照 `files.ts`）。目前跑在 react-native-web（DOM），用
// `navigator.share({ files })`——在手機瀏覽器／webview 上會叫出作業系統的分享選單。
// 移植到真正的 React Native 時換掉內部：`expo-sharing`／`Share` API，介面不變。

/**
 * 以原生分享選單分享一張圖片（ADR-0132）。
 *
 * @param src blob:／data: URL（圖片訊息已渲染的來源：本 session 原圖，或跨 session 縮圖）。
 * @returns `true`＝成功走了原生分享；`false`＝環境不支援（呼叫端可退回下載）。
 */
export async function shareImageFromUrl(src: string, name: string, mime: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare) return false;
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], name || "image", { type: blob.type || mime || "image/*" });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file] });
    return true;
  } catch {
    // 使用者取消分享也會落到這裡（AbortError）——與「不支援」一視同仁，不打擾。
    return false;
  }
}

/**
 * 退路：原生分享不可用（部分桌面瀏覽器）時，改成下載那張圖——不讓分享鈕變死路（ADR-0132）。
 *
 * UI 手上只有已渲染的 blob:／data: URL（沒有 bytes），所以直接用 anchor 觸發下載，不經 `saveFile`。
 */
export function downloadImageFromUrl(src: string, name: string): void {
  if (typeof document === "undefined" || !src) return;
  const a = document.createElement("a");
  a.href = src;
  a.download = name || "image";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
