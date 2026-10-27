import { describe, expect, it } from "vitest";
import { ANCHOR_RELAYS, PUBLIC_INDEX_RELAYS } from "./bootstrap-config.js";

describe("公開聯絡方式的索引中繼（ADR-0382 §2，2026-10-14 實測）", () => {
  it("三座專門收名片事件的索引中繼：每種事件至少兩座收", () => {
    // 實測：purplepag 三種都收；user.kindpag 不收 10050；indexer.coracle 不收 kind 0
    expect(PUBLIC_INDEX_RELAYS).toEqual([
      "wss://purplepag.es",
      "wss://user.kindpag.es",
      "wss://indexer.coracle.social",
    ]);
  });

  it("不含錨點、不重複、都是 wss——索引中繼只發布不訂閱，混進錨點會讓錨點被當成第三方", () => {
    expect(new Set(PUBLIC_INDEX_RELAYS).size).toBe(PUBLIC_INDEX_RELAYS.length);
    for (const url of PUBLIC_INDEX_RELAYS) {
      expect(url).toMatch(/^wss:\/\//);
      expect(ANCHOR_RELAYS).not.toContain(url);
    }
  });
});
