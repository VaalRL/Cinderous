// 記憶體網路的 close() 真的斷線（ADR-0399）：沒有它，stop() 過的後端會繼續收訊息、照樣反應，
// 測試靠這種「殭屍實例」通過而不自知（企業主重啟的測試就是這樣）。
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "@cinderous/core";
import { describe, expect, it, vi } from "vitest";
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
    expect(net.core.exportConn("r").subs).toHaveLength(1);
    old.close();
    // 直接看中繼：走 SDK 之後，收到不認得的訂閱 id 會被 SDK 丟掉，只看收件端看不出中繼有沒有忘（ADR-0400）
    expect(net.core.exportConn("r").subs).toEqual([]);
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

/** OK 經 SDK 的發布結果回來，晚一個微任務以上 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

describe("記憶體網路走 SDK 的連線層（ADR-0400）", () => {
  it("同步開啟：connect() 一回來就能訂閱、別人送的同步送達（引擎測試依賴這個時序）", () => {
    const net = createInMemoryRelayNetwork();
    const got: string[] = [];
    net.connect("r", { onEvent: (_s, e) => got.push(e.content) }).subscribe("s", [{ kinds: [1], "#t": ["x"] } as never]);
    net.connect("w").publish(note("now"));
    expect(got).toEqual(["now"]);
  });

  it("要求認證的中繼：NIP-42 由 SDK 完成，認證後訂閱與發布照常", async () => {
    const net = createInMemoryRelayNetwork({ requireAuth: true });
    const authSigner = (challenge: string) =>
      finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", ""], ["challenge", challenge]], content: "" }, sk);
    const got: string[] = [];
    // 認證模式下訂閱要指定 authors 或 #p（ADR-0123）
    net.connect("r", { authSigner, onEvent: (_s, e) => got.push(e.content) }).subscribe("s", [{ kinds: [1], authors: [getPublicKey(sk)] } as never]);
    await settle();
    const ok = vi.fn();
    net.connect("w", { authSigner, onOk: ok }).publish(note("authed"));
    await settle();
    expect(got).toEqual(["authed"]);
    expect(ok).toHaveBeenCalledWith(expect.any(String), true, "");
  });

  it("以 id 去重：同一則事件送兩次，訂閱端只收到一次（與正式環境相同，SDK ADR 0124）", () => {
    const net = createInMemoryRelayNetwork();
    const got: string[] = [];
    net.connect("r", { onEvent: (_s, e) => got.push(e.id) }).subscribe("s", [{ kinds: [1], "#t": ["x"] } as never]);
    const e = note("twice");
    net.connect("w1").publish(e);
    net.connect("w2").publish(e);
    expect(got).toEqual([e.id]);
  });

  it("OK 晚一個微任務才回；拒收帶中繼原話", async () => {
    const net = createInMemoryRelayNetwork({ allowedAuthors: [] });
    const ok = vi.fn();
    const e = note("no");
    net.connect("w", { onOk: ok }).publish(e);
    expect(ok).not.toHaveBeenCalled();
    await settle();
    expect(ok).toHaveBeenCalledWith(e.id, false, expect.stringMatching(/^blocked:/));
  });

  it("tap 看得到線上的每一個訊框，方向分得清楚", () => {
    const frames: string[] = [];
    const net = createInMemoryRelayNetwork({ tap: (c, d, f) => frames.push(`${c} ${d} ${(JSON.parse(f) as unknown[])[0]}`) });
    const e = note("seen");
    net.connect("w").publish(e);
    expect(frames).toEqual(["w out EVENT", "w in OK"]);
  });

  it("connectDirect（展示模式）：不經 SDK，OK 同步回、也能關", () => {
    const net = createInMemoryRelayNetwork();
    const ok = vi.fn();
    const got: string[] = [];
    const reader = net.connectDirect("r", { onEvent: (_s, e) => got.push(e.content) });
    reader.subscribe("s", [{ kinds: [1], "#t": ["x"] } as never]);
    net.connectDirect("w", { onOk: ok }).publish(note("direct"));
    expect(ok).toHaveBeenCalledTimes(1);
    expect(got).toEqual(["direct"]);
    reader.close();
    net.connectDirect("w2").publish(note("gone"));
    expect(got).toEqual(["direct"]);
  });
});
