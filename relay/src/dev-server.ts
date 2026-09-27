/**
 * 本機開發用的真實 Nostr relay（純記憶體；ADR-0370）：主機程式碼在 Cinderous SDK。
 *
 * 用法：`pnpm --filter @cinderous/relay build:dev && pnpm --filter @cinderous/relay dev`
 */
import { startDevRelay } from "@cinderous/client/relay/node";

startDevRelay(Number(process.env.PORT ?? 8787));
