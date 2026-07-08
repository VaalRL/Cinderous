import { describe, expect, it, vi } from "vitest";
import { createHeartbeat } from "./heartbeat.js";
import { generateSecretKey, getPublicKey } from "./keys.js";
import { buildAuthEvent } from "./nip42.js";
import { RelayClient } from "./relay-client.js";

function setup() {
  const sent: string[] = [];
  const client = new RelayClient({ send: (d) => sent.push(d) });
  return { sent, client };
}

describe("RelayClient — 送出", () => {
  it("publish 送出 [\"EVENT\", event]", () => {
    const { sent, client } = setup();
    const e = createHeartbeat(generateSecretKey(), { created_at: 1 });
    client.publish(e);
    expect(JSON.parse(sent[0]!)).toEqual(["EVENT", e]);
  });

  it("subscribe 送出 [\"REQ\", subId, ...filters]", () => {
    const { sent, client } = setup();
    client.subscribe("s1", [{ kinds: [20000], authors: ["ab"] }]);
    expect(JSON.parse(sent[0]!)).toEqual(["REQ", "s1", { kinds: [20000], authors: ["ab"] }]);
  });

  it("unsubscribe 送出 [\"CLOSE\", subId]", () => {
    const { sent, client } = setup();
    client.unsubscribe("s1");
    expect(JSON.parse(sent[0]!)).toEqual(["CLOSE", "s1"]);
  });
});

describe("RelayClient — 接收分派", () => {
  it("EVENT/EOSE/OK/NOTICE 分派至對應 handler", () => {
    const onEvent = vi.fn();
    const onEose = vi.fn();
    const onOk = vi.fn();
    const onNotice = vi.fn();
    const client = new RelayClient({ send: () => {} }, { onEvent, onEose, onOk, onNotice });
    const e = createHeartbeat(generateSecretKey(), { created_at: 1 });

    client.receive(JSON.stringify(["EVENT", "s1", e]));
    client.receive(JSON.stringify(["EOSE", "s1"]));
    client.receive(JSON.stringify(["OK", e.id, true, ""]));
    client.receive(JSON.stringify(["NOTICE", "hello"]));

    expect(onEvent).toHaveBeenCalledWith("s1", e);
    expect(onEose).toHaveBeenCalledWith("s1");
    expect(onOk).toHaveBeenCalledWith(e.id, true, "");
    expect(onNotice).toHaveBeenCalledWith("hello");
  });

  it("非法訊息不丟例外", () => {
    const client = new RelayClient({ send: () => {} });
    expect(() => client.receive("not json")).not.toThrow();
    expect(() => client.receive(JSON.stringify(["???"]))).not.toThrow();
  });
});

describe("RelayClient — NIP-42 AUTH（ADR-0057）", () => {
  it("收到 AUTH 挑戰 → 以 authSigner 簽章並回送 [\"AUTH\", event]", () => {
    const sent: string[] = [];
    const sk = generateSecretKey();
    const client = new RelayClient(
      { send: (d) => sent.push(d) },
      { authSigner: (c) => buildAuthEvent(c, "wss://r", sk) },
    );
    client.receive(JSON.stringify(["AUTH", "chal-1"]));
    const [type, ev] = JSON.parse(sent[0]!);
    expect(type).toBe("AUTH");
    expect(ev.kind).toBe(22242);
    expect(ev.pubkey).toBe(getPublicKey(sk));
  });

  it("AUTH 事件的 OK → onAuthenticated（帶 client），不當一般 onOk", () => {
    const sent: string[] = [];
    const onOk = vi.fn();
    const onAuthenticated = vi.fn();
    const sk = generateSecretKey();
    const client = new RelayClient(
      { send: (d) => sent.push(d) },
      { authSigner: (c) => buildAuthEvent(c, "wss://r", sk), onOk, onAuthenticated },
    );
    client.receive(JSON.stringify(["AUTH", "chal-1"]));
    const authEvent = JSON.parse(sent[0]!)[1];
    client.receive(JSON.stringify(["OK", authEvent.id, true, ""]));
    expect(onAuthenticated).toHaveBeenCalledWith(client);
    expect(onOk).not.toHaveBeenCalled();
  });

  it("一般發布的 OK 仍走 onOk（非 AUTH id）", () => {
    const onOk = vi.fn();
    const onAuthenticated = vi.fn();
    const client = new RelayClient({ send: () => {} }, { onOk, onAuthenticated });
    client.receive(JSON.stringify(["OK", "some-event-id", true, ""]));
    expect(onOk).toHaveBeenCalledWith("some-event-id", true, "");
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("無 authSigner 時 AUTH 挑戰被忽略（不送、不丟例外）", () => {
    const sent: string[] = [];
    const client = new RelayClient({ send: (d) => sent.push(d) });
    expect(() => client.receive(JSON.stringify(["AUTH", "chal"]))).not.toThrow();
    expect(sent).toEqual([]);
  });
});
