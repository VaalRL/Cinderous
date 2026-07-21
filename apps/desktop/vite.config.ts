import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 版號注入（ADR-0227 P2）：自 root package.json（SSOT）讀取，注入為 build-time 常數 __APP_VERSION__。
const version = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")).version as string;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  // Tauri：dev server 監看時忽略 Rust 建置產物——否則會去監看 src-tauri/target 內
  // 正被 cargo 連結的 *.exe（被鎖住 → EBUSY 崩潰）。Rust 端由 tauri 自己的 watcher 監看。
  server: {
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
        webrtc: resolve(__dirname, "webrtc.html"),
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
