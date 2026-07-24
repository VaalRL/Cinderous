import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// @cinderous/brand 的 SSR 斷言測試（renderToStaticMarkup，環境 node，不需 DOM）。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
