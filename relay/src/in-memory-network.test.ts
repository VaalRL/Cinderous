// 記憶體網路的 close() 真的斷線（ADR-0399）：沒有它，stop() 過的後端會繼續收訊息、照樣反應，
// 測試靠這種「殭屍實例」通過而不自知（企業主重啟的測試就是這樣）。
import { finalizeEvent, generateSecretKey, type NostrEvent } from "@cinderous/core";
import { describe, expect, it } from "vitest";
import { createInMemoryRelayNetwork } from "./in-memory-network.js";

const sk = generateSecretKey();
const note = (content: string): NostrEvent =>
  finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [["t", "x"]], content }, sk);

describe("createInMemoryRelayNetwork 的 close()（ADR-0399）", () => {
  it("關掉之後收不到、送出的也不處理", () => {
    const net = createInMemoryRelayNetwork();
    const got: string[] = [];
    const reader = net.connect("r", { onEvent: (_s, e) => got.push(e.content) });
    reader.subscribe("s", [{ kinds: [1], "#t": ["x"] } as never]);
    const writer = net.connect("w");
    writer.publish(note("before"));
    reader.close();
    writer.publish(note("after"));
    expect(got).toEqual(["before"]);

    const heard: string[] = [];
    const listener = net.connect("l", { onEvent: (_s, e) => heard.push(e.content) });
    listener.subscribe("s", [{ kinds: [1], "#t": ["x"] } as never]);
    const quiet = net.connect("q");
    quiet.close();
    quiet.publish(note("ignored")); // 斷了線的送不出去：中繼不收、也不轉給別人
    expect(heard).toEqual([]);
  });

  it("中繼忘掉那條連線的訂閱：同一個 connId 重新連上是一條新的連線", () => {
    const net = createInMemoryRelayNetwork();
    const old = net.connect("r");
    old.subscribe("s", [{ kinds: [1], "#t": ["x"] } as never]);
    old.close();
    const got: string[] = [];
    net.connect("r", { onEvent: (_s, e) => got.push(e.content) }); // 沒有訂閱
    net.connect("w").publish(note("hi"));
    expect(got).toEqual([]);
  });

  it("同一個 connId 已經被新連線接手：舊的 close() 不影響新的", () => {
    const net = createInMemoryRelayNetwork();
    const old = net.connect("r");
    const got: string[] = [];
    const fresh = net.connect("r", { onEvent: (_s, e) => got.push(e.content) });
    fresh.subscribe("s", [{ kinds: [1], "#t": ["x"] } as never]);
    old.close();
    net.connect("w").publish(note("still"));
    expect(got).toEqual(["still"]);
  });
});
