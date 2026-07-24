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

/**
 * 由請求 URL 路徑選 DO 名（ADR-0241 worker 路由）：
 *  - `/s/<prefix>`（單 hex nibble）→ `shard-<prefix>`（訊息片）
 *  - `/presence` → presence 層
 *  - 其他（含 `/`）→ 舊全域（遷移期回退；舊客戶端未更新前仍走這裡）
 */
export function shardNameForPath(pathname: string): string {
  const m = /^\/s\/([0-9a-f])\/?$/i.exec(pathname);
  if (m?.[1]) return `shard-${m[1].toLowerCase()}`;
  if (/^\/presence\/?$/i.test(pathname)) return PRESENCE_LAYER_NAME;
  return LEGACY_GLOBAL_NAME;
}
