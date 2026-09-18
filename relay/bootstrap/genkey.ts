// 維護者金鑰產生器（本機專用；見 docs/MAINTAINER-ACTIVATION.md）。
//
// 產一把「信任根」維護者金鑰（發佈簽章 relay 清單用，ADR-0039/0092）：
//   - 公鑰 hex → 印到 stdout（可公開，填進 packages/engine/src/bootstrap-config.ts 的 MAINTAINER_PUBKEY）
//   - 私鑰 nsec → 只寫入本機檔案（預設 ./maintainer.nsec，已 gitignore），
//     **永不印到 stdout／日誌**——避免被截圖、貼上、或進到任何共享情境。
//     ⚠ 會嘗試 chmod 600，但 **Windows 上不生效**（實測產出的檔案是 644）。
//     在多人共用的 Windows 機器上，這個檔案其他使用者讀得到——請自行搬到受保護的位置。
//
// 執行：pnpm --filter @cinderous/relay genkey:maintainer
//   自訂輸出路徑：MAINTAINER_NSEC_OUT=/path/to/file
//   覆寫既有檔：  MAINTAINER_NSEC_FORCE=1
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSecretKey, getPublicKey, nsecEncode } from "@cinderous/core";

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
console.log("下一步（ADR-0239：信任根**不進 CI**）：");
console.log("  1) 把公鑰填進 packages/engine/src/bootstrap-config.ts，並配一份 ADR。");
console.log("  2) 離線備份這個檔案。**保留本機這一份**——簽章是在你的機器上做的：");
console.log("       MAINTAINER_NSEC=\"$(cat maintainer.nsec)\" pnpm --filter @cinderous/relay bootstrap:sign");
console.log("  3) 重建並發佈所有客戶端（公鑰是編譯期常數，舊版不會自動吃到）。");
console.log("");
console.log("  🔴 **不要**把 nsec 設成 GitHub Actions secret。CI 的任何一個傳遞相依被投毒");
console.log("     就能讀走整個容錯拓樸的信任根（ADR-0239 正是為此把它移出 CI）。");
console.log("  🔴 這是**輪替**的話：舊金鑰先別刪。並存期間同一份清單要用新舊各簽一次，");
console.log("     否則已出貨的舊客戶端驗不了新簽章，會收不到任何清單更新而變成孤島。");
console.log("  ⚠ 千萬別 commit、別貼進聊天、別截圖含 nsec 的檔案內容。");
