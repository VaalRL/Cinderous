// 守門（ADR-0374）：整個 workspace 的 @noble／@scure 只能有**一份**，且不低於有常數時間保證的版本。
//
// 為什麼要守：nostr-tools 精確釘住舊版（curves／hashes 2.0.1、ciphers 2.1.1、base 2.0.0），
// 我們靠根目錄 `pnpm-workspace.yaml` 的 `overrides` 把它壓到同一份 2.4.0。
// 有人拿掉 overrides、只留一部分，或把 core 的相依寫回 1.x，打包就會回到三份 secp256k1，
// 而 nostr-tools 那條路徑（NIP-44、NIP-49、Gift Wrap 驗章）會默默退回沒有常數時間保證的版本——
// 功能完全正常，所以**沒有任何功能測試會紅**。這支測試就是那個警報。
//
// ⚠ nostr-tools 或 @noble/post-quantum 日後改釘更新的 noble 時，overrides 會把它們壓回這裡的版本；
//   升級它們時要看 `pnpm why` 與 release notes，決定下限要不要跟著升（SDK ADR 0034 同一條）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const lock = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8");
const workspace = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
const corePkg = JSON.parse(readFileSync(join(repoRoot, "packages", "core", "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

/** 常數時間保證從 curves 2.3.0 起；hashes 2.4.0 含 argon2／選項防竄改修正。整組對齊 2.4.0。 */
const FLOOR = "2.4.0";
const PINNED = ["@noble/curves", "@noble/hashes", "@noble/ciphers", "@scure/base", "@scure/bip32", "@scure/bip39"];

const cmp = (a: string, b: string): number => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/** pnpm-lock.yaml 裡某套件的所有已安裝版本。 */
function lockedVersions(name: string): string[] {
  const esc = name.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(`^ {2}'?${esc}@(\\d+\\.\\d+\\.\\d+)`, "gm");
  return [...new Set([...lock.matchAll(re)].map((m) => m[1]!))];
}

describe("@noble／@scure：整棵樹只有一份，且 ≥ 2.4.0", () => {
  for (const name of PINNED) {
    it(`${name} 只有一個版本，且不低於 ${FLOOR}`, () => {
      const versions = lockedVersions(name);
      expect(versions, `${name} 在 lockfile 中的版本`).toHaveLength(1);
      expect(cmp(versions[0]!, FLOOR), `${name}@${versions[0]}`).toBeGreaterThanOrEqual(0);
    });

    it(`pnpm-workspace.yaml 的 overrides 覆寫了 ${name}`, () => {
      const esc = name.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
      expect(workspace).toMatch(new RegExp(`^overrides:[\\s\\S]*^ {2}'${esc}': ?'?\\d`, "m"));
    });
  }

  it("core 宣告的相依不低於下限", () => {
    for (const name of ["@noble/curves", "@noble/hashes", "@noble/ciphers", "@scure/base"]) {
      const spec = corePkg.dependencies[name];
      expect(spec, name).toMatch(/^[\^~]?\d+\.\d+\.\d+$/);
      expect(cmp(spec!.replace(/^[\^~]/, ""), FLOOR), `${name}: ${spec}`).toBeGreaterThanOrEqual(0);
    }
  });
});
