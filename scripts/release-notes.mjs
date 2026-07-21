// 生成 GitHub release 的雙語 body（ADR-0227 P3）：讀 docs/releases.json 指定版本，
// 輸出「繁體中文段＋英文段」的 markdown 到 stdout。
//   node scripts/release-notes.mjs [version] > notes.md
//   gh release create vX.Y.Z --notes-file notes.md
// 無 version 參數＝releases.json 第一筆（最新）。--check 驗證每筆形狀合法。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const releases = JSON.parse(
  readFileSync(fileURLToPath(new URL("../docs/releases.json", import.meta.url)), "utf8"),
);

const ok = (r) =>
  r &&
  typeof r.version === "string" &&
  typeof r.date === "string" &&
  Array.isArray(r.zh) &&
  r.zh.every((s) => typeof s === "string") &&
  Array.isArray(r.en) &&
  r.en.every((s) => typeof s === "string");

if (process.argv.includes("--check")) {
  const bad = releases.filter((r) => !ok(r));
  if (!Array.isArray(releases) || bad.length > 0) {
    console.error(`docs/releases.json 形狀不合法（${bad.length} 筆）`);
    process.exit(1);
  }
  console.log(`releases.json 合法：${releases.length} 筆，最新 ${releases[0].version}`);
  process.exit(0);
}

const version = process.argv[2] ?? releases[0]?.version;
const rel = releases.find((r) => r.version === version);
if (!ok(rel)) {
  console.error(`docs/releases.json 找不到（或格式不合法）版本 ${version}`);
  process.exit(1);
}

const section = (title, items) => `## ${title}\n\n${items.map((i) => `- ${i}`).join("\n")}`;
process.stdout.write(
  [section("更新內容（繁體中文）", rel.zh), "", section("What's new (English)", rel.en), ""].join("\n"),
);
