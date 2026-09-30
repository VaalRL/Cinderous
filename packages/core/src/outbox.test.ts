import { describe, expect, it } from "vitest";
import type { NostrEvent } from "./event.js";
import { classifyOk, okRetryElsewhere, Outbox, type OutboxOptions } from "./outbox.js";

const ev = (id: string): NostrEvent =>
  ({ id, pubkey: "p", created_at: 0, kind: 1059, tags: [], content: "", sig: "" }) as NostrEvent;

function harness(opts: Partial<OutboxOptions> = {}) {
  let now = 1000;
  const sent: string[] = [];
  const dropped: { id: string; reason: string }[] = [];
  const box = new Outbox({
    send: (e) => sent.push(e.id),
    onDrop: (e, reason) => dropped.push({ id: e.id, reason }),
    now: () => now,
    ...opts,
  });
  return { box, sent, dropped, advance: (ms: number) => (now += ms), setNow: (v: number) => (now = v) };
}

describe("classifyOk", () => {
  it("accepted 或 duplicate → confirmed", () => {
    expect(classifyOk(true, "")).toBe("confirmed");
    expect(classifyOk(false, "duplicate: have it")).toBe("confirmed");
  });
  it("rate-limited / error / 未知 → retry", () => {
    expect(classifyOk(false, "rate-limited: slow down")).toBe("retry");
    expect(classifyOk(false, "error: try again")).toBe("retry");
    expect(classifyOk(false, "")).toBe("retry");
  });
  it("blocked / invalid / pow / restricted / mute → permanent", () => {
    for (const m of ["blocked: spam", "invalid: bad sig", "pow: need 20", "restricted:", "mute: quiet"]) {
      expect(classifyOk(false, m)).toBe("permanent");
    }
  });
});

describe("Outbox 節流送出", () => {
  it("enqueue 重複 id 只算一次", () => {
    const { box } = harness();
    box.enqueue(ev("a"));
    box.enqueue(ev("a"));
    expect(box.size).toBe(1);
  });

  it("pump 受 maxInflight 限制併發", () => {
    const { box, sent } = harness({ maxInflight: 2 });
    for (const id of ["a", "b", "c", "d"]) box.enqueue(ev(id));
    box.pump();
    expect(sent).toEqual(["a", "b"]); // FIFO，僅 2 個在途
    expect(box.inflight).toBe(2);
    box.pump(); // 仍滿載，不再送
    expect(sent).toEqual(["a", "b"]);
  });

  it("確認後釋放併發，下次 pump 續送", () => {
    const { box, sent } = harness({ maxInflight: 2 });
    for (const id of ["a", "b", "c"]) box.enqueue(ev(id));
    box.pump();
    box.onOk("a", true, "");
    expect(box.size).toBe(2);
    box.pump();
    expect(sent).toEqual(["a", "b", "c"]);
  });
});

describe("Outbox OK 感知重試", () => {
  it("永久拒收 → onDrop 並移除", () => {
    const { box, dropped } = harness();
    box.enqueue(ev("a"));
    box.pump();
    box.onOk("a", false, "invalid: bad sig");
    expect(dropped).toEqual([{ id: "a", reason: "invalid: bad sig" }]);
    expect(box.size).toBe(0);
  });

  it("暫時拒收 → 退避重排、時間到才重送", () => {
    const { box, sent, advance } = harness({ backoffBaseMs: 500 });
    box.enqueue(ev("a"));
    box.pump();
    expect(sent).toEqual(["a"]);
    box.onOk("a", false, "rate-limited: slow");
    box.pump(); // 尚在退避中，不送
    expect(sent).toEqual(["a"]);
    advance(500);
    box.pump();
    expect(sent).toEqual(["a", "a"]); // 退避到期後重送
  });

  it("超過重試上限 → onDrop", () => {
    const { box, dropped, advance } = harness({ maxRetries: 2, backoffBaseMs: 100 });
    box.enqueue(ev("a"));
    for (let i = 0; i < 3; i++) {
      box.pump();
      advance(10_000);
      box.onOk("a", false, "rate-limited");
    }
    expect(dropped).toEqual([{ id: "a", reason: "rate-limited" }]);
    expect(box.size).toBe(0);
  });
});

describe("Outbox 重連補送與逾時", () => {
  it("重連把未確認在途改回 queued、pump 補送", () => {
    const { box, sent } = harness();
    box.enqueue(ev("a"));
    box.pump();
    expect(box.inflight).toBe(1);
    box.onReconnect();
    box.pump();
    expect(sent).toEqual(["a", "a"]);
  });

  it("在途逾未收 OK 逾時 → 靜默丟棄（不回報失敗）", () => {
    const { box, dropped, sent, advance } = harness({ inflightTtlMs: 5000, maxInflight: 1 });
    box.enqueue(ev("a"));
    box.enqueue(ev("b"));
    box.pump();
    expect(sent).toEqual(["a"]);
    advance(5000);
    box.pump(); // a 逾時丟棄、釋放併發後送 b
    expect(dropped).toEqual([]); // 逾時不算失敗
    expect(sent).toEqual(["a", "b"]);
  });
});

describe("依中繼詞元分類（ADR-0378；ADR-0376、SDK ADR 0040）", () => {
  it("blocked: ceiling: ／ blocked: quota: → retry（中繼滿了：稍後重試、改用其他座）", () => {
    expect(classifyOk(false, "blocked: ceiling: 本站離線留言空間已滿，這則未保存也未轉送；請改用其他中繼或稍後再試")).toBe("retry");
    expect(classifyOk(false, "blocked: quota: 這個作者的可尋址資料總量已達上限")).toBe("retry");
    expect(okRetryElsewhere("blocked: ceiling: 滿了")).toBe(true);
    expect(okRetryElsewhere("blocked: quota: 滿了")).toBe(true);
  });

  it("rate-limited → retry，但不換座（別把量平移過去）", () => {
    expect(classifyOk(false, "rate-limited: events: 發送過於頻繁")).toBe("retry");
    expect(okRetryElsewhere("rate-limited: events: 發送過於頻繁")).toBe(false);
  });

  it("invalid／not-allowed／too-large／stale 等其他 blocked → 永久失敗（與 v0.0.18 相同）", () => {
    for (const m of [
      "invalid: expired: 事件已過期",
      "invalid: bad-signature: 簽章驗證失敗",
      "blocked: not-allowed: 非本企業成員（allowlist）",
      "blocked: kind-disabled: 此事件類型已被政策停用",
      "blocked: too-large: 事件過大",
      "blocked: stale: 這個位址已有較新的事件",
      "blocked: 取代事件遭拒（配額/大小/較舊）",
      "blocked: 非本企業成員（allowlist）",
    ]) {
      expect(classifyOk(false, m), m).toBe("permanent");
      expect(okRetryElsewhere(m), m).toBe(false);
    }
  });

  it("duplicate（OK true 或舊中繼的 OK false）→ confirmed", () => {
    expect(classifyOk(true, "duplicate: seen: 事件重複")).toBe("confirmed");
    expect(classifyOk(false, "duplicate: 事件重複")).toBe("confirmed");
  });

  it("ceiling 之後的重送帶 elsewhere（呼叫端改用其他座）；rate-limited 的重送不帶", () => {
    const calls: [string, unknown][] = [];
    const { box, advance } = harness({ send: (e, o) => calls.push([e.id, o]) });
    box.enqueue(ev("a"));
    box.enqueue(ev("b"));
    box.pump();
    box.onOk("a", false, "blocked: ceiling: 滿了");
    box.onOk("b", false, "rate-limited: events: 慢一點");
    advance(800);
    box.pump();
    expect(calls).toEqual([
      ["a", undefined],
      ["b", undefined],
      ["a", { elsewhere: true }],
      ["b", undefined],
    ]);
  });

  it("換座之後有一座收下 → 確認；一直滿 → 重試耗盡才回報失敗", () => {
    const { box, dropped, advance } = harness({ maxRetries: 2 });
    box.enqueue(ev("a"));
    box.pump();
    for (let i = 0; i < 3; i++) {
      box.onOk("a", false, "blocked: ceiling: 滿了");
      advance(10_000);
      box.pump();
    }
    expect(dropped).toEqual([{ id: "a", reason: "blocked: ceiling: 滿了" }]);
    box.enqueue(ev("b"));
    box.pump();
    box.onOk("b", false, "blocked: ceiling: 滿了");
    advance(800);
    box.pump();
    box.onOk("b", true, "");
    expect(box.size).toBe(0);
  });
});
