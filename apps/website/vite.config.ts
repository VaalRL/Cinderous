import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 版號注入（ADR-0227 P2）：自 root package.json（SSOT）讀取為 build-time 常數 __APP_VERSION__。
const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;

// Cinderous 官網（ADR-0090）：純靜態站，同一份設定供 vitest（環境 node）。
// base：部署為 GitHub 專案頁 https://<user>.github.io/Cinderous/（ADR-0186）。
// 若改掛自訂網域或改走 user page（根站），把 base 改回 "/" 即可。
export default defineConfig({
  base: "/Cinderous/",
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
