// build-time 注入的全域常數（ADR-0227）：vite `define`，源自 root package.json / docs/releases.json（SSOT）。
declare const __APP_VERSION__: string;
declare const __RELEASES__: { version: string; date: string; zh: string[]; en: string[] }[];
