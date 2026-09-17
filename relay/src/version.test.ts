// Relay worker 出貨版號（ADR-0356 §2）。
//
// 這支測試盯的不是「版號等於某個值」——那樣每次發版都要改測試，而且毫無意義。
// 它盯的是**兩件會靜默壞掉的事**：版號沒被 NIP-11 送出去，以及版號與 root package.json 漂移。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { relayInfoFrom } from "./worker.js";
import { RELAY_WORKER_VERSION } from "./version.js";

describe("relay worker 版號（ADR-0356）", () => {
  it("🔴 與 root package.json 一致——漂移了「一鍵更新節點」就會比對錯版本", () => {
    const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(RELAY_WORKER_VERSION).toBe(root.version);
  });

  it("🔴 出現在 NIP-11 文件裡——查不到版本，ADR-0241 的跟版義務就只是一句口頭提醒", () => {
    const doc = relayInfoFrom({} as never);
    expect(doc.version).toBe(RELAY_WORKER_VERSION);
  });

  it("形如語意版號（不是空字串、不是 undefined 被序列化成的東西）", () => {
    expect(RELAY_WORKER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
