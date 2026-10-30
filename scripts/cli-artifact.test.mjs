// CLI 發行成品（ADR-0405）純邏輯測試。以 Node 內建 runner 執行：
//   node --test scripts/cli-artifact.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ARTIFACT_NAME, checksumLine, checkBundle } from "./cli-artifact.mjs";

describe("CLI 發行成品", () => {
  it("檔名固定、不帶版號：官網用 releases/latest/download/<檔名> 才連得到最新版", () => {
    assert.equal(ARTIFACT_NAME, "cinder.mjs");
  });

  it("校驗檔是 sha256sum 的格式（`sha256sum -c` 直接能驗）", () => {
    const buf = Buffer.from("hello");
    const hex = createHash("sha256").update(buf).digest("hex");
    assert.equal(checksumLine(buf, "cinder.mjs"), `${hex}  cinder.mjs\n`);
  });

  it("🔴 只依賴 Node 內建模組：單檔帶出 repo 才跑得起來", () => {
    assert.doesNotThrow(() => checkBundle('#!/usr/bin/env node\nimport { spawn } from "node:child_process";\n'));
    assert.throws(() => checkBundle('#!/usr/bin/env node\nimport { x } from "nostr-tools";\n'), /nostr-tools/);
    assert.throws(() => checkBundle('#!/usr/bin/env node\nconst y = require("ws");\n'), /ws/);
  });

  it("沒有 shebang 就拒絕（Unix 上 chmod +x 之後跑不起來）", () => {
    assert.throws(() => checkBundle('import { spawn } from "node:child_process";\n'), /shebang/);
  });
});
