// Cloudflare Worker 進入點（兩座錨點與 Tauri 內嵌中繼共用；ADR-0370）。
//
// 中繼的程式碼住在 Cinderous SDK（`@cinderous/client/relay/worker`），這裡是 Cinderous 的**部署實例**：
// 只做一件事——把 App 的版號注入 NIP-11（`version` 欄位是「一鍵更新節點」比對的依據，ADR-0356），
// 然後原樣轉出 Worker 的 `fetch` 與 Durable Object `RelayRoom`。
// 設定（APP_LANES、TURN、限速 binding、secrets）在 wrangler*.toml，不在程式碼裡。
import { setRelayVersion } from "@cinderous/client/relay";
import { RELAY_WORKER_VERSION } from "./version.js";

setRelayVersion(RELAY_WORKER_VERSION);

export { default } from "@cinderous/client/relay/worker";
export * from "@cinderous/client/relay/worker";
