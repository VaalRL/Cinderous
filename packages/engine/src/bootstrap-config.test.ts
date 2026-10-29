import { describe, expect, it } from "vitest";
import { ANCHOR_RELAYS, PUBLIC_INBOX_RELAYS, PUBLIC_INDEX_RELAYS, publicInboxRelaysFor } from "./bootstrap-config.js";

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

describe("公共收件中繼（ADR-0402，2026-10-29 實測）", () => {
  it("兩座大型公共中繼：不認證就收、也讀得回寄給某人的 1059", () => {
    expect(PUBLIC_INBOX_RELAYS).toEqual(["wss://nos.lol", "wss://relay.primal.net"]);
  });

  it("🔴 不含錨點的主機：公開清單一旦指回主平面，外流後爬蟲會吃錨點的額度（ADR-0394）", () => {
    const anchorHosts = ANCHOR_RELAYS.map((u) => new URL(u).host);
    expect(new Set(PUBLIC_INBOX_RELAYS).size).toBe(PUBLIC_INBOX_RELAYS.length);
    for (const url of PUBLIC_INBOX_RELAYS) {
      expect(url).toMatch(/^wss:\/\//);
      expect(anchorHosts).not.toContain(new URL(url).host);
      expect(PUBLIC_INDEX_RELAYS).not.toContain(url);
    }
  });

  it("home 在官方錨點上（分片或根路徑，手機版用的是根路徑）才用；自架的照舊列自己", () => {
    for (const anchor of ANCHOR_RELAYS) {
      expect(publicInboxRelaysFor(anchor)).toEqual(PUBLIC_INBOX_RELAYS);
      expect(publicInboxRelaysFor(`${anchor}/s/1a`)).toEqual(PUBLIC_INBOX_RELAYS);
    }
    expect(publicInboxRelaysFor("wss://my-own-relay.example")).toEqual([]);
    expect(publicInboxRelaysFor(undefined)).toEqual([]);
    expect(publicInboxRelaysFor("not a url")).toEqual([]);
  });
});
