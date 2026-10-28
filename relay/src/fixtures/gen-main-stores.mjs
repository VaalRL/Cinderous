// 產生 `main-<commit>-stores.mjs`：某個 commit 的錨點中繼儲存程式（`MessageStore`、`SqlMessageStore`、
// `ConnPersistence`），原樣打包成一個 ES module。
//
// 目前的用途（ADR-0370；relay/src/sdk-switch-compat.test.ts）：錨點**切到 SDK 中繼之前最後部署的**儲存程式
//（5137079c，ADR-0394）。切換那一刻，同一顆 DO 的 SQLite 會從舊建構子建的 schema 直接被 SDK 的建構子打開；
// 回滾時反過來。測試拿這份程式實際建一次確認兩個方向都不出錯。
//（ADR-0379 時用過 22e3860c 那份，給已經刪掉的 capacity-compat／schema-compat；SDK 的同名測試接手。）
//
// 用法（repo 根目錄）：node relay/src/fixtures/gen-main-stores.mjs [commit]（預設 5137079c）
// 需要 git 與那個 commit；產物進版控，平常跑測試不需要重產。
// 舊的 store 對 `@cinderous/core` 只有型別 import，打包時不需要解析它。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const COMMIT = process.argv[2] ?? "5137079c";
const dir = mkdtempSync(join(tmpdir(), "cinder-main-stores-"));
try {
  // 逐檔 `git show`（不用 tar：Windows 的 GNU tar 會把 `C:` 當成遠端主機）
  const files = execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", COMMIT, "relay/src"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), execFileSync("git", ["-C", root, "show", `${COMMIT}:${file}`]));
  }
  const result = await build({
    stdin: {
      contents: [
        "export { MessageStore } from './message-store.ts';",
        "export { SqlMessageStore } from './sql-message-store.ts';",
        "export { ConnPersistence } from './conn-persistence.ts';",
      ].join("\n"),
      resolveDir: join(dir, "relay", "src"),
      sourcefile: "entry.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
    logLevel: "silent",
    legalComments: "none",
    charset: "utf8",
  });
  const header = [
    `// 由 relay/src/fixtures/gen-main-stores.mjs 從 ${COMMIT} 產生（ADR-0370），不要手改。`,
    "// @ts-nocheck",
    "",
  ].join("\n");
  writeFileSync(join(root, "relay", "src", "fixtures", `main-${COMMIT}-stores.mjs`), header + result.outputFiles[0].text);
  console.log(`wrote relay/src/fixtures/main-${COMMIT}-stores.mjs`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
