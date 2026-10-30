// 限時訊息的到期判斷（ADR-0013）。到期後畫面、清單預覽、引用、封存與搜尋都不能再露出原文，
// 桌面與行動端共用這一個定義，避免各自寫一份、其中一處漏掉（行動端曾經整個沒做，ADR-0406）。

/** 到期時刻當下就算到期（與桌面每秒掃描的 `expiresAt <= now` 一致）。 */
export function isExpired(m: { expiresAt?: number }, now: number = Date.now()): boolean {
  return m.expiresAt !== undefined && m.expiresAt <= now;
}

/** 清單預覽與封存列顯示的文字：到期 → `expiredLabel`（原文與檔名都不露）；檔案 → `📎 檔名`；否則原文。 */
export function visibleText(
  m: { text: string; file?: { name: string }; expiresAt?: number },
  expiredLabel: string,
  now: number = Date.now(),
): string {
  if (isExpired(m, now)) return expiredLabel;
  return m.file ? `📎 ${m.file.name}` : m.text;
}

/** 尚未到期的訊息中最早的到期時刻；沒有就回 undefined（不用排計時器）。 */
export function nextExpiryAt(msgs: Iterable<{ expiresAt?: number }>, now: number = Date.now()): number | undefined {
  let next: number | undefined;
  for (const m of msgs) {
    if (m.expiresAt !== undefined && m.expiresAt > now && (next === undefined || m.expiresAt < next)) next = m.expiresAt;
  }
  return next;
}
