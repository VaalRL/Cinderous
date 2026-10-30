// --state-dir（ADR-0404 §2）：Node 裡的檔案 localStorage，讓引擎原本的 LocalStorage 存得下來。
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDeviceId } from "@cinderous/engine";
import { FileKv, installStateDir, openStateDir, StateDirError, type StateDir } from "./state-dir.js";

const fresh = () => mkdtempSync(join(tmpdir(), "cinder-state-"));
const opened: StateDir[] = [];
const open = (dir: string, pubkey: string) => {
  const s = openStateDir(dir, pubkey);
  opened.push(s);
  return s;
};
afterEach(() => {
  for (const s of opened.splice(0)) s.release();
});

describe("FileKv：檔案為底的 localStorage", () => {
  it("寫進去的值，下一個程序（新的實例）讀得回來", () => {
    const file = join(fresh(), "state.json");
    const a = new FileKv(file);
    a.setItem("nb.x", "1");
    a.setItem("nb.y", "2");
    a.removeItem("nb.y");
    const b = new FileKv(file);
    expect(b.getItem("nb.x")).toBe("1");
    expect(b.getItem("nb.y")).toBeNull();
  });

  it("key()／length 跟瀏覽器的 localStorage 一樣（引擎掃對話鍵要用）", () => {
    const kv = new FileKv(join(fresh(), "state.json"));
    kv.setItem("a", "1");
    kv.setItem("b", "2");
    expect(kv.length).toBe(2);
    expect([kv.key(0), kv.key(1)].sort()).toEqual(["a", "b"]);
    expect(kv.key(2)).toBeNull();
    kv.clear();
    expect(kv.length).toBe(0);
  });

  it("檔案壞掉不會讓程序起不來，也不會靜默當成空的蓋掉——直接報錯", () => {
    const file = join(fresh(), "state.json");
    writeFileSync(file, "{not json");
    expect(() => new FileKv(file)).toThrow(StateDirError);
  });
});

describe("openStateDir：綁定身分＋獨占鎖", () => {
  it("同一個目錄換一把金鑰 → 報錯（否則讀出來全空、下一次寫入就把原本的狀態蓋掉）", () => {
    const dir = fresh();
    open(dir, "aa").release();
    opened.length = 0;
    expect(() => openStateDir(dir, "bb")).toThrow(/另一個身分/);
    // 報錯之後鎖要放掉：用對的金鑰還開得起來
    expect(() => open(dir, "aa")).not.toThrow();
  });

  it("同一個目錄同時只能有一個程序", () => {
    const dir = fresh();
    const first = open(dir, "aa");
    expect(() => openStateDir(dir, "aa")).toThrow(/正在被另一個/);
    first.release();
    opened.length = 0;
    expect(() => open(dir, "aa")).not.toThrow();
  });

  it("前一個程序當掉留下的鎖（pid 已不在）可以接手", () => {
    const dir = fresh();
    writeFileSync(join(dir, "lock"), "999999999");
    expect(() => open(dir, "aa")).not.toThrow();
  });

  it("裝進全域之後，引擎的裝置 id 跨程序固定（不再每跑一次多一份裝置報告）", () => {
    const dir = fresh();
    const a = open(dir, "aa");
    installStateDir(a);
    const id = getDeviceId();
    a.release();
    opened.length = 0;
    const b = open(dir, "aa");
    installStateDir(b);
    expect(getDeviceId()).toBe(id);
  });
});
