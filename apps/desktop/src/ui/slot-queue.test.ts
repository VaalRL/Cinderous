import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  enqueueSlot,
  loadSlotQueue,
  nextPending,
  removeSlot,
  retryFailed,
  saveSlotQueue,
  setSlotStatus,
  type SlotItem,
} from "./slot-queue.js";

const item = (over: Partial<Omit<SlotItem, "id" | "status">> = {}): Omit<SlotItem, "id" | "status"> => ({
  path: "C:/docs/a.pdf",
  name: "a.pdf",
  size: 10,
  mime: "application/pdf",
  origin: "與小美的對話",
  queuedAt: 1000,
  ...over,
});

describe("公司儲存槽佇列（ADR-0161）", () => {
  it("enqueue：同路徑排隊/傳輸中不重複；狀態流轉與重試", () => {
    let q = enqueueSlot([], item());
    expect(q.length).toBe(1);
    expect(q[0]!.status).toBe("pending");
    q = enqueueSlot(q, item()); // 重複路徑 → 略過
    expect(q.length).toBe(1);
    q = setSlotStatus(q, q[0]!.id, "failed");
    q = enqueueSlot(q, item()); // 失敗後可再排（重新存放）
    expect(q.length).toBe(2);
    expect(nextPending(q)?.id).toBe(q[1]!.id);
    q = retryFailed(q);
    expect(q[0]!.status).toBe("pending");
    q = removeSlot(q, q[0]!.id);
    expect(q.length).toBe(1);
  });

  describe("持久化", () => {
    beforeEach(() => {
      const store = new Map<string, string>();
      (globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      };
    });
    afterEach(() => {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it("round-trip；開機時 sending（中斷）退回 pending；毀損回空", () => {
      let q = enqueueSlot([], item());
      q = setSlotStatus(q, q[0]!.id, "sending");
      saveSlotQueue("me", q);
      const loaded = loadSlotQueue("me");
      expect(loaded[0]!.status).toBe("pending"); // 中斷的傳輸重排
      localStorage.setItem("nb.slotQueue.me", "not json");
      expect(loadSlotQueue("me")).toEqual([]);
    });
  });
});
