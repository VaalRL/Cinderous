// 贊助卡的「不再顯示」記憶（ADR-0089 決策 2「可關閉（dismiss 後記住）」／ADR-0258）。
//
// **依 relay 記，不依身分記**：這是「我對這一座的態度」，換身分不該讓它又冒出來；換到別座
// 才該重新問一次。純本地 UI 偏好，不含任何私密資料，故走裝置層 localStorage（同 `nb.npAuto`）
// ——刻意不進加密儲存基質，也就不會混進配對捆包/快照（ADR-0071/0072）。

const PREFIX = "nb.sponsorOff.";

/** 正規化 relay URL 為鍵：去尾斜線、小寫（`wss://X/` 與 `wss://x` 是同一座）。 */
function keyOf(relayUrl: string): string {
  return PREFIX + relayUrl.trim().replace(/\/+$/, "").toLowerCase();
}

/** 此座是否已被關閉過。 */
export function isSponsorDismissed(relayUrl: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(keyOf(relayUrl)) === "1";
  } catch {
    return false; // 讀不到就當沒關過——寧可多顯示一次，也不要因儲存故障永久隱藏
  }
}

/** 記住「這一座不再顯示」。 */
export function dismissSponsor(relayUrl: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(keyOf(relayUrl), "1");
  } catch {
    /* 配額或不可用時忽略：關閉在本次 session 仍生效（呼叫端有 state） */
  }
}
