// CLI 打包（ADR-0227 P2）：以 esbuild API 打包，並注入版號常數 __APP_VERSION__
// （源自 root package.json 的 version＝SSOT），供 CLI 顯示版本。
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
).version;

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/cinder.js",
  define: { __APP_VERSION__: JSON.stringify(version) },
});
