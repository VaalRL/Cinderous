import { describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type NostrEvent,
} from "@nostr-buddy/core";
import { MessageStore } from "./message-store.js";
import { RelayCore } from "./relay-core.js";

function heartbeat(): NostrEvent {
  return finalizeEvent(
    { kind: 20000, created_at: 1700000000, tags: [], content: "" },
    generateSecretKey(),
  );
}

const REQ = (sub: string, filter: object) => JSON.stringify(["REQ", sub, filter]);
const EVENT = (e: NostrEvent) => JSON.stringify(["EVENT", e]);

describe("RelayCore — 訂閱與 Ephemeral 轉發", () => {
  it("REQ 立即回 EOSE（M1 無歷史事件）", () => {
    const core = new RelayCore();
    core.connect("c1");
    const out = core.handle("c1", REQ("s1", { kinds: [20000] }));
    expect(out).toEqual([{ to: "c1", message: ["EOSE", "s1"] }]);
  });

  it("心跳事件扇出給符合 filter 的其他連線，並回 OK 給發送者", () => {
    const core = new RelayCore();
    core.connect("sender");
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [20000] }));

    const e = heartbeat();
    const out = core.handle("sender", EVENT(e));

    expect(out).toContainEqual({ to: "sender", message: ["OK", e.id, true, ""] });
    expect(out).toContainEqual({ to: "watcher", message: ["EVENT", "s1", e] });
  });

  it("不符 filter（kinds 不同）不轉發", () => {
    const core = new RelayCore();
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [1] }));
    const out = core.handle("sender", EVENT(heartbeat()));
    expect(out.some((o) => o.to === "watcher")).toBe(false);
  });

  it("簽章無效的事件回 OK=false 且不轉發", () => {
    const core = new RelayCore();
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [20000] }));
    const e = heartbeat();
    const out = core.handle("sender", EVENT({ ...e, content: "tampered" }));
    expect(out).toEqual([
      { to: "sender", message: ["OK", e.id, false, "invalid: 簽章驗證失敗"] },
    ]);
  });

  it("Ephemeral（20000-29999）絕不寫入持久層", () => {
    const store = new MessageStore();
    const core = new RelayCore({ store, now: () => 0 });
    core.connect("sender");
    core.handle("sender", EVENT(heartbeat()));
    expect(store.query({ kinds: [20000] }, 0)).toEqual([]);
  });

  it("非 Ephemeral 事件才會寫入持久層", () => {
    const store = new MessageStore();
    const core = new RelayCore({ store, now: () => 0 });
    core.connect("sender");
    const e = finalizeEvent(
      { kind: 1, created_at: 1700000000, tags: [], content: "hi" },
      generateSecretKey(),
    );
    core.handle("sender", EVENT(e));
    expect(store.query({ kinds: [1] }, 0)).toEqual([e]);
  });

  it("REQ 會回放符合的歷史留言，最後送 EOSE", () => {
    const store = new MessageStore();
    const core = new RelayCore({ store, now: () => 100 });
    const to = getPublicKey(generateSecretKey());
    const dm = finalizeEvent(
      { kind: 1059, created_at: 100, tags: [["p", to]], content: "x" },
      generateSecretKey(),
    );
    core.connect("sender");
    core.handle("sender", EVENT(dm));

    core.connect("reader");
    const out = core.handle("reader", REQ("s1", { kinds: [1059], "#p": [to] }));
    expect(out).toEqual([
      { to: "reader", message: ["EVENT", "s1", dm] },
      { to: "reader", message: ["EOSE", "s1"] },
    ]);
  });

  it("CLOSE 後不再收到轉發", () => {
    const core = new RelayCore();
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [20000] }));
    core.handle("watcher", JSON.stringify(["CLOSE", "s1"]));
    const out = core.handle("sender", EVENT(heartbeat()));
    expect(out.some((o) => o.to === "watcher")).toBe(false);
  });

  it("斷線會清除其訂閱", () => {
    const core = new RelayCore();
    core.connect("watcher");
    core.handle("watcher", REQ("s1", { kinds: [20000] }));
    core.disconnect("watcher");
    const out = core.handle("sender", EVENT(heartbeat()));
    expect(out.some((o) => o.to === "watcher")).toBe(false);
  });
});
