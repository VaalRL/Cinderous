// 便條・行動端（ADR-0183）：右欄「便條」功能的行動端版——**每對話一張私人便條**，純本機、
// 不廣播、不上雲。
//
// 與桌面 `apps/desktop/src/ui/note-store.ts` 的**關鍵差異**：桌面便條是明文 localStorage；行動端
// 對本機資料一律更嚴（ADR-0112），故便條**加密落盤**——以該身分 nsec 導出金鑰 `sealValue` 封裝
// （比照離職託管 ADR-0179）。密文離開該身分 nsec 就解不開，且 nsec 本就不明文落盤，紅線不破。

import { openValue, sealValue } from "@cinder/core";

const PREFIX = "nb.note.";

/** 讀某對話的便條（以身分金鑰解密）；缺失/解不開/不可用回空字串。 */
export function loadNote(convoId: string, key: Uint8Array): string {
  try {
    if (typeof localStorage === "undefined") return "";
    const raw = localStorage.getItem(PREFIX + convoId);
    if (!raw) return "";
    return openValue(key, raw) ?? ""; // 金鑰錯回 null → 空
  } catch {
    return "";
  }
}

/** 寫某對話的便條（**加密**）；空字串＝清除（不留空鍵）。 */
export function saveNote(convoId: string, key: Uint8Array, text: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (text) localStorage.setItem(PREFIX + convoId, sealValue(key, text));
    else localStorage.removeItem(PREFIX + convoId);
  } catch {
    /* 配額或不可用時忽略 */
  }
}
