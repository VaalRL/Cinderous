// 前向保密開關的多裝置合併（ADR-0334）。
//
// ## 原本的規則與它為什麼壞
//
// ```ts
// enabled: local.enabled || content.fs.enabled === true   // OR，沒有時間概念
// ```
//
// OR 的用意是「舊快照不得把新啟用蓋掉」——**方向是對的，但只考慮了啟用那一側**。
// 停用同樣是使用者較新的決定，卻被壓過去：
//
//   1. A 按下停用 ⇒ `enabled: false`。
//   2. B 的快照（**可取代事件，留在中繼上；B 甚至不必還在線上，可以是一支弄丟的手機**）說 `true`。
//   3. A 一重連就抓回那份快照 ⇒ OR ⇒ **又變回 true**。
//
// ⇒ 只要曾有另一台發過 `enabled: true`，**單台停用永遠回不去**，而且與同步快慢無關。
// 這與 ADR-0327 修 `cloudSync` 時遇到的是同一類錯：**分不出兩個狀態**——
// 那次是「從未設定」vs「明確關閉」，這次是「舊的啟用」vs「新的停用」。
//
// ## 規則
//
// 沿用 ADR-0242 `mergeSyncedPrefs` 的形狀（**不另發明**）：比時間戳，較新者勝。
//
// 🔴 **平手時偏向 `true`**（保留原本 OR 的安全側）：兩台在同一毫秒各按一次的機率可忽略，
// 而萬一發生，「多加密了」比「以為加密其實沒有」安全。
//
// 🔴 **沒有時間戳的一方視為更舊**：舊版快照與升級前的本機資料都沒有這個欄位，
// 若把缺省當「現在」，第一次同步就會讓舊值贏。

/** 一方的 FS 開關狀態。 */
export interface FsEnabledVote {
  enabled: boolean;
  /** 使用者最後一次改變它的時間；缺省＝比任何有時間戳的一方更舊。 */
  at?: number;
}

/**
 * 合併兩方的 FS 開關。
 *
 * @param local 本機（**通常是使用者剛剛的決定**）
 * @param remote 來自快照的另一台
 */
export function mergeFsEnabled(local: FsEnabledVote, remote: FsEnabledVote): FsEnabledVote {
  const la = local.at;
  const ra = remote.at;
  if (la !== undefined && ra !== undefined) {
    if (la !== ra) return la > ra ? local : remote;
    return local.enabled || remote.enabled ? { enabled: true, at: la } : { enabled: false, at: la };
  }
  if (la !== undefined) return local; // 只有本機表態過 ⇒ 本機贏
  if (ra !== undefined) return remote;
  // 兩邊都沒有時間戳（都還沒升級）⇒ 沿用舊行為，不在升級當下改變任何人的狀態
  return { enabled: local.enabled || remote.enabled };
}
