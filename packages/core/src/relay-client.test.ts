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

describe("RelayClient — 認證前送出的事件（ADR-0385）", () => {
  // 錨點一連上就發 AUTH 挑戰，認證完成前收到的 EVENT 一律回 `OK false "auth-required: …"`（2026-10-14 實測）。
  // 連線一開就把排隊的事件送出去，所以剛連上時送的心跳、直連信令會被拒，而它們沒有外送匣可以重試。
  function authed() {
    const sent: unknown[][] = [];
    const onOk = vi.fn();
    const sk = generateSecretKey();
    const client = new RelayClient(
      { send: (d) => sent.push(JSON.parse(d) as unknown[]) },
      { authSigner: (c) => buildAuthEvent(c, "wss://r", sk), onOk },
    );
    const challengeAndAccept = () => {
      client.receive(JSON.stringify(["AUTH", "chal-1"]));
      const auth = sent.filter((m) => m[0] === "AUTH").at(-1)![1] as { id: string };
      client.receive(JSON.stringify(["OK", auth.id, true, ""]));
    };
    const events = () => sent.filter((m) => m[0] === "EVENT").map((m) => (m[1] as { id: string }).id);
    return { client, onOk, events, challengeAndAccept, sk };
  }

  it("認證前送出、被回 auth-required → 認證成功後自動重送同一顆；那個拒收不轉給 onOk（不算失敗）", () => {
    const { client, onOk, events, challengeAndAccept, sk } = authed();
    const beat = createHeartbeat(sk);
    client.publish(beat);
    client.receive(JSON.stringify(["OK", beat.id, false, "auth-required: nip42: 請先認證（NIP-42）"]));
    expect(onOk).not.toHaveBeenCalled();
    expect(events()).toEqual([beat.id]);
    challengeAndAccept();
    expect(events()).toEqual([beat.id, beat.id]);
    client.receive(JSON.stringify(["OK", beat.id, true, ""]));
    expect(onOk).toHaveBeenCalledWith(beat.id, true, "");
  });

  it("認證後才送的事件被回 auth-required（例如中繼要求重新認證）→ 照常轉給 onOk，不自己重送", () => {
    const { client, onOk, events, challengeAndAccept, sk } = authed();
    challengeAndAccept();
    const beat = createHeartbeat(sk);
    client.publish(beat);
    client.receive(JSON.stringify(["OK", beat.id, false, "auth-required: again"]));
    expect(onOk).toHaveBeenCalledWith(beat.id, false, "auth-required: again");
    expect(events()).toEqual([beat.id]);
  });

  it("其他拒收理由照常轉給 onOk；沒有 authSigner 的連線（開放中繼）不攔 auth-required", () => {
    const { client, onOk, sk } = authed();
    const beat = createHeartbeat(sk);
    client.publish(beat);
    client.receive(JSON.stringify(["OK", beat.id, false, "blocked: nope"]));
    expect(onOk).toHaveBeenCalledWith(beat.id, false, "blocked: nope");

    const open = vi.fn();
    const plain = new RelayClient({ send: () => {} }, { onOk: open });
    const other = createHeartbeat(generateSecretKey());
    plain.publish(other);
    plain.receive(JSON.stringify(["OK", other.id, false, "auth-required: x"]));
    expect(open).toHaveBeenCalledWith(other.id, false, "auth-required: x");
  });

  it("斷線重連（同一個 client）：認證狀態重來，重連後早於認證送出的事件同樣會在認證後重送", () => {
    const { client, onOk, events, challengeAndAccept, sk } = authed();
    challengeAndAccept();
    client.connectionLost();
    const beat = createHeartbeat(sk);
    client.publish(beat);
    client.receive(JSON.stringify(["OK", beat.id, false, "auth-required: x"]));
    expect(onOk).not.toHaveBeenCalled();
    challengeAndAccept();
    expect(events()).toEqual([beat.id, beat.id]);
  });

  it("重送在 onAuthenticated 之後（先重掛訂閱，再補送）", () => {
    const order: string[] = [];
    const sk = generateSecretKey();
    const sent: unknown[][] = [];
    const client = new RelayClient(
      {
        send: (d) => {
          const m = JSON.parse(d) as unknown[];
          sent.push(m);
          if (m[0] === "EVENT") order.push("resend");
        },
      },
      { authSigner: (c) => buildAuthEvent(c, "wss://r", sk), onAuthenticated: () => order.push("authenticated") },
    );
    const beat = createHeartbeat(sk);
    client.publish(beat);
    order.length = 0;
    client.receive(JSON.stringify(["OK", beat.id, false, "auth-required: x"]));
    client.receive(JSON.stringify(["AUTH", "c"]));
    const auth = sent.filter((m) => m[0] === "AUTH").at(-1)![1] as { id: string };
    client.receive(JSON.stringify(["OK", auth.id, true, ""]));
    expect(order).toEqual(["authenticated", "resend"]);
  });
});
