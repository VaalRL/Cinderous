// 引導 relay 的滾動 uptime 計數（ADR-0350）。
//
// ## 為什麼要把這幾個數字抽出來
//
// 原本它們是 `health-check.ts` 裡的兩個常數：
//
//     const UPTIME_MIN_SAMPLES = 12;
//     const UPTIME_CAP = 720; // 滾動窗上限（≈30 天/時）
//
// 那句註解「≈30 天/時」把**探測頻率**綁進了一個沒有標示頻率的數字裡。而排程從
// 每小時改成每 6 小時之後，720 次就不再是 30 天，而是 180 天——**註解會過期，
// 數字不會自己更新**。
//
// 更糟的是：原本的「每小時」本來就不是真的。實測連續兩次自動提交的間隔是 2～5 小時
// 不等（GitHub 對公開 repo 的排程工作會延遲甚至丟棄，而 `0 * * * *` 是最壅塞的時段），
// 實際約 7 次/天而非 24 次 ⇒ 720 次其實已經是 ≈100 天了。**設計與現實差了三倍，
// 而沒有任何地方會發現。**
//
// 所以這裡把「每天幾次 × 幾天」寫成算式，讓窗口長度從頻率推導出來，並用測試把
// 兩者的關係釘住。改頻率時，唯一要改的是 `PROBES_PER_DAY`。

/**
 * 排程頻率（次/天）。**必須與 `.github/workflows/relay-health.yml` 的 cron 一致**
 * ——`relay/bootstrap/uptime.test.ts` 會讀那個檔案來驗證，改一邊沒改另一邊＝測試紅。
 */
export const PROBES_PER_DAY = 4; // cron: "17 */6 * * *"

/** 滾動窗長度（天）。分級收錄（ADR-0092）看的是「最近一個月的可用率」。 */
export const UPTIME_WINDOW_DAYS = 30;

/** 滾動窗上限（次）。到頂即折半，保留比例、遺忘遠古。 */
export const UPTIME_CAP = PROBES_PER_DAY * UPTIME_WINDOW_DAYS;

/**
 * 判定 uptime 所需的最少樣本數：**兩天**。
 *
 * 少於此數即回 `undefined`（＝資料不足，維持試用）。兩天足以讓「裝好就掛掉」的節點
 * 現形，又不會讓一座真的穩定的新節點等太久才被收錄。
 */
export const UPTIME_MIN_SAMPLES = PROBES_PER_DAY * 2;

/** 每座 relay 的滾動 uptime 計數（維護者工具狀態；非伺服器狀態）。 */
export interface UptimeRec {
  probes: number;
  live: number;
}

/**
 * 記一次探測結果，回傳新的計數。
 *
 * 超過上限即**兩者同時折半**——保留可用率的比例，但讓遠古紀錄的權重衰減，
 * 使一座修好的節點不必用同樣長的時間才洗得掉舊污點。
 */
export function recordProbe(rec: UptimeRec, live: boolean, cap = UPTIME_CAP): UptimeRec {
  let probes = rec.probes + 1;
  let liveCount = rec.live + (live ? 1 : 0);
  // 迴圈而非單次：頻率調降後既有計數可能遠高於新上限（例如 448 對 120），
  // 單次折半要好幾輪才收斂，期間的窗口長度是錯的。
  while (probes > cap) {
    probes = Math.round(probes / 2);
    liveCount = Math.round(liveCount / 2);
  }
  return { probes, live: liveCount };
}

/** 可用率（%）；樣本不足回 `undefined`（＝未知，收錄邏輯據此維持試用）。 */
export function uptimePct(rec: UptimeRec, minSamples = UPTIME_MIN_SAMPLES): number | undefined {
  return rec.probes >= minSamples ? (rec.live / rec.probes) * 100 : undefined;
}
