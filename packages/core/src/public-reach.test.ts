import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "./keys.js";
import {
  buildInboxRelayList,
  buildOutboxRelayList,
  buildPublicName,
  INBOX_RELAY_LIST_KIND,
  OUTBOX_RELAY_LIST_KIND,
  PUBLIC_PROFILE_KIND,
  readInboxRelayList,
  readPublicName,
} from "./public-reach.js";

const sk = generateSecretKey();
const NOW = 1_800_000_000;

describe("公開聯絡方式的事件（ADR-0382）", () => {
  it("10050（NIP-17）：每座一個 `relay` 標籤、content 空；讀回同一份清單", () => {
    const e = buildInboxRelayList(sk, ["wss://a.example/s/1"], NOW);
    expect(e.kind).toBe(INBOX_RELAY_LIST_KIND);
    expect(e.kind).toBe(10050);
    expect(e.pubkey).toBe(getPublicKey(sk));
    expect(e.created_at).toBe(NOW);
    expect(e.content).toBe("");
    expect(e.tags).toEqual([["relay", "wss://a.example/s/1"]]);
    expect(readInboxRelayList(e)).toEqual(["wss://a.example/s/1"]);
  });

  it("10050 清空＝不含 `relay`：讀回空清單（關掉「能聯絡我」）", () => {
    const e = buildInboxRelayList(sk, [], NOW);
    expect(e.tags).toEqual([]);
    expect(readInboxRelayList(e)).toEqual([]);
  });

  it("10050 讀取：不是 10050、或不是 ws(s) 網址的略過；重複的合併", () => {
    const e = buildInboxRelayList(sk, ["wss://a.example/s/1", "wss://a.example/s/1", "https://x.example"], NOW);
    expect(readInboxRelayList(e)).toEqual(["wss://a.example/s/1"]);
    expect(readInboxRelayList({ ...e, kind: 10002 })).toBeNull();
  });

  it("10002（NIP-65）：只標 write 的 `r` 標籤", () => {
    const e = buildOutboxRelayList(sk, ["wss://a.example/s/1"], NOW);
    expect(e.kind).toBe(OUTBOX_RELAY_LIST_KIND);
    expect(e.kind).toBe(10002);
    expect(e.content).toBe("");
    expect(e.tags).toEqual([["r", "wss://a.example/s/1", "write"]]);
  });

  it("kind 0：只放 name——不放頭像或其他欄位", () => {
    const e = buildPublicName(sk, "Joe", NOW);
    expect(e.kind).toBe(PUBLIC_PROFILE_KIND);
    expect(e.kind).toBe(0);
    expect(JSON.parse(e.content)).toEqual({ name: "Joe" });
    expect(readPublicName(e)).toBe("Joe");
  });

  it("kind 0 清空＝`{}`：讀回 null（關掉「公開名稱」）；名稱前後空白去掉、空的視為沒有", () => {
    expect(JSON.parse(buildPublicName(sk, null, NOW).content)).toEqual({});
    expect(readPublicName(buildPublicName(sk, null, NOW))).toBeNull();
    expect(readPublicName(buildPublicName(sk, "  Joe  ", NOW))).toBe("Joe");
    expect(readPublicName(buildPublicName(sk, "   ", NOW))).toBeNull();
  });

  it("kind 0 讀取：content 不是 JSON、name 不是字串、不是 kind 0 都回 null", () => {
    const e = buildPublicName(sk, "Joe", NOW);
    expect(readPublicName({ ...e, content: "not json" })).toBeNull();
    expect(readPublicName({ ...e, content: JSON.stringify({ name: 42 }) })).toBeNull();
    expect(readPublicName({ ...e, kind: 10050 })).toBeNull();
  });
});
