// 由探測結果決定下一版引導 relay 清單（ADR-0353）。
//
// ## 為什麼這段要從 health-check.ts 搬出來
//
// 原本這段邏輯住在 `health-check.ts` 的 `main()` 裡——那是一支含副作用的腳本
// （讀檔、開 WebSocket、寫檔、簽章發佈），**測不到**。而它做的是整條流程裡
// 後果最重的判斷：哪些 relay 留在清單上、哪些不留。
//
// 它測不到的那段期間，裡面有一個 bug 存在了 7 週沒被發現，見下。
//
// ## 🔴 探測失敗不等於「刪掉」
//
// 舊的寫法是：
//
//     const liveOnes = results.filter((r) => r.conf.live);
//     const nextEntries = [...liveOnes 的判定結果, ...retired];
//
// 也就是說**一次 liveness 失敗，就把那座 relay 從清單上整筆刪除**。而刪掉之後
// 它不在 `entries` 裡 ⇒ 下一輪的 `active` 不含它 ⇒ **再也不會被探測，永遠回不來**。
//
// 這在探測可靠時還算合理，但探測並不可靠：`probeLive` 是**單次嘗試、8 秒逾時、
// 沒有任何重試**，逾時／連線錯誤／Cloudflare 冷啟動／worker 正在重新部署，全部
// 壓成同一個 `false`，與「這座 relay 真的死了」無法區分。
//
// never-empty 守門擋得住的是**全滅**（全部失敗就整份不動）。對「N 座裡死一座」
// 這種部分誤判，它零防護——而部分誤判才是常態。
//
// 實際後果（ADR-0353 §背景）：2026-07-29，兩座錨點之一 `jt0856` 在累積 157/158
// （99.4%）之後探測失敗一次，被永久刪除。它**至今仍在正常服務**（實測接受連線並
// 正確送出 NIP-42 AUTH 挑戰），卻從清單上消失了 7 週，沒有任何告警。
//
// 所以現在：探測失敗的座**留在 `entries` 裡**、標成不接受新分配、**繼續被探測**，
// 自己好起來就自己回來。客戶端真正拿去連的 `relays` 陣列仍然只收本輪存活的，
// 所以客戶端行為不變。
//
// 修好「不可逆」之後，「單次探測、無重試」就不再是關鍵缺陷：瞬斷造成的誤判下一輪
// 自己修正。這比加一層重試機制乾淨——重試只是降低誤判機率，不改變誤判的後果。

import { evaluateAdmission, type NodeConformance, type RelayEntry, type ResolvedRelayEntry } from "@cinderous/core";

/** 一座 relay 這一輪的探測結果。 */
export interface ProbeOutcome {
  entry: ResolvedRelayEntry;
  conf: NodeConformance;
}

/** 下一版清單，附上每座的判定理由（供呼叫端輸出 log）。 */
export interface ListDecision {
  /** 舊欄位；客戶端拿去連的就是這個 ⇒ **只收本輪存活的**。 */
  relays: string[];
  /** 營運資訊；**所有**座都在（含本輪探測失敗與 retired）。 */
  entries: RelayEntry[];
  reasons: { url: string; reasons: string[] }[];
}

/** 寫檔用的精簡形：能省的欄位就省，讓 diff 只反映真正的變化。 */
function compact(e: ResolvedRelayEntry): RelayEntry {
  return {
    url: e.url,
    ...(e.accepting ? {} : { accepting: false }),
    ...(e.weight !== 1 ? { weight: e.weight } : {}),
    ...(e.status !== "ok" ? { status: e.status } : {}),
  };
}

/**
 * 依探測結果算出下一版清單。
 *
 * @param entries 目前清單物化後的全部座（含 retired）。
 * @param results 本輪實際探測過的座（＝ entries 裡非 retired 的那些）。
 * @returns `null` 代表 **never-empty 守門**啟動——本輪無任何存活，整份清單不動。
 *   全滅通常是探測端自己壞了（網路、CI、或探測邏輯迴歸），不是全世界的 relay
 *   同時死掉；此時覆寫清單會把全體客戶端變成孤島。
 */
export function decideList(entries: ResolvedRelayEntry[], results: readonly ProbeOutcome[]): ListDecision | null {
  if (!results.some((r) => r.conf.live)) return null;

  const reasons: { url: string; reasons: string[] }[] = [];
  const decided = results.map(({ entry, conf }) => {
    // draining＝人正在手動退役，既有用戶分批撤離中；機器不插手它的欄位。
    if (entry.status === "draining") return entry;
    const d = evaluateAdmission(conf);
    reasons.push({ url: entry.url, reasons: d.reasons });
    // 不存活：保留該筆、停止分配新帳號。**weight 與 status 都原樣保留**——
    // weight 在 `accepting: false` 之下不會被 `pickRelay` 用到，留著是保住「它原本是
    // 一座 weight 2 的正式座」這個紀錄；復活時 `evaluateAdmission` 會重算，不會殘留。
    // status 保持 ok ⇒ 下一輪仍在 `active` 裡被探測，這正是它回得來的原因。
    if (!conf.live) return { ...entry, accepting: false };
    return { ...entry, accepting: d.accepting, weight: d.weight, status: "ok" as const };
  });

  return {
    relays: results.filter((r) => r.conf.live).map((r) => r.entry.url),
    entries: [...decided, ...entries.filter((e) => e.status === "retired")].map(compact),
    reasons,
  };
}
