// 產生 `main-22e3860c-stores.mjs`（ADR-0379；對應 SDK ADR 0042 的 `gen-v0.33-stores.mjs`）：
// 容量功能移植**之前**的錨點 `MessageStore` 與 `SqlMessageStore`（origin/main 22e3860c，含 ADR-0375／0376／0377），原樣打包成一個 ES module。
//
// 用途（relay/src/capacity-compat.test.ts）：
// 1. **向下相容**：同一串寫入分別丟給移植前與現在的 store（都不設容量選項），每一則的結果與最後庫裡的內容要一模一樣。
// 2. **回滾**：現在的建構子遷移過的 SQLite（多了 `borrowed` 欄、部分索引、`inbox_drops` 表），交給移植前的程式照常讀寫。
//
// 用法（repo 根目錄）：node relay/src/fixtures/gen-main-stores.mjs
// 需要 git 與 22e3860c 這個 commit；產物進版控，平常跑測試不需要重產。
// 移植前的 store 對 `@cinderous/core` 只有型別 import，打包時不需要解析它。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const COMMIT = "22e3860c";
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
    `// 由 relay/src/fixtures/gen-main-stores.mjs 從 ${COMMIT} 產生（ADR-0379），不要手改。`,
    "// @ts-nocheck",
    "",
  ].join("\n");
  writeFileSync(join(root, "relay", "src", "fixtures", `main-${COMMIT}-stores.mjs`), header + result.outputFiles[0].text);
  console.log(`wrote relay/src/fixtures/main-${COMMIT}-stores.mjs`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
