// 黃金向量 fixture 產生器（ADR-0374）。**平常不執行**；只在要重新產生 fixture 時：
//
//   CINDER_WRITE_GOLDEN=1 pnpm --filter @cinderous/core exec vitest run src/golden/write-golden.test.ts
//
// ⚠ fixture 的意義是「**升級前**的輸出」。在已升級的樹上重跑會把新行為寫成標準答案，
//   等於把比對拿掉——只有在刻意接受格式變更（並寫 ADR 說明遷移）時才可以重產。

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { generateGolden, generateSlowGolden } from "./noble-golden.js";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..", "..");

function versionAt(dir: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return undefined;
  }
}

/** 記下產生當下實際載入的版本（core 自己那份，以及 nostr-tools 底下那份）。 */
function installedVersions() {
  const nostrTools = realpathSync(join(coreRoot, "node_modules", "nostr-tools"));
  const names = ["@noble/curves", "@noble/hashes", "@noble/ciphers", "@noble/post-quantum", "@scure/base", "nostr-tools"];
  return Object.fromEntries(
    names.map((n) => [
      n,
      {
        core: versionAt(join(coreRoot, "node_modules", n)),
        nostrTools: versionAt(join(nostrTools, "..", n)),
      },
    ]),
  );
}

describe.runIf(process.env.CINDER_WRITE_GOLDEN === "1")("產生黃金向量 fixture", () => {
  it("寫出 noble-1x-golden.json", () => {
    const out = { ...generateGolden(), ...generateSlowGolden() };
    out._meta = { ...out._meta, versions: installedVersions() } as typeof out._meta;
    writeFileSync(join(here, "noble-1x-golden.json"), `${JSON.stringify(out, null, 2)}\n`);
  }, 120_000);
});
