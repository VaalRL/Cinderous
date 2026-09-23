// 中繼分片路由（ADR-0241）：從單一全域 Durable Object 到「按收件人 pubkey 前綴分片＋presence 獨立層」。
//
// 分片鍵計算是 SSOT——`shardPrefix`／`shardPath` 由 core 提供、client 與 server 共用（見 core/shard.ts），
// 避免兩端算出不同分片而訊息路由到錯的 DO。本模組只加 **server 端路由**（URL 路徑 → DO 名選擇），
// 供 worker 的 `fetch` 依 URL 選 DO。每個分片與 presence 層都是同一個 `RelayRoom` 類的獨立實例——
// 分片＝路由、DO 邏輯不變。血條：一片崩只影響其 1/16 使用者。

import { shardPrefix } from "@cinderous/core";

export { SHARD_COUNT, shardPath, shardPrefix } from "@cinderous/core"; // SSOT re-export

/** presence 獨立層的 DO 名（ADR-0241）：廣播型、單一/少數 DO。 */
export const PRESENCE_LAYER_NAME = "presence";

/** 遷移期的舊全域 DO 名（切換＋舊留言 7 天自然過期；最低版本閘前的舊客戶端仍走這裡）。 */
export const LEGACY_GLOBAL_NAME = "global";

/** 訊息分片的 DO 名（ADR-0241）：`shard-<prefix>`（前綴＝core `shardPrefix`）。 */
export function messageShardName(pubkey: string | undefined): string {
  return `shard-${shardPrefix(pubkey)}`;
}

/** 第三方應用車道的 DO 名前綴（ADR-0366）。 */
export const APP_LANE_PREFIX = "app-";

/**
 * 第三方車道的分片數（ADR-0366 §決策 3）。
 *
 * 取模是為了**上界**：車道 id 是客戶端自填的任意字串，不取模的話一個惡意客戶端
 * 用亂數字串就能生出幾百萬顆冷 DO。血條 1/8，與 ADR-0241 的 1/16 同一個思路。
 */
export const APP_LANE_SHARDS = 8;

/** 車道 id 的合法形狀：小寫英數起頭，其餘可含 `.`／`_`／`-`，最長 64。 */
const LANE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * FNV-1a（32-bit）——把車道 id 雜湊進固定數量的分片。
 *
 * 刻意用這個而不是 `crypto`：路由要**同步**（worker 的 `fetch` 在選 DO 時就要算出來），
 * 而 `crypto.subtle` 是非同步的。FNV-1a 純算術、跨平台結果一致，而且這裡不需要
 * 密碼學強度——它只決定「哪一顆 DO」，不決定任何權限。
 */
export function laneShardOf(laneId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < laneId.length; i++) {
    hash ^= laneId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % APP_LANE_SHARDS;
}

/** 車道 id → DO 名（ADR-0366）。 */
export function appLaneName(laneId: string): string {
  return `${APP_LANE_PREFIX}${laneShardOf(laneId)}`;
}

/**
 * 一次連線的路由結果（ADR-0366）。
 *
 * `profile` 同時決定**用哪一份政策**（嚴格＝Cinderous 訊息平面，寬鬆＝第三方車道），
 * 所以路由與政策是同一個決定、在同一個地方做完——分成兩處遲早會漂移成
 * 「路由到寬鬆 DO 卻套了嚴格政策」這種只在產線才看得出來的錯。
 */
export type RelayRoute =
  | { profile: "strict"; doName: string }
  | { profile: "app"; doName: string; laneId: string };

/**
 * 由請求 URL 路徑決定路由（ADR-0366 §決策 2／4）。**認不得就回 `undefined`，宿主拒絕連線。**
 *
 *  - `/s/<prefix>`（單 hex nibble）→ `shard-<prefix>`（訊息片，嚴格）
 *  - `/presence` → presence 層（嚴格）
 *  - `/`（含空字串）→ 舊全域（嚴格；ADR-0241 遷移期回退，最低版本閘前的舊客戶端仍走這裡）
 *  - `/app/<laneId>` → `app-<hash%8>`（第三方車道，寬鬆）
 *  - **其他一律 `undefined`**
 *
 * 🔴 **刻意不設預設值。** 原本是「認不得的路徑一律落到 `global`」，那讓
 * `/s/zz`、`/s/ab` 這種**算錯分片的客戶端**靜默落進舊全域；若把預設改成寬鬆車道，
 * 同一批路徑就會靜默落進公共規則——而那個失誤**不會報錯**（隱私默默降級），
 * 與「拒絕連線」的失誤（功能壞掉、當場看得見）代價完全不對稱。
 * 兩邊都正面列舉、其餘拒絕，就沒有預設值可以掉進去。
 */
export function routeForPath(pathname: string): RelayRoute | undefined {
  const path = pathname.replace(/\/+$/, ""); // 容忍尾斜線
  if (path === "") return { profile: "strict", doName: LEGACY_GLOBAL_NAME };

  const shard = /^\/s\/([0-9a-f])$/i.exec(path);
  if (shard?.[1]) return { profile: "strict", doName: `shard-${shard[1].toLowerCase()}` };

  if (/^\/presence$/i.test(path)) return { profile: "strict", doName: PRESENCE_LAYER_NAME };

  const lane = /^\/app\/(.+)$/.exec(path);
  if (lane?.[1]) {
    const laneId = lane[1].toLowerCase();
    // 形狀不合法就拒絕，不是「清乾淨後放行」——放行等於讓兩個不同的字串映到同一條車道。
    if (!LANE_ID.test(laneId)) return undefined;
    return { profile: "app", doName: appLaneName(laneId), laneId };
  }

  return undefined;
}
