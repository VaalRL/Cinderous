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

/** 每座 relay 的滾動 uptime 紀錄（維護者工具狀態；非伺服器狀態）。 */
export interface UptimeRec {
  /**
   * 最近若干次探測的結果，**舊的在最前面**：`"1"`＝存活、`"0"`＝失敗。長度 ≤ `UPTIME_CAP`。
   *
   * 為什麼是一串字元而不是兩個計數，見 `recordProbe`。
   */
  window: string;
}

/** 檔案裡可能出現的舊形（ADR-0350 初版）：只有兩個累計數字。 */
interface LegacyRec {
  probes: number;
  live: number;
}

/**
 * 記一次探測結果，回傳新的紀錄：**append 一格、從最舊的那端擠掉多的**。
 *
 * ## 為什麼不是「兩個計數，滿了就折半」（ADR-0360）
 *
 * 初版是 `{probes, live}`，超過上限時兩者同時折半，註解說那是「讓遠古紀錄的權重衰減，
 * 使一座修好的節點不必用同樣長的時間才洗得掉舊污點」。
 *
 * 🔴 **折半根本沒有讓任何東西衰減。** 同時折半保留的是**比例**——120/119 折半之後是
 * 61/60，那一次失敗原封不動地還在裡面，而且因為樣本數變小，它在比例裡的**份量反而變重**
 * （0.83% → 1.64%）。唯一真的發生的事情是精度變粗，於是 99% 那道懸崖被反覆跨過：
 *
 * ```text
 *   89 次探測、1 次失敗（實測值）→ 之後每一次都成功：
 *     第  11 次後  100/99   99.00%  → weight 2
 *     第  32 次後   61/60   98.36%  → weight 1   ← 折半，同一段歷史，相反的判決
 *     第  71 次後  100/99   99.00%  → weight 2
 *     第  92 次後   61/60   98.36%  → weight 1
 *     …永遠如此
 * ```
 *
 * 一座**連續 300 次探測全部成功**的 relay，會每五天被降級一次，原因是三個月前的一次逾時。
 * 而降級的後果是整個容錯拓樸長時間只剩一座正常權重的錨點——那正是第二座錨點存在的理由。
 *
 * 真正的滑動視窗才做得到當初想要的事：失敗**滿 30 天就真的消失**，而且判決只取決於
 * 「最近 30 天發生過什麼」，與「現在處在折半週期的哪一段」無關。
 *
 * 代價是狀態檔變大：每座 relay 從兩個數字變成 `UPTIME_CAP` 個字元（120 bytes）。
 * 那是一個住在 git 分支上、只有維護者工具會讀的檔案，這點大小不構成理由。
 */
export function recordProbe(rec: UptimeRec, live: boolean, cap = UPTIME_CAP): UptimeRec {
  const w = rec.window + (live ? "1" : "0");
  return { window: w.length > cap ? w.slice(w.length - cap) : w };
}

/** 可用率（%）；樣本不足回 `undefined`（＝未知，收錄邏輯據此維持試用）。 */
export function uptimePct(rec: UptimeRec, minSamples = UPTIME_MIN_SAMPLES): number | undefined {
  const n = rec.window.length;
  if (n < minSamples) return undefined;
  let ok = 0;
  for (const c of rec.window) if (c === "1") ok += 1;
  return (ok / n) * 100;
}

/**
 * 把檔案裡讀到的一筆轉成 `UptimeRec`，**含舊形遷移**。
 *
 * 舊形只留下「總共探測幾次、其中幾次存活」，失敗**發生在什麼時候是查不回來的**。
 * 所以這裡把失敗**均勻散佈**在視窗裡：擠在最舊那端等於假裝「早就修好了」，
 * 擠在最新那端等於假裝「剛剛才壞」，兩者都是在編造我們沒有的資訊。均勻是唯一
 * 不偏袒任何一邊的重建方式，而且三十天內它們本來就會全部滑出去。
 */
export function toRec(raw: UptimeRec | LegacyRec | undefined, cap = UPTIME_CAP): UptimeRec {
  if (raw === undefined) return { window: "" };
  if ("window" in raw) return { window: raw.window.slice(-cap) };
  const probes = Math.max(0, Math.floor(raw.probes));
  if (probes === 0) return { window: "" };
  const n = Math.min(probes, cap);
  const ok = Math.min(n, Math.max(0, Math.round((raw.live / probes) * n)));
  const bad = n - ok;
  // Bresenham：把 `bad` 個 "0" 平均撒進 n 格裡。
  //
  // ⚠ 累加器要從**半個相位**起跳。從 0 起跳的話，單一失敗會落在**最後一格**——也就是
  // 「假裝剛剛才壞」，正是這個函式的註解說要避免的那一端。實測抓到：遷移 89/88 那筆時，
  // 那個 `0` 被放到了視窗尾端，於是它要花滿滿一個窗口才洗得掉，而不是從中間開始滑出去。
  const out: string[] = [];
  let acc = Math.floor(n / 2);
  for (let i = 0; i < n; i += 1) {
    acc += bad;
    if (acc >= n) {
      acc -= n;
      out.push("0");
    } else {
      out.push("1");
    }
  }
  return { window: out.join("") };
}

/**
 * 把讀到的歷史檔內容轉成計數表——**檔案不存在不等於空歷史**。
 *
 * 🔴 空歷史的後果不是「少一點資訊」，是**降級並發佈**：`uptimePct` 樣本不足回
 * `undefined` ⇒ `evaluateAdmission` 把**正式收錄**的 relay 判成試用（`accepting: false`）
 * ⇒ `health-check.ts` 把降級後的清單寫回 `relays.json`；維護者若帶著 `MAINTAINER_NSEC`
 * 在本機跑，還會順手**簽章並發佈**出去。
 *
 * ADR-0350 已對 CI 立下規則：「狀態分支存在就必須讀成功，否則整個 job 失敗」。
 * 本機這條路徑的後果一模一樣（而且多了簽章那一步），所以套用同一條規則——
 * 遷移完成後 main 裡不再有種子檔，這個守衛就是唯一攔在「檔案不在」與
 * 「安靜地把全體 relay 降級」之間的東西。
 *
 * @param raw 檔案內容；`undefined` 代表**檔案不存在**（其他讀取錯誤請讓它往上拋）。
 * @param coldStart 明示允許從零開始（`RELAY_HEALTH_COLD_START=1`）。
 */
export function historyOrThrow(raw: string | undefined, coldStart = false): Record<string, UptimeRec> {
  if (raw === undefined) {
    if (!coldStart) {
      throw new Error(
        [
          "找不到 relay/bootstrap/health-history.json。",
          "",
          "滾動 uptime 狀態住在 `relay-health-state` 分支（ADR-0350），不在 main。先取回：",
          "  git fetch origin relay-health-state",
          "  git show FETCH_HEAD:health-history.json > relay/bootstrap/health-history.json",
          "",
          "空歷史會讓正式收錄的 relay 被判成試用、寫回 relays.json（帶金鑰時還會簽章發佈），",
          "所以這裡不把「檔案不在」默默當成「沒有紀錄」。",
          "真的要從零開始（狀態分支本身還不存在）請設 RELAY_HEALTH_COLD_START=1。",
        ].join("\n"),
      );
    }
    console.warn("⚠ RELAY_HEALTH_COLD_START：沒有 uptime 歷史，所有 relay 這一輪都會被判為試用。");
    return {};
  }
  // 解析失敗照樣往上拋：壞掉的狀態和不存在的狀態後果相同，不該靜默吞掉。
  const parsed = JSON.parse(raw) as Record<string, UptimeRec | LegacyRec>;
  // 逐筆過 `toRec`：狀態檔裡可能還是舊形（ADR-0360 遷移），讀進來就統一。
  return Object.fromEntries(Object.entries(parsed).map(([url, rec]) => [url, toRec(rec)]));
}
