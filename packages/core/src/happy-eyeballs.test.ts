import { describe, expect, it } from "vitest";
import { raceConnections } from "./happy-eyeballs.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Happy Eyeballs 連線競速（RFC 8305 精神）", () => {
  it("先連通者勝出並回傳其標籤與值", async () => {
    const lan = deferred<string>();
    const wan = deferred<string>();
    const race = raceConnections([
      { label: "lan", connect: () => lan.promise },
      { label: "wan", connect: () => wan.promise },
    ]);
    lan.resolve("LAN-CONN");
    await expect(race).resolves.toEqual({ label: "lan", value: "LAN-CONN" });
  });

  it("較快者失敗時改由另一者勝出", async () => {
    const lan = deferred<string>();
    const wan = deferred<string>();
    const race = raceConnections([
      { label: "lan", connect: () => lan.promise },
      { label: "wan", connect: () => wan.promise },
    ]);
    lan.reject(new Error("LAN 不可達"));
    wan.resolve("WAN-CONN");
    await expect(race).resolves.toEqual({ label: "wan", value: "WAN-CONN" });
  });

  it("勝出後會中止較慢的嘗試", async () => {
    const lan = deferred<string>();
    let wanAborted = false;
    const race = raceConnections([
      { label: "lan", connect: () => lan.promise },
      {
        label: "wan",
        connect: (signal) =>
          new Promise<string>(() => {
            signal.addEventListener("abort", () => {
              wanAborted = true;
            });
          }),
      },
    ]);
    lan.resolve("ok");
    await race;
    expect(wanAborted).toBe(true);
  });

  it("全部失敗則拒絕", async () => {
    await expect(
      raceConnections([
        { label: "a", connect: () => Promise.reject(new Error("x")) },
        { label: "b", connect: () => Promise.reject(new Error("y")) },
      ]),
    ).rejects.toThrow();
  });

  it("無任何嘗試時拒絕", async () => {
    await expect(raceConnections([])).rejects.toThrow();
  });
});
