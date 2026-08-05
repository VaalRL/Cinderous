// 解不開的密文保留（ADR-0325）。
import { describe, expect, it } from "vitest";
import {
  FS_PENDING_MAX,
  FS_PENDING_TTL_MS,
  prunePendingFs,
  retainPendingFs,
  type PendingFsEvent,
} from "./subkey.js";

const NOW = 1_800_000_000_000;
const mk = (id: string, at = NOW): PendingFsEvent => ({ id, at, json: `{"id":"${id}"}` });

describe("保留解不開的密文（ADR-0325）", () => {
  it("留得下來", () => {
    expect(retainPendingFs([], mk("a"), NOW).map((p) => p.id)).toEqual(["a"]);
  });

  it("🔴 同一顆不重複留，而且**原樣回傳**——呼叫端據此跳過一次寫入", () => {
    const list = retainPendingFs([], mk("a"), NOW);
    expect(retainPendingFs(list, mk("a"), NOW)).toBe(list);
  });

  it("🔴 滿了丟最舊的——上限是濫用防線，不是效能考量", () => {
    let list: PendingFsEvent[] = [];
    for (let i = 0; i < FS_PENDING_MAX + 5; i++) list = retainPendingFs(list, mk(`e${i}`), NOW + i);
    expect(list.length).toBe(FS_PENDING_MAX);
    expect(list[0]!.id).toBe("e5"); // 最舊的五顆被擠掉
    expect(list.at(-1)!.id).toBe(`e${FS_PENDING_MAX + 4}`);
  });

  it("逾期的丟掉；邊界上的還在（同 FS grace 的寫法）", () => {
    const list = [mk("old", NOW - FS_PENDING_TTL_MS - 1), mk("edge", NOW - FS_PENDING_TTL_MS), mk("new")];
    expect(prunePendingFs(list, NOW).map((p) => p.id)).toEqual(["edge", "new"]);
  });

  it("留新的時順手清逾期的（不必另外排一個清理時機）", () => {
    const list = [mk("old", NOW - FS_PENDING_TTL_MS - 1)];
    expect(retainPendingFs(list, mk("fresh"), NOW).map((p) => p.id)).toEqual(["fresh"]);
  });

  it("TTL 是 30 天", () => {
    expect(FS_PENDING_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
