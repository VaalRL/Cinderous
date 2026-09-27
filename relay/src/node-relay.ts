// 正式版 Node.js 中繼站主機（樹莓派、Docker；docs/self-hosting-raspberry-pi.md；ADR-0370）。
//
// 主機的程式碼住在 Cinderous SDK（`startNodeRelay`）；這裡注入 App 版號後照環境變數啟動，
// 環境變數與原本完全相同（PORT、DB_PATH、REQUIRE_AUTH、MAX_TTL_DAYS、RELAY_NAME…）。
import { setRelayVersion } from "@cinderous/client/relay";
import { startNodeRelay } from "@cinderous/client/relay/node";
import { RELAY_WORKER_VERSION } from "./version.js";

setRelayVersion(RELAY_WORKER_VERSION);
startNodeRelay(process.env);
