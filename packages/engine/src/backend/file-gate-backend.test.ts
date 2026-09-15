// `checkFileSend` 的對象解析（ADR-0344 §後續行動 1）。
//
// 純判定（門檻、relay 優先於 unknown）由 `file-gate.test.ts` 蓋掉；這裡驗的是**後端把
// 「一個 `to`」解析成「哪些人的路徑要查」**——1:1 是一個人，群組是逐一扇出的每位成員
// （自己除外）。這條解析錯了，群組送檔的把關就會整個失效或誤報。

import { describe, expect, it } from "vitest";
import { createInMemoryRelayNetwork } from "@cinderous/relay";
import { generateSecretKey, getPublicKey, nsecEncode } from "@cinderous/core";
import { MemoryStorage } from "../storage/memory.js";
import { RelayChatBackend } from "./relay-backend.js";
import type { IcePath } from "./ice-path.js";

const noop = new Proxy({}, { get: () => () => {} }) as never;
const MB = 1024 * 1024;
const BIG = 60 * MB; // > 50 MB 門檻
const SMALL = 1 * MB;

/** 開一個真實後端，並把 ICE 路徑探測換成查表（node 沒有真的 WebRTC）。 */
function boot(paths: Record<string, IcePath>) {
  const net = createInMemoryRelayNetwork();
  const sk = generateSecretKey();
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name: "我" });
  const backend = new RelayChatBackend(store, (h) => net.connect("a", h), "我");
  backend.start(noop);
  const transfer = (backend as unknown as { transfer: { refreshIcePath(pk: string): Promise<IcePath> } }).transfer;
  const asked: string[] = [];
  transfer.refreshIcePath = (pk: string): Promise<IcePath> => {
    asked.push(pk);
    return Promise.resolve(paths[pk] ?? "unknown");
  };
  return { backend, store, self: getPublicKey(sk), asked };
}

const peer = (): string => getPublicKey(generateSecretKey());

describe("checkFileSend — 1:1", () => {
  it("對方直連的大檔 → 不提示", async () => {
    const p = peer();
    const { backend } = boot({ [p]: "direct" });
    expect(await backend.checkFileSend(p, BIG)).toBeNull();
  });

  it("對方在中繼上的大檔 → 提示（relay）", async () => {
    const p = peer();
    const { backend } = boot({ [p]: "relay" });
    expect(await backend.checkFileSend(p, BIG)).toEqual({ sizeBytes: BIG, path: "relay" });
  });

  it("小檔一律不提示，即使走中繼", async () => {
    const p = peer();
    const { backend } = boot({ [p]: "relay" });
    expect(await backend.checkFileSend(p, SMALL)).toBeNull();
  });

  it("查的就是那一個人", async () => {
    const p = peer();
    const { backend, asked } = boot({ [p]: "direct" });
    await backend.checkFileSend(p, BIG);
    expect(asked).toEqual([p]);
  });
});

describe("checkFileSend — 群組扇出（ADR-0124）", () => {
  /** 建一個含指定成員的群，回傳 groupId。 */
  const withGroup = (paths: Record<string, IcePath>, members: string[]) => {
    const booted = boot(paths);
    booted.backend.createGroup("群", members);
    const group = booted.store.loadGroups()[0]!;
    return { ...booted, groupId: group.id, group };
  };

  it("成員全直連 → 不提示", async () => {
    const [a, b] = [peer(), peer()];
    const { backend, groupId } = withGroup({ [a]: "direct", [b]: "direct" }, [a, b]);
    expect(await backend.checkFileSend(groupId, BIG)).toBeNull();
  });

  it("🔴 任一成員在中繼上就提示——逐一扇出，一個人在 TURN 上就是一份完整流量", async () => {
    const [a, b] = [peer(), peer()];
    const { backend, groupId } = withGroup({ [a]: "direct", [b]: "relay" }, [a, b]);
    expect(await backend.checkFileSend(groupId, BIG)).toMatchObject({ path: "relay" });
  });

  it("relay 優先於 unknown", async () => {
    const [a, b] = [peer(), peer()];
    const { backend, groupId } = withGroup({ [a]: "unknown", [b]: "relay" }, [a, b]);
    expect(await backend.checkFileSend(groupId, BIG)).toMatchObject({ path: "relay" });
  });

  it("🔴 不查自己——自己永遠不是收件人，查了只會多一筆 unknown 而誤報", async () => {
    const [a, b] = [peer(), peer()];
    const { backend, groupId, asked, self, group } = withGroup({ [a]: "direct", [b]: "direct" }, [a, b]);
    await backend.checkFileSend(groupId, BIG);
    expect(group.members).toContain(self); // 前提：自己確實在成員名單裡
    expect(asked).not.toContain(self);
    expect(asked.sort()).toEqual([a, b].sort());
  });

  it("群組小檔不提示", async () => {
    const a = peer();
    const { backend, groupId } = withGroup({ [a]: "relay" }, [a]);
    expect(await backend.checkFileSend(groupId, SMALL)).toBeNull();
  });
});
