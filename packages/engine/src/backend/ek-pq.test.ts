// 後量子 EK 的引擎接線（ADR-0365 Phase 4）。
//
// 密碼學本身在 `core/src/hybrid-kem.test.ts` 與 `nip59-pq.test.ts` 釘過了。
// 這一支釘的是**狀態機**——也就是接線最容易靜默壞掉的地方：
//
//   1. 🔴 公告開關關著時**真的沒有發 v2**（順序紅線；發早了會讓舊裝置永久丟訊）。
//   2. 🔴 `ek` 與 `pq` **成對更新**。拆開來各自更新會合出一個對方手上不存在的組合，
//      訊息送得出去、對方卻永遠解不開——而且**沒有任何既有測試會紅**。
//   3. 端到端：對方一旦公告了 pq，訊息就真的走混合式，而且真的解得開。

import { describe, expect, it } from "vitest";
import { createInMemoryRelayNetwork } from "@cinderous/relay";
import {
  buildEkAnnounce,
  EK_ANNOUNCE_KIND,
  EK_PQ_ANNOUNCE,
  encodePqPublicKey,
  encodePqSeed,
  generateSecretKey,
  getPublicKey,
  KIND,
  nsecEncode,
  PQ_CT_TAG,
  PQ_SEED_BYTES,
  pqKeyFromStored,
  type NostrEvent,
} from "@cinderous/core";
import { MemoryStorage } from "../storage/memory.js";
import type { ChatBackendEvents, ChatMessage } from "./types.js";
import { RelayChatBackend } from "./relay-backend.js";

const noop: ChatBackendEvents = { onContacts() {}, onMessage() {}, onTyping() {}, onNudge() {} };

/** 兩端 ＋ 攔下所有發出去的事件。 */
function boot() {
  const net = createInMemoryRelayNetwork();
  const storeA = new MemoryStorage();
  const storeB = new MemoryStorage();
  const bSk = generateSecretKey();
  storeB.saveIdentity({ nsec: nsecEncode(bSk), name: "Bob" });
  const a = new RelayChatBackend(storeA, (h) => net.connect("a", h), "Alice");
  const b = new RelayChatBackend(storeB, (h) => net.connect("b", h), "Bob");
  const bIncoming: ChatMessage[] = [];
  a.start(noop);
  b.start({ ...noop, onMessage: (_pk, m) => bIncoming.push(m) });
  a.addContact(b.selfNpub);
  b.addContact(a.selfNpub);

  const sent: NostrEvent[] = [];
  net.core.handle = new Proxy(net.core.handle, {
    apply(t, self, args) {
      try {
        const msg = JSON.parse(args[1] as string) as unknown[];
        if (msg[0] === "EVENT" && msg[1]) sent.push(msg[1] as NostrEvent);
      } catch {
        /* 非 EVENT，略 */
      }
      return Reflect.apply(t, self, args as never);
    },
  });

  /** B 的當前 EK（古典 pk ＋ 後量子種子）。 */
  const bEk = () => [...storeB.loadFsState().keys].sort((x, y) => x.at - y.at).at(-1)!;
  /**
   * 模擬「B 那一側把 `EK_PQ_ANNOUNCE` 翻開了」：用 B 的身分金鑰發一顆 v2 公告。
   *
   * 這正是開關翻開後線上會出現的東西，只是本版的開關是關著的，所以由測試手動造。
   */
  const announceFromB = (ekPk: string, pq?: string, plus = 60) =>
    net
      .connect("x", {})
      .publish(buildEkAnnounce(bSk, ekPk, { ...(pq ? { pq } : {}), now: Math.floor(Date.now() / 1000) + plus }));
  /**
   * A 最後送給**某人**的那顆 1059。
   *
   * ⚠ 一定要按 `#p` 分——每則訊息同時產生「給對方的」與「自我副本」兩顆，
   * 而自我副本永遠加密到我自己的 EK（我自己的 pq 一定在手上）⇒ 它永遠帶 pqct。
   * 不分的話，「對方沒升級就不該走混合式」這條測試會被自我副本騙過去。
   */
  const lastWrapTo = (pk: string) =>
    sent
      .filter((e) => e.kind === KIND.OFFLINE_DM_GIFT_WRAP && e.tags.some((t) => t[0] === "p" && t[1] === pk))
      .at(-1)!;
  /** 把 B 當前 EK 的後量子公鑰編成公告用的字串。 */
  const bPqPk = () => encodePqPublicKey(pqKeyFromStored(bEk().pq!)!.pk);

  return { net, a, b, storeA, storeB, bSk, sent, bIncoming, bEk, bPqPk, announceFromB, lastWrapTo };
}

describe("🚦 公告開關（順序紅線）", () => {
  it("🔴 本版的 EK_PQ_ANNOUNCE 必須是 false", () => {
    // 翻開它之前要先滿足的三個條件寫在該常數的註解。把它釘在測試裡，
    // 是因為「不小心翻開」的後果不是回報得出來的錯誤，是**別人裝置上訊息永久消失**。
    expect(EK_PQ_ANNOUNCE).toBe(false);
  });

  it("🔴 啟用 FS 發出的 kind 10040 仍是 v1，且**不帶** pq 欄位", () => {
    const { a, sent } = boot();
    a.enableFs();
    const announces = sent.filter((e) => e.kind === EK_ANNOUNCE_KIND);
    expect(announces.length).toBeGreaterThan(0);
    for (const e of announces) {
      const c = JSON.parse(e.content) as { v: number; pq?: string };
      expect(c.v).toBe(1);
      expect(c.pq).toBeUndefined();
    }
  });
});

describe("金鑰生成", () => {
  it("啟用 FS 時順帶生一顆 64-byte 的後量子種子（先分發、後啟用）", () => {
    const { a, storeA } = boot();
    a.enableFs();
    const key = storeA.loadFsState().keys.at(-1)!;
    expect(key.pq).toBeTypeOf("string");
    // `pqKeyFromStored` 只在長度剛好是 PQ_SEED_BYTES 時才回金鑰對，否則回 undefined
    // ⇒ 這一句同時驗了「有值」「是合法 base64」「長度正確」。
    expect(pqKeyFromStored(key.pq!)).toBeDefined();
  });

  it("種子展開得出金鑰對（存 64 bytes、用時才展開的前提）", () => {
    const { a, storeA } = boot();
    a.enableFs();
    const kp = pqKeyFromStored(storeA.loadFsState().keys.at(-1)!.pq!);
    expect(kp?.pk.length).toBe(1184);
  });
});

describe("端到端：對方公告了 pq 之後", () => {
  it("訊息走混合式（外層帶 pqct），而且對方解得開", () => {
    const { a, b, bEk, bPqPk, announceFromB, lastWrapTo, bIncoming } = boot();
    a.enableFs();
    b.enableFs();
    announceFromB(bEk().pk, bPqPk());

    a.sendMessage(b.self.pubkey, "後量子哈囉");
    expect(lastWrapTo(b.self.pubkey).tags.some((t) => t[0] === PQ_CT_TAG)).toBe(true);
    expect(bIncoming.map((m) => m.text)).toContain("後量子哈囉"); // 🔴 真的解得開
  });

  it("對方只公告 v1（沒有 pq）⇒ 維持純古典，訊息照樣通", () => {
    const { a, b, bEk, announceFromB, lastWrapTo, bIncoming } = boot();
    a.enableFs();
    b.enableFs();
    announceFromB(bEk().pk);
    a.sendMessage(b.self.pubkey, "古典哈囉");
    expect(lastWrapTo(b.self.pubkey).tags.some((t) => t[0] === PQ_CT_TAG)).toBe(false);
    expect(bIncoming.map((m) => m.text)).toContain("古典哈囉");
  });

  it("公告的 pq 是壞值 ⇒ 退回純古典而**不是送不出去**（今天的基準線不該被弄壞）", () => {
    const { a, b, bEk, announceFromB, lastWrapTo, bIncoming } = boot();
    a.enableFs();
    b.enableFs();
    announceFromB(bEk().pk, "這不是合法的 base64");
    a.sendMessage(b.self.pubkey, "壞公告");
    expect(lastWrapTo(b.self.pubkey).tags.some((t) => t[0] === PQ_CT_TAG)).toBe(false);
    expect(bIncoming.map((m) => m.text)).toContain("壞公告");
  });
});

describe("🔴 ek 與 pq 必須成對更新", () => {
  it("同一把 ek、後續只學到不帶 pq 的 hint ⇒ pq **不被洗掉**", () => {
    // 1:1 訊息內嵌的 `ek` hint 永遠不帶 pq。若它會覆蓋，那每收一則對方的訊息
    // 就會把公告學到的 pq 清掉 ⇒ 混合式**永遠開不起來**，而且完全無聲。
    const { a, b, storeA, bEk, bPqPk, announceFromB, lastWrapTo, bIncoming } = boot();
    a.enableFs();
    b.enableFs();
    announceFromB(bEk().pk, bPqPk());

    b.sendMessage(a.self.pubkey, "我回一則"); // A 由此學到 B 的 ek hint（不帶 pq）
    expect(storeA.loadFsState().contactPq?.[b.self.pubkey]).toBeTypeOf("string");

    a.sendMessage(b.self.pubkey, "還是混合式");
    expect(lastWrapTo(b.self.pubkey).tags.some((t) => t[0] === PQ_CT_TAG)).toBe(true);
    expect(bIncoming.map((m) => m.text)).toContain("還是混合式");
  });

  it("🔴 ek 換了而新公告不帶 pq ⇒ 舊 pq 被丟掉（絕不拿舊 pq 配新 ek）", () => {
    // 配錯的後果：訊息送得出去、對方手上卻沒有那個組合 ⇒ **永久解不開**。
    const { a, b, storeA, bEk, bPqPk, announceFromB } = boot();
    a.enableFs();
    b.enableFs();
    announceFromB(bEk().pk, bPqPk());
    expect(storeA.loadFsState().contactPq?.[b.self.pubkey]).toBeTypeOf("string");

    const newEk = getPublicKey(generateSecretKey()); // B 輪替了，且退回 v1 公告
    announceFromB(newEk, undefined, 120);
    expect(storeA.loadFsState().contactEks[b.self.pubkey]).toBe(newEk);
    expect(storeA.loadFsState().contactPq?.[b.self.pubkey]).toBeUndefined();
  });

  it("ek 換了且新公告帶新的 pq ⇒ 兩者一起換", () => {
    const { a, b, storeA, bEk, bPqPk, announceFromB } = boot();
    a.enableFs();
    b.enableFs();
    const first = bPqPk();
    announceFromB(bEk().pk, first);

    const newEk = getPublicKey(generateSecretKey());
    const newPq = encodePqPublicKey(pqKeyFromStored(encodePqSeed(new Uint8Array(PQ_SEED_BYTES).fill(9)))!.pk);
    announceFromB(newEk, newPq, 120);
    const fs = storeA.loadFsState();
    expect(fs.contactEks[b.self.pubkey]).toBe(newEk);
    expect(fs.contactPq?.[b.self.pubkey]).toBe(newPq);
    expect(fs.contactPq?.[b.self.pubkey]).not.toBe(first);
  });
});

describe("自我副本", () => {
  it("自己那一份也走混合式（自己的 EK 兩半都在手上）", () => {
    const { a, b, sent } = boot();
    a.enableFs();
    a.sendMessage(b.self.pubkey, "自我副本");
    const mine = sent.filter(
      (e) => e.kind === KIND.OFFLINE_DM_GIFT_WRAP && e.tags.some((t) => t[0] === "p" && t[1] === a.self.pubkey),
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.at(-1)!.tags.some((t) => t[0] === PQ_CT_TAG)).toBe(true);
  });
});
