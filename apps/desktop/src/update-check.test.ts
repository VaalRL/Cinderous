// 更新偵測（ADR-0228 P3）：節流純函式＋fetch 注入查詢＋opt-in／狀態儲存。
import { setKvBackend, type KvStore } from "@cinderous/engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHECK_INTERVAL_MS,
  fetchLatest,
  loadUpdateState,
  saveUpdateState,
  setUpdateCheckEnabled,
  shouldCheck,
  updateCheckEnabled,
} from "./update-check.js";

const NOW = 1_800_000_000_000;

describe("shouldCheck（每日節流）", () => {
  it("從未查過 → 查", () => {
    expect(shouldCheck(null, NOW)).toBe(true);
    expect(shouldCheck(undefined, NOW)).toBe(true);
    expect(shouldCheck(0, NOW)).toBe(true);
  });
  it("距上次未滿間隔 → 不查；滿了 → 查", () => {
    expect(shouldCheck(NOW - CHECK_INTERVAL_MS + 1, NOW)).toBe(false);
    expect(shouldCheck(NOW - CHECK_INTERVAL_MS, NOW)).toBe(true);
  });
  it("時鐘倒退（lastCheck 在未來）→ 查，不會永久卡死", () => {
    expect(shouldCheck(NOW + 999_999, NOW)).toBe(true);
  });
});

const okFetch = (body: unknown): typeof fetch =>
  (() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })) as unknown as typeof fetch;

describe("fetchLatest（fetch 注入、三態：新版／已最新／查詢失敗）", () => {
  it("遠端有較新已發布版本 → ok＋版本字串", async () => {
    const remote = [
      { version: "0.0.14", released: true },
      { version: "0.0.12" },
    ];
    await expect(fetchLatest(okFetch(remote), "https://x/releases.json", "0.0.12")).resolves.toEqual({
      ok: true,
      version: "0.0.14",
    });
  });
  it("hold 草稿（released:false）不列入；已是最新 → ok＋null", async () => {
    const remote = [{ version: "0.0.14", released: false }, { version: "0.0.12" }];
    await expect(fetchLatest(okFetch(remote), "https://x/releases.json", "0.0.12")).resolves.toEqual({
      ok: true,
      version: null,
    });
    await expect(fetchLatest(okFetch([{ version: "0.0.12" }]), "https://x", "0.0.12")).resolves.toEqual({
      ok: true,
      version: null,
    });
  });
  it("HTTP 非 ok／JSON 非陣列／fetch 拋錯 → ok:false（呼叫端不覆寫既有徽章、不燒節流窗）", async () => {
    const notOk = (() => Promise.resolve({ ok: false, json: () => Promise.resolve([]) })) as unknown as typeof fetch;
    const throws = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    const badJson = (() =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new Error("bad")) })) as unknown as typeof fetch;
    for (const f of [notOk, okFetch({ nope: 1 }), throws, badJson]) {
      await expect(fetchLatest(f, "https://x", "0.0.12")).resolves.toEqual({ ok: false, version: null });
    }
  });
});

describe("opt-in 開關與狀態儲存（getKv 注入）", () => {
  const mem = new Map<string, string>();
  const memKv: KvStore = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
  afterEach(() => {
    setKvBackend(null);
    mem.clear();
  });

  it("預設啟用；關閉／重開往返", () => {
    setKvBackend(memKv);
    expect(updateCheckEnabled()).toBe(true);
    setUpdateCheckEnabled(false);
    expect(updateCheckEnabled()).toBe(false);
    setUpdateCheckEnabled(true);
    expect(updateCheckEnabled()).toBe(true);
  });

  it("狀態 round-trip；壞資料回 null", () => {
    setKvBackend(memKv);
    expect(loadUpdateState()).toBeNull();
    saveUpdateState({ lastCheck: NOW, available: "0.0.14" });
    expect(loadUpdateState()).toEqual({ lastCheck: NOW, available: "0.0.14" });
    saveUpdateState({ lastCheck: NOW, available: null });
    expect(loadUpdateState()).toEqual({ lastCheck: NOW, available: null });
    memKv.setItem("nb.updateCheck.state", "not-json");
    expect(loadUpdateState()).toBeNull();
    memKv.setItem("nb.updateCheck.state", JSON.stringify({ available: "x" }));
    expect(loadUpdateState()).toBeNull(); // 缺 lastCheck
  });
});
