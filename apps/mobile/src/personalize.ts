// 行動端本地個人化（ADR-0077／0134）：每對話背景純存 localStorage，**不廣播**、不進 Nostr
// 事件、不進雲端快照或備份——與桌面同一套隱私性質。型別/預設/CSS 產生共用 @cinderous/theme。
//
// 鍵與桌面同前綴（`nb.chatbg.<id>`），但各存各的裝置：背景是本機偏好，不隨帳號同步。
// react-native-web 有 DOM localStorage；上真正 React Native 時換 AsyncStorage，介面不變。

import { CHATBG_PREFIX, type ChatBg } from "@cinderous/theme";

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 讀某對話的背景；未設或壞值回 null。 */
export function getChatBg(id: string): ChatBg | null {
  const raw = lsGet(CHATBG_PREFIX + id);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as ChatBg;
    if ((o?.type === "preset" || o?.type === "image") && typeof o.value === "string") return o;
  } catch {
    /* 忽略壞值 */
  }
  return null;
}

/** 設某對話的背景；配額超限等失敗回 false（供上層提示）。 */
export function setChatBg(id: string, bg: ChatBg): boolean {
  try {
    localStorage.setItem(CHATBG_PREFIX + id, JSON.stringify(bg));
    return true;
  } catch {
    return false;
  }
}

/** 清除某對話的背景（回預設面板色）。 */
export function removeChatBg(id: string): void {
  try {
    localStorage.removeItem(CHATBG_PREFIX + id);
  } catch {
    /* 忽略 */
  }
}
