// 送達與過期的判定（PRD §9／ADR-0364）。
//
// ## PRD §9 的原話
//
// > 離線留言過期的 UX 對策：7 天硬過期會造成超時未取的訊息永久消失。需於產品層面：
// > 對寄件者顯示「未送達/已過期」狀態、對長期離線者在重新上線時提示可能的訊息缺口；
// > **不得讓使用者誤以為訊息必達**。
//
// 這條寫在規格裡從未實作。`MessageStatus` 只有 `sending｜failed｜sent｜delivered｜read`
// 五態，沒有「過期」——訊息永遠停在 `sent`（＝中繼接受了），而 7 天後 Gift Wrap 被中繼
// 依 NIP-40 刪除，寄件者毫不知情。畫面上「已送中繼」與「對方已經永遠收不到了」長得一模一樣。
//
// ## 為什麼 `sent` 停太久就是沒送到
//
// 收件端一拿到訊息就**無條件**回一則 `delivered` 回條（ADR-0058 Tier 2）——它與「已讀」不同，
// **不受已讀回條開關的互惠限制**（那條只擋 `read`）。所以「過了 TTL 還停在 `sent`」
// 等價於「對方的裝置從來沒有把它取下來」。
//
// ## 為什麼文案是「可能」而不是「已過期」
//
// 有一條會誤判的路徑：對方在第 1 天收到並回了 `delivered`，但**寄件者自己離線超過 7 天**，
// 那則回條（同樣是 7 天 TTL 的 Gift Wrap）也過期了。寄件者第 9 天回來，看到的就是
// 「`sent` 且已 9 天」。
//
// 把這種情況說成「已過期」，就是用一個新的假確定性換掉舊的假確定性——而 PRD 那句話要的是
// **拿掉假確定性**，不是換一種。所以判定叫 `looksUndelivered`，文案說「可能未送達」。

import { DEFAULT_TTL_SECONDS } from "@cinderous/core";

/** 公共中繼的離線留言保存期（NIP-40，ADR-0065）：7 天。 */
export const DEFAULT_MESSAGE_TTL_MS = DEFAULT_TTL_SECONDS * 1000;

/**
 * 這則**自己送出**的訊息看起來沒送到嗎（PRD §9／ADR-0364）。
 *
 * @param m 訊息（只看 `outgoing`／`at`／`status`）。
 * @param ttlMs 這條連線的離線留言保存期；企業自架站可由名冊政策拉長（ADR-0160）。
 * @param now 現在時刻（毫秒）；可注入以利測試。
 */
export function looksUndelivered(
  m: { outgoing: boolean; at: number; status?: string },
  ttlMs = DEFAULT_MESSAGE_TTL_MS,
  now = Date.now(),
): boolean {
  // 只有自己送出的才有「對方收到了沒」可言。
  if (!m.outgoing) return false;
  // `sent`＝中繼接受了但對方沒回 delivered。其餘四態都不是這個問題：
  // `sending`／`failed` 是還沒出去或已知失敗（各有自己的顯示），
  // `delivered`／`read` 是**確定**到了。沒有 status 的是舊訊息，不臆測。
  if (m.status !== "sent") return false;
  return now - m.at > ttlMs;
}

/**
 * 這次離線久到可能漏訊了嗎（PRD §9 後半／ADR-0364）。
 *
 * 離線超過 TTL 的期間，別人傳來的 Gift Wrap 會在中繼上過期消失——**重新上線也拉不回來**。
 * 這件事沒有任何協定層的信號可言（中繼刪掉的東西不會留下痕跡），所以只能由客戶端
 * 用自己的「上次在線時刻」推論，並且**照實說成推論**。
 *
 * @returns 離線的毫秒數；沒超過門檻或沒有可用紀錄則回 `undefined`。
 */
export function offlineGapMs(
  lastOnlineAt: number | undefined,
  ttlMs = DEFAULT_MESSAGE_TTL_MS,
  now = Date.now(),
): number | undefined {
  if (lastOnlineAt === undefined || lastOnlineAt <= 0) return undefined; // 首次啟用：沒有缺口可言
  const gap = now - lastOnlineAt;
  // 時鐘倒退（改時區／校時）會算出負數——那不是缺口，是雜訊。
  return gap > ttlMs ? gap : undefined;
}
