// 函式庫匯出（供前端 demo／engine 的離線模式與測試使用；ADR-0370）。
//
// 中繼核心住在 Cinderous SDK（`@cinderous/client/relay`），這裡照原名轉出，engine 的 import 不必改。
// `in-memory-network` 留在 Cinderous：它串的是 App 自己的 `RelayClient`。
// Worker 進入點 worker.ts 由 wrangler.toml 直接指向，不在此匯出，
// 以免將 Cloudflare 執行期 API（WebSocketPair 等）帶入瀏覽器環境。
export * from "@cinderous/client/relay";
export * from "./in-memory-network.js";
