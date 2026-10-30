// --state-dir（ADR-0404 §2）：Node 裡的檔案 localStorage，讓引擎原本的 LocalStorage 存得下來。
import { mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDeviceId } from "@cinderous/engine";
import { FileKv, installMemoryKv, installStateDir, openStateDir, resolveName, StateDirError, type StateDir } from "./state-dir.js";

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

  it("🔴 剛建立、還沒寫進 pid 的鎖（空檔）＝有人正在拿，不能當成殘留鎖搶走（2026-10-30 審查）", () => {
    const dir = fresh();
    writeFileSync(join(dir, "lock"), "");
    expect(() => openStateDir(dir, "aa")).toThrow(/正在被另一個/);
  });

  it("空的或看不懂的鎖放久了（當掉在寫入前）才接手", () => {
    const dir = fresh();
    const lock = join(dir, "lock");
    writeFileSync(lock, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(() => open(dir, "aa")).not.toThrow();
    expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
  });

  it("拿鎖不留暫存檔；鎖的內容一出現就是完整的 pid", () => {
    const dir = fresh();
    open(dir, "aa");
    expect(readFileSync(join(dir, "lock"), "utf8")).toBe(String(process.pid));
    expect(readdirSync(dir).sort()).toEqual(["lock", "state.json"]);
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

describe("沒給 --state-dir：純記憶體的 localStorage", () => {
  // Node 25 起內建全域 localStorage，沒給 --localstorage-file 時一碰就印 ExperimentalWarning——
  // agent 讀 stderr 會被這行干擾。CLI 自己裝一份記憶體的，蓋掉內建那份；不落地。
  it("裝上後讀寫都在記憶體、裝置 id 也取得到", () => {
    const kv = installMemoryKv();
    expect(globalThis.localStorage).toBe(kv);
    localStorage.setItem("x", "1");
    expect(kv.getItem("x")).toBe("1");
    expect(getDeviceId()).toMatch(/.+/);
    expect(kv.length).toBeGreaterThan(0);
  });
});

describe("--name 記在狀態目錄（2026-10-30 實機對接）", () => {
  // 名稱每次送給對方；有一次忘了帶，對方 App 裡的名稱就被改回「cli」。
  it("給了就記住；下次沒給沿用記住的", () => {
    const dir = fresh();
    const a = open(dir, "aa");
    expect(resolveName(a.kv, "Claude")).toBe("Claude");
    a.release();
    const b = open(dir, "aa");
    expect(resolveName(b.kv, undefined)).toBe("Claude");
    expect(resolveName(b.kv, "Claude（家裡）")).toBe("Claude（家裡）"); // 明確給新的就換
    expect(resolveName(b.kv, undefined)).toBe("Claude（家裡）");
  });
  it("沒有狀態目錄、也沒給 → 預設 cli", () => {
    expect(resolveName(undefined, undefined)).toBe("cli");
    expect(resolveName(undefined, "Claude")).toBe("Claude");
  });
});
