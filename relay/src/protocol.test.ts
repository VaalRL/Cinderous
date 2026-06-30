import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey } from "@nostr-buddy/core";
import { parseClientMessage } from "./protocol.js";

const evt = finalizeEvent(
  { kind: 20000, created_at: 1700000000, tags: [], content: "" },
  generateSecretKey(),
);

describe("Nostr 客戶端訊息解析", () => {
  it("解析 EVENT", () => {
    const msg = parseClientMessage(JSON.stringify(["EVENT", evt]));
    expect(msg).toEqual({ type: "EVENT", event: evt });
  });

  it("解析 REQ（含多個 filter）", () => {
    const raw = JSON.stringify(["REQ", "sub1", { kinds: [20000] }, { authors: ["ab"] }]);
    expect(parseClientMessage(raw)).toEqual({
      type: "REQ",
      subId: "sub1",
      filters: [{ kinds: [20000] }, { authors: ["ab"] }],
    });
  });

  it("REQ 無 filter 時預設為單一空 filter", () => {
    const msg = parseClientMessage(JSON.stringify(["REQ", "sub1"]));
    expect(msg).toEqual({ type: "REQ", subId: "sub1", filters: [{}] });
  });

  it("解析 CLOSE", () => {
    expect(parseClientMessage(JSON.stringify(["CLOSE", "sub1"]))).toEqual({
      type: "CLOSE",
      subId: "sub1",
    });
  });

  it("非法 JSON 或未知類型回傳 INVALID", () => {
    expect(parseClientMessage("not json").type).toBe("INVALID");
    expect(parseClientMessage(JSON.stringify(["FOO"])).type).toBe("INVALID");
    expect(parseClientMessage(JSON.stringify("x")).type).toBe("INVALID");
  });
});
