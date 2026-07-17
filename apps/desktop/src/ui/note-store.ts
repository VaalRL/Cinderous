// 便條（ADR-0182）：右欄輔助區的「便條」分頁——**每對話一張私人便條**，純本機、不廣播、不上雲。
// 依對話 id 命名空間存 localStorage（與 chatbg 等本機 UI 偏好同一類）。純函式，可測。
//
// 「計算」是便條的功能之一（ADR-0097）：便條內容最後一行若是算式，面板即時算出結果、可插回對話。

const PREFIX = "nb.note.";

/** 讀某對話的便條；缺失/不可用回空字串。 */
export function loadNote(convoId: string): string {
  try {
    return localStorage.getItem(PREFIX + convoId) ?? "";
  } catch {
    return "";
  }
}

/** 寫某對話的便條；空字串＝清除（不留空鍵）。 */
export function saveNote(convoId: string, text: string): void {
  try {
    if (text) localStorage.setItem(PREFIX + convoId, text);
    else localStorage.removeItem(PREFIX + convoId);
  } catch {
    /* 配額或不可用時忽略 */
  }
}
