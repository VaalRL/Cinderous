import { describe, expect, it } from "vitest";
import { OFFLINE_TIMEOUT_MS } from "@nostr-buddy/core";
import { PresenceStore } from "./presence-store.js";

const A = "aa".repeat(32);
const B = "bb".repeat(32);

describe("PresenceStore — 好友列表上線/離線檢視", () => {
  it("初始時所有好友皆離線", () => {
    const store = new PresenceStore([
      { pubkey: A, name: "Alice" },
      { pubkey: B, name: "Bob" },
    ]);
    const view = store.view(Date.now());
    expect(view).toEqual([
      { pubkey: A, name: "Alice", status: "offline" },
      { pubkey: B, name: "Bob", status: "offline" },
    ]);
  });

  it("收到心跳後該好友轉為上線，逾時後回離線", () => {
    const store = new PresenceStore([{ pubkey: A, name: "Alice" }]);
    const tSec = 1_700_000_000;
    store.onHeartbeat(A, tSec);
    expect(store.view(tSec * 1000)[0]?.status).toBe("online");
    expect(store.view(tSec * 1000 + OFFLINE_TIMEOUT_MS + 1)[0]?.status).toBe("offline");
  });

  it("非好友的心跳不影響檢視", () => {
    const store = new PresenceStore([{ pubkey: A, name: "Alice" }]);
    store.onHeartbeat(B, 1_700_000_000);
    expect(store.view(1_700_000_000 * 1000)[0]?.status).toBe("offline");
  });

  it("可由已驗證事件擷取心跳（kind/pubkey/created_at）", () => {
    const store = new PresenceStore([{ pubkey: A, name: "Alice" }]);
    const tSec = 1_700_000_000;
    store.ingestEvent({ kind: 20000, pubkey: A, created_at: tSec });
    expect(store.view(tSec * 1000)[0]?.status).toBe("online");
    // 非心跳 kind 不更新上線
    store.ingestEvent({ kind: 1, pubkey: A, created_at: tSec + 1000 });
    expect(store.view((tSec + 1000) * 1000 + OFFLINE_TIMEOUT_MS + 1)[0]?.status).toBe("offline");
  });
});
