// CLI 發行成品（ADR-0405）：把已建置的 `apps/cli/dist/cinder.js` 變成 Release 要附的兩個檔。
//
//   pnpm release:cli   → dist-release/cinder.mjs ＋ dist-release/cinder.mjs.sha256
//
// - 檔名固定 `cinder.mjs`、不帶版號：官網的下載鈕連 `releases/latest/download/cinder.mjs`，
//   換版不用改網站。`.mjs` 讓 Node 不看 package.json 也知道它是 ES module。
// - 上傳前檢查：只依賴 Node 內建模組（帶出 repo 才跑得起來）、開頭有 shebang。

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ARTIFACT_NAME = "cinder.mjs";

/** `sha256sum` 格式的一行（雜湊、兩個空白、檔名），`sha256sum -c` 可直接驗。 */
export function checksumLine(buf, name) {
  return `${createHash("sha256").update(buf).digest("hex")}  ${name}\n`;
}

/** 單檔能不能帶出 repo 執行：有 shebang、只 import／require `node:` 內建模組。 */
export function checkBundle(source) {
  if (!source.startsWith("#!")) throw new Error("成品開頭沒有 shebang（build.mjs 的 banner 被拿掉了？）");
  const specs = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
  const external = [...new Set(specs.filter((s) => !s.startsWith("node:")))];
  if (external.length > 0) throw new Error(`成品依賴了沒有打包進去的模組：${external.join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const bundle = readFileSync(join(root, "apps", "cli", "dist", "cinder.js"));
  checkBundle(bundle.toString("utf8"));
  const outDir = join(root, "dist-release");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, ARTIFACT_NAME), bundle);
  writeFileSync(join(outDir, `${ARTIFACT_NAME}.sha256`), checksumLine(bundle, ARTIFACT_NAME));
  console.log(`✓ dist-release/${ARTIFACT_NAME}（${(bundle.length / 1024).toFixed(0)} KB）＋ ${ARTIFACT_NAME}.sha256`);
}
