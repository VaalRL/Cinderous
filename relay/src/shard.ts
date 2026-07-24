// 中繼分片路由（ADR-0241）：從單一全域 Durable Object 到「按收件人 pubkey 前綴分片＋presence 獨立層」。
//
// 分片鍵＝收件人 pubkey 高 nibble（16 片）。收件匣天然同片（你的訊息 `#p:你` 與你訂閱 `#p:你` 都在
// `shard(你)`），跨分片路由由 pubkey **直接算**（免 ADR-0035 hint）。presence 是多對多廣播、資料形狀
// 不同 → **不進訊息分片，拆成獨立層**（單一/少數 DO，客戶端一次 `authors:[聯絡人]` 問完）。
//
// 本模組只做**純路由計算**（DO 名選擇），供 worker 的 `fetch` 依 URL 選 DO。每個分片與 presence 層
// 都是同一個 `RelayRoom` 類的獨立實例——分片＝路由，DO 邏輯不變。血條：一片崩只影響其 1/16 使用者。

/** 訊息分片數（ADR-0241）：按收件人 pubkey 高 nibble 取 16 片。血條 1/16。 */
export const SHARD_COUNT = 16;

/** presence 獨立層的 DO 名（ADR-0241）：廣播型、單一/少數 DO。 */
export const PRESENCE_LAYER_NAME = "presence";

/** 遷移期的舊全域 DO 名（切換＋舊留言 7 天自然過期；最低版本閘前的舊客戶端仍走這裡）。 */
export const LEGACY_GLOBAL_NAME = "global";

/** 收件人 pubkey → 分片前綴（單一 hex nibble `0`–`f`）。非法/空 → `"0"`（安全預設，不丟事件）。 */
export function shardPrefix(pubkey: string | undefined): string {
  const c = pubkey?.[0]?.toLowerCase();
  return c !== undefined && /^[0-9a-f]$/.test(c) ? c : "0";
}

/** 訊息分片的 DO 名（ADR-0241）：`shard-<prefix>`。 */
export function messageShardName(pubkey: string | undefined): string {
  return `shard-${shardPrefix(pubkey)}`;
}

/** 客戶端連自己訊息片的 URL 路徑（ADR-0241）：`wss://relay/s/<自己pubkey前綴>`。 */
export function shardPath(pubkey: string | undefined): string {
  return `/s/${shardPrefix(pubkey)}`;
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
