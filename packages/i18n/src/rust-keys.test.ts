// 跨語言邊界的 i18n 鍵（ADR-0356）。
//
// ## 為什麼需要這支測試
//
// Rust 的 `DeployError::message_key()` 與幾個 Tauri 指令會回傳 i18n **鍵的字面字串**，
// 由前端拿去翻譯。那條邊界上沒有任何型別檢查：`messages.ts` 裡改個名字，
// 使用者看到的會是**一片空白**（或原始鍵名），而 typecheck 與全部測試照樣綠。
//
// 這支測試直接讀 Rust 原始碼，把所有 `"deploy_*"` 字面量抓出來逐一比對。
// 它不完美（抓的是字面量，不是型別），但它會在那個特定的漏法上變紅，而那正是重點。

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalog, LOCALES } from "./messages.js";

const RUST_DIR = new URL("../../../apps/desktop/src-tauri/src/", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

/** 從 Rust 原始碼抓出所有 `"deploy_xxx"` 字面量。 */
function rustDeployKeys(): string[] {
  const found = new Set<string>();
  for (const name of readdirSync(RUST_DIR)) {
    if (!name.endsWith(".rs")) continue;
    const src = readFileSync(join(RUST_DIR, name), "utf8");
    for (const m of src.matchAll(/"(deploy_[A-Za-z][A-Za-z0-9]*)"/g)) found.add(m[1]!);
  }
  return [...found].sort();
}

describe("Rust 產生的 i18n 鍵（ADR-0356）", () => {
  const keys = rustDeployKeys();

  it("真的抓得到鍵——抓不到就代表這支測試自己壞了，而不是沒有鍵", () => {
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys).toContain("deploy_errUnauthorized");
  });

  it.each(LOCALES)("%s 的 catalog 涵蓋每一個 Rust 會吐出的鍵", (locale) => {
    const messages = catalog[locale] as unknown as Record<string, string>;
    const missing = keys.filter((k) => typeof messages[k] !== "string" || messages[k] === "");
    // 🔴 少一個鍵＝使用者部署失敗時看到一片空白，而他正需要那句話告訴他該做什麼。
    expect(missing, `${locale} 缺少：${missing.join("、")}`).toEqual([]);
  });
});
