import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Cinder 官網（ADR-0090）：純靜態站，同一份設定供 vitest（環境 node）。
// base：部署為 GitHub 專案頁 https://<user>.github.io/Cinder/（ADR-0186）。
// 若改掛自訂網域或改走 user page（根站），把 base 改回 "/" 即可。
export default defineConfig({
  base: "/Cinder/",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
