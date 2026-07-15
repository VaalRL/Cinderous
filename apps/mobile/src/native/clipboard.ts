// 剪貼簿（ADR-0135）：複製備份碼等文字。平台能力收在 native/，UI 只呼叫（比照 share.ts）。
// react-native-web 有 navigator.clipboard；上真正 React Native 時換 expo-clipboard，介面不變。

/** 把文字複製到剪貼簿。回 `true`＝成功；環境不支援或失敗回 `false`（供 UI 提示）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
