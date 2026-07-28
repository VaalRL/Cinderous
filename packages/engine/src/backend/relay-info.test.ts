import { describe, expect, it, vi } from "vitest";
import {
  fetchRelayInfo,
  parseDonations,
  parseRelayInfo,
  relayInfoEndpoint,
  type RelayInfoFetch,
} from "./relay-info.js";

const doc = (donations: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown => ({
  name: "某某節點",
  cinder_donations: donations,
  ...extra,
});

const okFetch = (json: unknown): RelayInfoFetch => () =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });

describe("NIP-11 贊助資訊解析（ADR-0262）", () => {
  describe("scheme 白名單——營運者自報的字串會變成可點連結", () => {
    it("三個平台只收 https", () => {
      expect(parseDonations(doc({ github_sponsors: "https://github.com/sponsors/op" }))).toEqual([
        { channel: "github_sponsors", url: "https://github.com/sponsors/op" },
      ]);
      // http 明文：贊助頁會輸入付款資訊，沒有可接受的理由
      expect(parseDonations(doc({ github_sponsors: "http://github.com/sponsors/op" }))).toEqual([]);
    });

    it("丟棄 javascript: / data: / file: 等危險 scheme", () => {
      for (const bad of [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        "vbscript:msgbox",
      ]) {
        expect(parseDonations(doc({ liberapay: bad }))).toEqual([]);
      }
    });

    it("非字串、空白、超長值一律丟棄", () => {
      expect(parseDonations(doc({ buy_me_a_coffee: 42 }))).toEqual([]);
      expect(parseDonations(doc({ buy_me_a_coffee: "   " }))).toEqual([]);
      expect(parseDonations(doc({ buy_me_a_coffee: `https://x.example/${"a".repeat(600)}` }))).toEqual([]);
    });
  });

  describe("lightning 正規化", () => {
    it("LN 位址與 LNURL 都轉成 lightning: deep link", () => {
      expect(parseDonations(doc({ lightning: "op@example.com" }))).toEqual([
        { channel: "lightning", url: "lightning:op@example.com" },
      ]);
      expect(parseDonations(doc({ lightning: "lnurl1dp68gurn8ghj7" }))).toEqual([
        { channel: "lightning", url: "lightning:lnurl1dp68gurn8ghj7" },
      ]);
    });

    it("已帶前綴不重複加", () => {
      expect(parseDonations(doc({ lightning: "lightning:op@example.com" }))[0]!.url).toBe("lightning:op@example.com");
    });

    it("夾帶空白或協定分隔符的怪值丟棄", () => {
      expect(parseDonations(doc({ lightning: "op@example.com https://evil.example" }))).toEqual([]);
      expect(parseDonations(doc({ lightning: "javascript:alert(1)" }))).toEqual([]);
    });
  });

  it("順序固定，不隨文件鍵順序跳動", () => {
    const d = parseDonations(
      doc({ lightning: "op@example.com", liberapay: "https://liberapay.com/op", github_sponsors: "https://github.com/sponsors/op" }),
    );
    expect(d.map((x) => x.channel)).toEqual(["github_sponsors", "liberapay", "lightning"]);
  });

  describe("parseRelayInfo", () => {
    it("沒有任何合法贊助項目 → undefined（呼叫端據此不顯示卡片）", () => {
      expect(parseRelayInfo({})).toBeUndefined();
      expect(parseRelayInfo(doc({}))).toBeUndefined();
      expect(parseRelayInfo(doc({ github_sponsors: "javascript:alert(1)" }))).toBeUndefined();
      expect(parseRelayInfo(null)).toBeUndefined();
      expect(parseRelayInfo("not an object")).toBeUndefined();
    });

    it("有合法項目 → 帶站名（供 UI 標示是哪一座）", () => {
      const info = parseRelayInfo(doc({ github_sponsors: "https://github.com/sponsors/op" }));
      expect(info?.name).toBe("某某節點");
      expect(info?.donations).toHaveLength(1);
    });

    it("站名超長/非字串則省略，但贊助項目仍顯示", () => {
      const info = parseRelayInfo(doc({ liberapay: "https://liberapay.com/op" }, { name: "x".repeat(200) }));
      expect(info?.name).toBeUndefined();
      expect(info?.donations).toHaveLength(1);
    });
  });

  describe("端點推導", () => {
    it("wss→https、ws→http，主機小寫", () => {
      expect(relayInfoEndpoint("wss://Relay.Example")).toBe("https://relay.example/");
      expect(relayInfoEndpoint("ws://localhost:8787")).toBe("http://localhost:8787/");
    });
    it("非 ws(s) → undefined", () => {
      expect(relayInfoEndpoint("https://x")).toBeUndefined();
      expect(relayInfoEndpoint(undefined)).toBeUndefined();
    });
  });

  describe("fetchRelayInfo：任何失敗都是 undefined，絕不吵", () => {
    it("帶 Accept: application/nostr+json（否則中繼回純文字）", async () => {
      const spy = vi.fn(okFetch(doc({ github_sponsors: "https://github.com/sponsors/op" })));
      await fetchRelayInfo("wss://relay.example", spy);
      expect(spy).toHaveBeenCalledWith("https://relay.example/", {
        method: "GET",
        headers: { Accept: "application/nostr+json" },
      });
    });

    it("非 2xx → undefined", async () => {
      const f: RelayInfoFetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      expect(await fetchRelayInfo("wss://relay.example", f)).toBeUndefined();
    });

    it("網路錯誤 → undefined（不拋、不拖垮任何東西）", async () => {
      const f: RelayInfoFetch = () => Promise.reject(new Error("offline"));
      await expect(fetchRelayInfo("wss://relay.example", f)).resolves.toBeUndefined();
    });

    it("回應不是 JSON → undefined", async () => {
      const f: RelayInfoFetch = () =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("not json")) });
      await expect(fetchRelayInfo("wss://relay.example", f)).resolves.toBeUndefined();
    });

    it("成功但無贊助欄位 → undefined", async () => {
      expect(await fetchRelayInfo("wss://relay.example", okFetch({ name: "無贊助節點" }))).toBeUndefined();
    });
  });
});
