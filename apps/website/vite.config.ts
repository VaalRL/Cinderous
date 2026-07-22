import { copyFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// 版號注入（ADR-0227 P2）：自 root package.json（SSOT）讀取為 build-time 常數 __APP_VERSION__。
const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;

// 發佈靜態資料檔：docs/releases.json（ADR-0228 P2，更新偵測來源）與
// docs/threat-intel.json（ADR-0231 P2，威脅情報 snapshot）複製進 dist 根，供各 app 查詢。
function copyReleases(): Plugin {
  return {
    name: "copy-releases-json",
    apply: "build",
    closeBundle() {
      for (const f of ["releases.json", "threat-intel.json"]) {
        copyFileSync(new URL(`../../docs/${f}`, import.meta.url), new URL(`./dist/${f}`, import.meta.url));
      }
    },
  };
}

// Cinderous 官網（ADR-0090）：純靜態站，同一份設定供 vitest（環境 node）。
// base：部署為 GitHub 專案頁 https://<user>.github.io/Cinderous/（ADR-0186）。
// 若改掛自訂網域或改走 user page（根站），把 base 改回 "/" 即可。
export default defineConfig({
  base: "/Cinderous/",
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), copyReleases()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
