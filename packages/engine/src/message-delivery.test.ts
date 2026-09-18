// 送達與過期的判定（PRD §9／ADR-0364）。
//
// PRD §9 的原話：「對寄件者顯示『未送達/已過期』狀態、對長期離線者在重新上線時提示可能的
// 訊息缺口；**不得讓使用者誤以為訊息必達**。」這條寫在規格裡從未實作——`MessageStatus`
// 沒有「過期」態，訊息永遠停在 `sent`，而 7 天後 Gift Wrap 被中繼依 NIP-40 刪除，
// 寄件者毫不知情：「已送中繼」與「對方永遠收不到了」長得一模一樣。

import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_TTL_MS, looksUndelivered, offlineGapMs } from "./message-delivery.js";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const msg = (over: { at?: number; status?: string; outgoing?: boolean } = {}) => ({
  outgoing: true,
  at: NOW - DAY,
  status: "sent",
  ...over,
});

describe("looksUndelivered（PRD §9／ADR-0364）", () => {
  it("TTL 是 7 天（與 Gift Wrap 的 NIP-40 預設同一個來源）", () => {
    expect(DEFAULT_MESSAGE_TTL_MS).toBe(7 * DAY);
  });

  it("🔴 停在 `sent` 超過 TTL ＝ 對方從來沒把它取下來", () => {
    // 收件端一拿到就**無條件**回 delivered（ADR-0058 Tier 2，不受已讀回條的互惠限制），
    // 所以「過了 7 天還是 sent」等價於「沒送到」。
    expect(looksUndelivered(msg({ at: NOW - 8 * DAY }), DEFAULT_MESSAGE_TTL_MS, NOW)).toBe(true);
  });

  it("還沒到 TTL 不報（邊界：剛好等於 TTL 也不報）", () => {
    expect(looksUndelivered(msg({ at: NOW - 6 * DAY }), DEFAULT_MESSAGE_TTL_MS, NOW)).toBe(false);
    expect(looksUndelivered(msg({ at: NOW - 7 * DAY }), DEFAULT_MESSAGE_TTL_MS, NOW)).toBe(false);
    expect(looksUndelivered(msg({ at: NOW - 7 * DAY - 1 }), DEFAULT_MESSAGE_TTL_MS, NOW)).toBe(true);
  });

  it("🔴 `delivered`／`read` 永遠不報——那是**確定**到了", () => {
    for (const status of ["delivered", "read"]) {
      expect(looksUndelivered(msg({ at: NOW - 100 * DAY, status }), DEFAULT_MESSAGE_TTL_MS, NOW)).toBe(false);
    }
  });

  it("`sending`／`failed` 不報：各有自己的顯示，不要疊第二個警告", () => {
    for (const status of ["sending", "failed"]) {
      expect(looksUndelivered(msg({ at: NOW - 100 * DAY, status }), DEFAULT_MESSAGE_TTL_MS, NOW)).toBe(false);
    }
  });

  it("沒有 status 的舊訊息不臆測", () => {
    expect(looksUndelivered({ outgoing: true, at: NOW - 100 * DAY }, DEFAULT_MESSAGE_TTL_MS, NOW)).toBe(false);
  });

  it("收到的訊息不報——「對方收到了沒」只對自己送出的有意義", () => {
    expect(looksUndelivered(msg({ outgoing: false, at: NOW - 100 * DAY }), DEFAULT_MESSAGE_TTL_MS, NOW)).toBe(false);
  });

  it("🔴 企業站把保留期拉長時，門檻要跟著長——否則一直誤報「可能未送達」", () => {
    const thirtyDays = 30 * DAY;
    expect(looksUndelivered(msg({ at: NOW - 10 * DAY }), thirtyDays, NOW)).toBe(false);
    expect(looksUndelivered(msg({ at: NOW - 31 * DAY }), thirtyDays, NOW)).toBe(true);
  });
});

describe("offlineGapMs（PRD §9 後半）", () => {
  it("離線超過 TTL → 回報離線時長", () => {
    expect(offlineGapMs(NOW - 10 * DAY, DEFAULT_MESSAGE_TTL_MS, NOW)).toBe(10 * DAY);
  });

  it("沒超過就不吵（邊界：剛好等於 TTL 不報）", () => {
    expect(offlineGapMs(NOW - 3 * DAY, DEFAULT_MESSAGE_TTL_MS, NOW)).toBeUndefined();
    expect(offlineGapMs(NOW - 7 * DAY, DEFAULT_MESSAGE_TTL_MS, NOW)).toBeUndefined();
  });

  it("🔴 首次啟用沒有紀錄 → 不報：那是新裝置，不是「漏了一週」", () => {
    expect(offlineGapMs(undefined, DEFAULT_MESSAGE_TTL_MS, NOW)).toBeUndefined();
    expect(offlineGapMs(0, DEFAULT_MESSAGE_TTL_MS, NOW)).toBeUndefined();
  });

  it("時鐘倒退（改時區／校時）算出負數 → 不報，那是雜訊不是缺口", () => {
    expect(offlineGapMs(NOW + 30 * DAY, DEFAULT_MESSAGE_TTL_MS, NOW)).toBeUndefined();
  });
});
