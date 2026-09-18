// 引擎事件回呼的接線齊備性守衛（ADR-0363）。
//
// ## 為什麼需要這支測試
//
// 2026-09-18 的抽驗發現行動端**完全沒接**九個 `ChatBackendEvents` 回呼，其中包括
// 傳檔進度、傳檔失敗、通話失敗原因、企業身分輪替。沒有任何測試會紅，因為漏接一個
// 可選回呼在型別上完全合法——`onFileProgress?` 不接就是不接。
//
// 這是「同一份引擎、兩個平台、一邊忘了接」這一類問題，而它在這個專案裡**反覆發生**：
// `sweepInbox` 的瀏覽器分支、`onStorageQuota` 的行動端註冊、ADR-0273 漏掉的第三個送檔
// 入口，成因都一樣。型別系統幫不上忙（可選就是可選），所以改用一份**明示清單**：
// 沒接的每一個都要在這裡寫下理由，寫不出理由就是漏了。
//
// 它擋不住「接了但接錯」（那需要人看），但擋得住「忘了接」——而忘了接正是上面每一個的成因。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TYPES = readFileSync(
  new URL("../../../packages/engine/src/backend/types.ts", import.meta.url),
  "utf8",
);

/** `ChatBackendEvents` 介面裡宣告的所有回呼名稱。 */
function declaredHandlers(): string[] {
  const from = TYPES.indexOf("export interface ChatBackendEvents {");
  expect(from, "找不到 ChatBackendEvents（介面改名了？）").toBeGreaterThan(-1);
  const body = TYPES.slice(from, TYPES.indexOf("\n}", from));
  return [...new Set([...body.matchAll(/^ {2}(on[A-Za-z]+)\??[(:]/gm)].map((m) => m[1]!))];
}

/** 掃某個 app 的 `src/` 有沒有提到這個名稱（`onX:` 物件字面或 `onX(` 方法簡寫都算）。 */
function wiredIn(app: "desktop" | "mobile", names: string[]): Set<string> {
  const root = new URL(`../../${app}/src/`, import.meta.url);
  const files = listTs(root);
  const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
  return new Set(names.filter((n) => new RegExp(`\\b${n}\\s*[:(]`).test(src)));
}

function listTs(dir: URL): URL[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- 測試專用，避免多一個相依
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const out: URL[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...listTs(child));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(child);
  }
  return out;
}

/**
 * 刻意不接的回呼，**每一個都要有理由**。
 *
 * 理由只有一種是正當的：**這個平台沒有對應的功能可以餵**。
 * 「還沒做」不是理由——那正是這支測試要抓的東西。
 */
const NOT_WIRED: Record<"desktop" | "mobile", Record<string, string>> = {
  desktop: {
    onCallCamera: "ADR-0339 是手機前後鏡頭的鏡像判定；桌面 webcam 一律回 null，沒有東西可用",
    onMessageReceipts: "群組每成員回條由 storage 讀出（ConversationWindow 直接吃 m.receipts），不需推播",
  },
  mobile: {
    onMutes: "行動端**還沒有每對話靜音功能**（唯一的 mute 是通話麥克風）——接了也沒有 UI 可更新",
    onAssetCached: "行動端**沒有自訂 emoji**（ADR-0223 的 backfill 對象），沒有占位可重繪",
    onRelayPool: "行動端**沒有中繼池顯示**（只顯示 home 單座的連線狀態，走 connector 回呼）",
    onSlotDeposit: "企業儲存槽需要原生檔案系統，PRD §12 明說部分功能限桌面",
  },
};

describe("引擎回呼的接線齊備性（ADR-0363）", () => {
  const all = declaredHandlers();

  it("掃得到回呼（避免 regex 壞掉時測試假性通過）", () => {
    expect(all.length).toBeGreaterThan(40);
    expect(all).toContain("onMessage");
  });

  for (const app of ["desktop", "mobile"] as const) {
    it(`🔴 ${app} 每個沒接的回呼都要有明示理由——漏接不會有型別錯誤，只會安靜地少一個功能`, () => {
      const wired = wiredIn(app, all);
      const missing = all.filter((n) => !wired.has(n) && !(n in NOT_WIRED[app]));
      expect(missing).toEqual([]);
    });

    it(`${app} 的豁免清單不得有殭屍項目（接了就該從清單移除）`, () => {
      const wired = wiredIn(app, all);
      const stale = Object.keys(NOT_WIRED[app]).filter((n) => wired.has(n));
      expect(stale).toEqual([]);
    });

    it(`${app} 的豁免項目必須真的存在於介面上（改名後清單會失效）`, () => {
      const ghosts = Object.keys(NOT_WIRED[app]).filter((n) => !all.includes(n));
      expect(ghosts).toEqual([]);
    });
  }
});
