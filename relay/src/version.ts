// Relay worker 的出貨版號（ADR-0356 §2）。
//
// ## 為什麼需要一個常數，而不是讀 package.json
//
// Worker 跑在 Cloudflare 的 runtime 裡，沒有檔案系統、也沒有 `require("./package.json")`。
// 版號必須在**打包時**就固定在程式碼裡。
//
// ## 它拿來做什麼
//
// 寫進 NIP-11 的 `version` 欄位（ADR-0260）⇒ 任何人 `curl -H "Accept: application/nostr+json"`
// 一座 relay 就知道它跑的是哪一版。ADR-0241 的「relay 需 deploy 最新 worker」維運義務，
// 靠的就是這個欄位比對得出來；App 的「一鍵更新節點」也是比它。
//
// ⚠ 由 `scripts/version-sync.mjs` 從 root `package.json` 同步——**不要手改**。
// `pnpm version:check` 會在漂移時讓 CI 紅。
export const RELAY_WORKER_VERSION = "0.0.16";
