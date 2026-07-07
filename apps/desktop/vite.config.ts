import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
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
