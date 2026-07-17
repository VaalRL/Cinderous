// 維護者金鑰產生器（本機專用；見 docs/MAINTAINER-ACTIVATION.md）。
//
// 產一把「信任根」維護者金鑰（發佈簽章 relay 清單用，ADR-0039/0092）：
//   - 公鑰 hex → 印到 stdout（可公開，填進 packages/engine/src/bootstrap-config.ts 的 MAINTAINER_PUBKEY）
//   - 私鑰 nsec → 只寫入本機檔案（預設 ./maintainer.nsec，已 gitignore、chmod 600），
//     **永不印到 stdout／日誌**——避免被截圖、貼上、或進到任何共享情境。
//
// 執行：pnpm --filter @cinder/relay genkey:maintainer
//   自訂輸出路徑：MAINTAINER_NSEC_OUT=/path/to/file
//   覆寫既有檔：  MAINTAINER_NSEC_FORCE=1
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSecretKey, getPublicKey, nsecEncode } from "@cinder/core";

const outPath = resolve(process.env.MAINTAINER_NSEC_OUT ?? "maintainer.nsec");

if (existsSync(outPath) && process.env.MAINTAINER_NSEC_FORCE !== "1") {
  console.error(`✋ 目標檔已存在：${outPath}`);
  console.error("   為避免覆寫既有維護者金鑰而中止。確定要重產→設 MAINTAINER_NSEC_FORCE=1 再執行。");
  process.exit(1);
}

const sk = generateSecretKey();
const pubkeyHex = getPublicKey(sk);
const nsec = nsecEncode(sk);

// 🔒 nsec 只落地檔案，永不進 stdout。
writeFileSync(outPath, `${nsec}\n`, { mode: 0o600 });
try {
  chmodSync(outPath, 0o600); // Windows 上可能無效，忽略。
} catch {
  /* 忽略 */
}

console.log("✅ 已產生維護者金鑰。");
console.log("");
console.log("MAINTAINER_PUBKEY（公開，填進 packages/engine/src/bootstrap-config.ts）：");
console.log(`  ${pubkeyHex}`);
console.log("");
console.log(`🔒 nsec 已寫入（未印出）：${outPath}`);
console.log("");
console.log("下一步：");
console.log("  1) 把該檔內容設為 GitHub repository secret『MAINTAINER_NSEC』");
console.log("     （Settings → Secrets and variables → Actions → New repository secret）。");
console.log("  2) 離線備份該檔，然後從本機刪除（線上唯一副本＝GitHub secret）。");
console.log("  ⚠ 千萬別 commit、別貼進聊天、別截圖含 nsec 的檔案內容。");
