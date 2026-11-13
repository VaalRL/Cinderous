import { describe, expect, it } from "vitest";
import { createDiagLog, installErrorCapture, memoryDiagStore, redactDiag, type DiagStore } from "./diag-log.js";

// ADR-0421：本機錯誤紀錄。只存在這台裝置、從不自動上傳；寫入前先遮掉可識別身分／金鑰的字串。

const NSEC = "nsec1" + "q".repeat(58);
const NPUB = "npub1" + "x".repeat(58);
const HEX64 = "ab".repeat(32);

describe("redactDiag：寫入前遮掉身分與金鑰", () => {
  it("🔴 nsec／npub／ncryptsec／nprofile 等 bech32 實體一律遮掉", () => {
    const out = redactDiag(`bad key ${NSEC} for ${NPUB} ncryptsec1${"z".repeat(80)} nprofile1${"p".repeat(40)}`);
    expect(out).not.toContain(NSEC);
    expect(out).not.toContain(NPUB);
    expect(out).not.toMatch(/ncryptsec1z/);
    expect(out).not.toMatch(/nprofile1p/);
    expect(out).toContain("[nsec]");
    expect(out).toContain("[npub]");
  });

  it("🔴 長 hex（公鑰、事件 id、金鑰）與長 base64（密文）遮掉", () => {
    const b64 = "A".repeat(30) + "+/" + "b".repeat(30) + "==";
    const out = redactDiag(`pk=${HEX64} ct=${b64}`);
    expect(out).not.toContain(HEX64);
    expect(out).not.toContain(b64);
    expect(out).toContain("[hex]");
    expect(out).toContain("[b64]");
  });

  it("email 遮掉；一般錯誤訊息與堆疊的檔名行號保留", () => {
    const out = redactDiag("TypeError: x is undefined\n    at foo (App.tsx:12:5) mail me a@b.co");
    expect(out).toContain("TypeError: x is undefined");
    expect(out).toContain("App.tsx:12:5");
    expect(out).not.toContain("a@b.co");
  });

  it("網址只留到路徑，query／fragment 拿掉（可能帶 token）", () => {
    const out = redactDiag("fetch failed https://relay.example.com/s/a?token=secret#frag");
    expect(out).toContain("https://relay.example.com/s/a");
    expect(out).not.toContain("secret");
  });
});

function store(): DiagStore {
  return memoryDiagStore();
}

describe("createDiagLog：環狀緩衝、本機持久化", () => {
  it("記錄錯誤：時間、來源、版本、訊息、堆疊（已遮罩）", () => {
    const log = createDiagLog({ store: store(), version: "0.0.24", now: () => 1000 });
    const e = new Error(`boom ${NSEC}`);
    log.record("window", e);
    const [x] = log.list();
    expect(x).toMatchObject({ t: 1000, src: "window", v: "0.0.24" });
    expect(x!.msg).toBe("Error: boom [nsec]");
    expect(x!.stack).toBeTypeOf("string");
    expect(JSON.stringify(log.list())).not.toContain(NSEC);
  });

  it("非 Error 的值（字串、物件、undefined）也記得下來", () => {
    const log = createDiagLog({ store: store(), version: "v", now: () => 1 });
    log.record("promise", "plain string");
    log.record("promise", { code: 42 });
    log.record("promise", undefined);
    expect(log.list().map((x) => x.msg)).toEqual(["plain string", '{"code":42}', "undefined"]);
  });

  it("🔴 只留最近 cap 筆（舊的先丟），訊息與堆疊有長度上限", () => {
    const log = createDiagLog({ store: store(), version: "v", now: () => 1, cap: 3 });
    for (let i = 0; i < 5; i++) log.record("window", new Error(`e${i}`));
    expect(log.list().map((x) => x.msg)).toEqual(["Error: e2", "Error: e3", "Error: e4"]);
    log.record("window", new Error("y".repeat(5000)));
    const last = log.list().at(-1)!;
    expect(last.msg.length).toBeLessThanOrEqual(500);
    expect((last.stack ?? "").length).toBeLessThanOrEqual(2000);
  });

  it("同一個錯誤連續爆很多次 ⇒ 合併成一筆加次數，不洗掉其他紀錄", () => {
    const log = createDiagLog({ store: store(), version: "v", now: () => 5, cap: 3 });
    log.record("window", new Error("other"));
    for (let i = 0; i < 50; i++) log.record("render", new Error("loop"));
    const l = log.list();
    expect(l).toHaveLength(2);
    expect(l[1]).toMatchObject({ msg: "Error: loop", n: 50 });
  });

  it("持久化到 store：重開後還在；clear 清空", () => {
    const s = store();
    createDiagLog({ store: s, version: "v", now: () => 1 }).record("native", new Error("persist"));
    const again = createDiagLog({ store: s, version: "v", now: () => 1 });
    expect(again.list().map((x) => x.msg)).toEqual(["Error: persist"]);
    again.clear();
    expect(createDiagLog({ store: s, version: "v", now: () => 1 }).list()).toEqual([]);
  });

  it("store 壞掉（讀到垃圾、寫入丟例外）不會讓記錄本身再丟例外", () => {
    const bad: DiagStore = {
      get: () => "{not json",
      set: () => {
        throw new Error("quota");
      },
    };
    const log = createDiagLog({ store: bad, version: "v", now: () => 1 });
    expect(() => log.record("window", new Error("x"))).not.toThrow();
    expect(log.list().map((x) => x.msg)).toEqual(["Error: x"]);
  });

  it("exportText：純文字、含版本與環境、每筆一段；空的時候也有表頭", () => {
    const log = createDiagLog({ store: store(), version: "0.0.24", now: () => Date.UTC(2026, 10, 13) });
    expect(log.exportText({ platform: "test" })).toContain("0 筆");
    log.record("window", new Error("a"));
    const txt = log.exportText({ platform: "test", extra: "native: none" });
    expect(txt).toContain("0.0.24");
    expect(txt).toContain("test");
    expect(txt).toContain("2026-11-13T00:00:00.000Z");
    expect(txt).toContain("[window] Error: a");
    expect(txt).toContain("native: none");
  });

  it("subscribe：記錄或清除時通知（設定頁的筆數要即時更新）", () => {
    const log = createDiagLog({ store: store(), version: "v", now: () => 1 });
    let calls = 0;
    const off = log.subscribe(() => calls++);
    log.record("window", new Error("a"));
    log.clear();
    off();
    log.record("window", new Error("b"));
    expect(calls).toBe(2);
  });
});

describe("installErrorCapture：接 window 的 error／unhandledrejection", () => {
  it("🔴 兩種事件都進紀錄；回傳的函式會拆掉監聽", () => {
    const target = new EventTarget();
    const log = createDiagLog({ store: store(), version: "v", now: () => 1 });
    const off = installErrorCapture(target, log);
    const err = Object.assign(new Event("error"), { error: new Error("sync boom"), message: "sync boom" });
    target.dispatchEvent(err);
    const rej = Object.assign(new Event("unhandledrejection"), { reason: new Error("async boom") });
    target.dispatchEvent(rej);
    off();
    target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("after"), message: "after" }));
    expect(log.list().map((x) => [x.src, x.msg])).toEqual([
      ["window", "Error: sync boom"],
      ["promise", "Error: async boom"],
    ]);
  });

  it("資源載入失敗（沒有 error 物件、只有 message）也記，用 message", () => {
    const target = new EventTarget();
    const log = createDiagLog({ store: store(), version: "v", now: () => 1 });
    installErrorCapture(target, log);
    target.dispatchEvent(Object.assign(new Event("error"), { message: "Script error." }));
    expect(log.list()[0]!.msg).toBe("Script error.");
  });
});
