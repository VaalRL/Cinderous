// 🔴 已上線 App（v0.0.18）的 engine 對中繼容量訊號的相容性（ADR-0379；SDK ADR 0042 的錨點移植）。
//
// 錨點要開兩個新行為，兩個都是 App 沒見過的訊息：
//   1. 粗分級預警：`["OK", id, true, "warning: near-full: 80: …"]`——收下了，但 OK 帶了說明文字；
//   2. 丟棄計數：讀自己的收件匣時，在 EOSE 之前多一則 `["NOTICE", "warning: dropped: N: since: until: …"]`。
// 另外 NIP-11 文件多了 `cinder_ceiling_*` 等欄位。
//
// 這裡用**真的** engine（`RelayChatBackend`，v0.0.18 的程式碼）接**真的**中繼核心（`RelayCore`＋開了容量選項的
// `MessageStore`），證明：預警不會把訊息判成失敗、NOTICE 不會打斷訂閱或收信、NIP-11 多出的欄位不影響解析。
// 最後一段是「為什麼溢位帶先不開」的證據：`OK true "warning: borrowed: …"` 會被 App 當成送達，但它只存 2 小時。
import { generateSecretKey, getPublicKey, nsecEncode, npubEncode, type RelayClientHandlers } from "@cinderous/core";
import { createInMemoryRelayNetwork, MessageStore, type MessageStoreOptions } from "@cinderous/relay";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../storage/memory.js";
import { RelayChatBackend } from "./relay-backend.js";
import { parseRelayInfo } from "./relay-info.js";
import type { ChatBackendEvents, ChatMessage } from "./types.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };

/** 中繼送給某條連線的每一則原始訊息（照順序），用來看 OK 的說明文字與 NOTICE／EOSE 的先後。 */
type Wire = { kind: "OK"; id: string; accepted: boolean; message: string } | { kind: "NOTICE"; message: string } | { kind: "EOSE"; subId: string };

/**
 * 在 engine 給的 handlers 外面包一層記錄（不改變 engine 收到的任何東西）。
 *
 * `gate` 給了就先把 relay 送來的東西排隊、`open()` 之後才交給 engine：記憶體網路是**同步**的，
 * 認證與收件匣回放會在 engine 的建構子裡（`this.client` 指派之前）就跑完，真的 WebSocket 不會。
 * `authSigner` 不排隊（它要同步回傳簽好的事件，而且只用到建構子早就備好的金鑰）。
 */
function tap(h: RelayClientHandlers, log: Wire[], gate?: { queue: (() => void)[] | undefined }): RelayClientHandlers {
  const later = (fn: () => void): void => {
    if (gate?.queue) gate.queue.push(fn);
    else fn();
  };
  return {
    ...h,
    onEvent: (subId, event) => later(() => h.onEvent?.(subId, event)),
    onAuthenticated: (client) => later(() => h.onAuthenticated?.(client)),
    onOk: (id, accepted, message) =>
      later(() => {
        log.push({ kind: "OK", id, accepted, message });
        h.onOk?.(id, accepted, message);
      }),
    onNotice: (message) =>
      later(() => {
        log.push({ kind: "NOTICE", message });
        h.onNotice?.(message);
      }),
    onEose: (subId) =>
      later(() => {
        log.push({ kind: "EOSE", subId });
        h.onEose?.(subId);
      }),
  };
}

function setup(storeOpts: MessageStoreOptions) {
  const net = createInMemoryRelayNetwork({ requireAuth: true, store: new MessageStore(storeOpts) });
  const aliceWire: Wire[] = [];
  const bobWire: Wire[] = [];
  const storeA = new MemoryStorage();
  const alice = new RelayChatBackend(storeA, (h) => net.connect("alice", tap(h, aliceWire)), "Alice", {
    nsecOverride: nsecEncode(generateSecretKey()),
  });
  const bobSk = generateSecretKey();
  const bobPk = getPublicKey(bobSk);
  // Bob 的 engine 一建構就會連線訂閱（＝在線）；要模擬「Bob 不在線」就晚一點才建。
  // 順序同 App：建構（連線）→ start → 之後才收到 relay 的訊息。
  const bobOnline = (events: ChatBackendEvents): RelayChatBackend => {
    const gate: { queue: (() => void)[] | undefined } = { queue: [] };
    const bob = new RelayChatBackend(new MemoryStorage(), (h) => net.connect("bob", tap(h, bobWire, gate)), "Bob", {
      nsecOverride: nsecEncode(bobSk),
    });
    bob.start(events);
    while (gate.queue && gate.queue.length > 0) gate.queue.shift()!();
    gate.queue = undefined;
    return bob;
  };
  return { net, alice, bobOnline, bobPk, storeA, aliceWire, bobWire };
}

let warn: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => warn?.mockRestore());

describe("🔴 v0.0.18 相容：OK true 附 warning: near-full:（ADR-0379）", () => {
  it("收下了就是收下了：訊息狀態是 sent、沒有任何一則被標成失敗、外送匣不報錯", () => {
    warn = vi.spyOn(console, "warn");
    // 拒收制（嚴格平面）＋預警門檻 50%：一直寫到第一次出現預警，再多寫兩則（仍遠低於天花板）
    const { alice, bobOnline, bobPk, storeA, aliceWire } = setup({ offlineMaxTotalBytes: 2_000_000, nearFullPercent: 50 });
    const statuses: string[] = [];
    alice.start({ ...noop, onMessageStatus: (_c, _id, s) => statuses.push(s) });
    alice.addContact(npubEncode(bobPk));
    const text = "內容".repeat(2000);
    const nearFull = (): boolean => aliceWire.some((w) => w.kind === "OK" && w.accepted && w.message.startsWith("warning: near-full: "));
    let sent = 0;
    while (!nearFull() && sent < 200) alice.sendMessage(bobPk, `${sent++}:${text}`);
    for (let i = 0; i < 2; i += 1) alice.sendMessage(bobPk, `${sent++}:${text}`);

    const oks = aliceWire.filter((w): w is Extract<Wire, { kind: "OK" }> => w.kind === "OK");
    // 前提：真的有預警（不是一串永遠不會觸發的寫入），而且沒有任何拒收
    expect(nearFull()).toBe(true);
    expect(oks.filter((o) => o.accepted && o.message.startsWith("warning: near-full: ")).length).toBeGreaterThanOrEqual(3);
    expect(oks.filter((o) => !o.accepted).map((o) => o.message)).toEqual([]);

    const msgs = storeA.loadMessages(bobPk);
    expect(msgs).toHaveLength(sent);
    expect(msgs.map((m) => m.status)).toEqual(Array(sent).fill("sent")); // Bob 不在線：sent，不是 failed
    expect(statuses).not.toContain("failed");
    expect(warn.mock.calls.flat().join("\n")).not.toContain("未送達");

    // Bob 上線照樣收到全部
    const got: ChatMessage[] = [];
    const bob = bobOnline({ ...noop, onMessage: (_pk, m) => got.push(m) });
    expect(got.filter((m) => m.text.endsWith(text))).toHaveLength(sent);
    alice.stop();
    bob.stop();
  });
});

describe("🔴 v0.0.18 相容：EOSE 之前多一則 NOTICE「warning: dropped: …」（ADR-0379）", () => {
  it("engine 忽略它：收件匣照常回放、EOSE 照常、之後的即時訊息照常收到", () => {
    // 每位收件人只留 3 則（FIFO）＋丟棄計數：Bob 不在線時 Alice 寄 6 則 ⇒ 至少 3 則還沒送到就被擠掉
    const { alice, bobOnline, bobPk, bobWire } = setup({ maxPerRecipient: 3, countDrops: true });
    alice.start(noop);
    alice.addContact(npubEncode(bobPk));
    for (let i = 1; i <= 6; i += 1) alice.sendMessage(bobPk, `離線 ${i}`);

    const live: string[] = [];
    const bob = bobOnline({ ...noop, onMessage: (_pk, m) => live.push(m.text) });

    // 中繼真的送了 NOTICE，而且在那條收件匣訂閱的 EOSE 之前
    const noticeAt = bobWire.findIndex((w) => w.kind === "NOTICE" && w.message.startsWith("warning: dropped: "));
    expect(noticeAt).toBeGreaterThanOrEqual(0);
    expect(bobWire.slice(noticeAt + 1).some((w) => w.kind === "EOSE")).toBe(true);
    const dropped = Number(/^warning: dropped: (\d+): /.exec((bobWire[noticeAt] as { message: string }).message)![1]);
    expect(dropped).toBeGreaterThanOrEqual(3);

    // 回放沒有被打斷：留下來的那幾則照樣進來（陌生人訊息照收，進請求區）
    const replayed = live.filter((t) => t.startsWith("離線 "));
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.length).toBeLessThanOrEqual(3);

    // 訂閱還活著：之後的即時訊息照收
    alice.sendMessage(bobPk, "上線之後");
    expect(live).toContain("上線之後");
    alice.stop();
    bob.stop();
  });
});

describe("v0.0.18 相容：NIP-11 多出的容量欄位無害（ADR-0379）", () => {
  it("parseRelayInfo 只取贊助與站名，多出的 cinder_ceiling_* 等欄位不影響結果", () => {
    const base = {
      name: "Cinderous relay",
      cinder_donations: { buy_me_a_coffee: "https://buymeacoffee.com/someone" },
    };
    const withCapacity = {
      ...base,
      cinder_ceiling_policy: "reject",
      cinder_ceiling_bytes: { offline: 25_165_824, addressable: 25_165_824 },
      cinder_near_full_percent: [80, 95],
      cinder_drop_notices: true,
      cinder_borrow_ttl_sec: 7200,
      cinder_borrow_percent: 25,
      cinder_borrow_planes: ["offline"],
      cinder_guarantee_bytes: 2_097_152,
    };
    expect(parseRelayInfo(withCapacity)).toEqual(parseRelayInfo(base));
    expect(parseRelayInfo(withCapacity)?.donations).toHaveLength(1);
  });
});

describe("為什麼錨點先不開溢位帶（ADR-0379 的證據，不是規格）", () => {
  it("OK true「warning: borrowed: 7200: …」被 v0.0.18 當成送達（sent），但中繼只存 2 小時", () => {
    // 拒收制、溢位帶 100%：一直寫到第一次被收進溢位帶
    const { alice, bobPk, storeA, aliceWire } = setup({ offlineMaxTotalBytes: 200_000, overflowRatio: 1, borrowPerKeyBytes: 1_000_000 });
    alice.start(noop);
    alice.addContact(npubEncode(bobPk));
    const text = "內容".repeat(1000);
    const borrowed = (): number =>
      aliceWire.filter((w) => w.kind === "OK" && w.accepted && w.message.startsWith("warning: borrowed: 7200: ")).length;
    let sent = 0;
    while (borrowed() === 0 && sent < 200) alice.sendMessage(bobPk, `${sent++}:${text}`);
    expect(borrowed()).toBe(1);
    // App 分不出來：借用的那則也是 sent。收件人 2 小時內沒上線，它就無聲消失——比看得到的 blocked: ceiling: 更糟
    const msgs = storeA.loadMessages(bobPk);
    expect(msgs).toHaveLength(sent);
    expect(msgs.map((m) => m.status)).toEqual(Array(sent).fill("sent"));
    alice.stop();
  });
});
