// build-time 注入的全域常數（ADR-0227）：vite `define`，源自 root package.json / docs/releases.json（SSOT）。
declare const __APP_VERSION__: string;
declare const __RELEASES__: { version: string; date: string; released?: boolean; zh: string[]; en: string[] }[];
/**
 * 統一節點建置旗標（ADR-0354）：`vite build --mode unified`（`pnpm build:unified`）時為 true，
 * 代表這份產物會與 relay 部署在同一座 Cloudflare Worker ⇒ 網頁版預設自指同源 relay。
 * 一般 `build`（Tauri 桌面端、Cloudflare Pages）恆為 false。
 */
declare const __SELF_RELAY__: boolean;
