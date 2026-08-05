// 群組 FS 覆蓋率（ADR-0326）——這支測試就是那份「一直缺的實測數據」。
//
// ADR-0320 把「群組覆蓋率會偏低」列為已知殘餘，並說「**若**長期偏低，該解的是發現機制
// （seal 層 hint）」。那個「若」從來沒有被量過。這裡把三種成員各量一次，把結論釘住。
import { describe, expect, it } from "vitest";
import { createInMemoryRelayNetwork } from "@cinderous/relay";
import {
  buildEkAnnounce, generateEncryptionKey, generateSecretKey, getPublicKey, npubEncode, nsecEncode,
  openWrap, wrapGroupControl, wrapGroupMessage, type NostrEvent,
} from "@cinderous/core";
import { MemoryStorage } from "../storage/memory.js";
import { RelayChatBackend } from "./relay-backend.js";

const noop = new Proxy({}, { get: () => () => {} }) as never;
const member = () => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk), ek: generateEncryptionKey() };
};

/**
 * 開好 FS 的我 ＋ 一個群。
 *
 * 🔴 `mode: "invited"` 是**關鍵情境**：我是被邀請的那一方。
 * `createGroup()` 會把成員全部 `ensureContact()`（建群者的覆蓋率因此天然是滿的），
 * 但 `applyControl()` 明講「**不自動把其他成員塞進個人聯絡人**」——所以被邀請者
 * 對其他成員一律不是聯絡人，而那正是覆蓋率破洞的所在。
 */
function boot(members: string[], mode: "creator" | "invited" = "creator", inviterSk?: Uint8Array) {
  const net = createInMemoryRelayNetwork();
  const sk = generateSecretKey();
  const store = new MemoryStorage();
  store.saveIdentity({ nsec: nsecEncode(sk), name: "我" });
  const a = new RelayChatBackend(store, (h) => net.connect("a", h), "我");
  a.start(noop);
  a.enableFs();
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
  if (mode === "creator") a.createGroup("群", members);
  else {
    const isk = inviterSk!;
    const control = {
      type: "group-create" as const,
      id: "gg" + "0".repeat(30),
      name: "群",
      admin: getPublicKey(isk),
      members: [getPublicKey(isk), getPublicKey(sk), ...members],
    };
    for (const e of wrapGroupControl(control, isk, [getPublicKey(sk)])) net.connect("i", {}).publish(e);
  }
  return { net, store, a, sent, group: () => store.loadGroups()[0]! };
}

/** 送一則群訊，回報給某成員的那份是加密到 EK 還是身分金鑰。 */
function targetFor(
  a: RelayChatBackend,
  sent: NostrEvent[],
  gid: string,
  m: { pk: string; sk: Uint8Array; ek: { sk: Uint8Array } },
): "ek" | "identity" | "none" {
  sent.length = 0;
  a.sendGroupMessage(gid, "群訊");
  for (const e of sent.filter((x) => x.tags.some((t) => t[0] === "p" && t[1] === m.pk))) {
    try {
      openWrap(e, m.ek.sk);
      return "ek";
    } catch {
      /* 不是 EK */
    }
    try {
      openWrap(e, m.sk);
      return "identity";
    } catch {
      /* 也不是身分金鑰 */
    }
  }
  return "none";
}

describe("群組 FS 覆蓋率實測（ADR-0326）", () => {
  it("聯絡人且開了 FS → 有 FS（正面案例本來就成立，先釘住）", () => {
    const m = member();
    const { net, a, sent, group } = boot([m.pk]);
    a.addContact(npubEncode(m.pk));
    net.connect("x", {}).publish(buildEkAnnounce(m.sk, m.ek.pk));
    expect(targetFor(a, sent, group().id, m)).toBe("ek");
    a.stop();
  });

  it("聯絡人但沒開 FS → 退回身分金鑰（正確：對方根本沒有 EK）", () => {
    const m = member();
    const { a, sent, group } = boot([m.pk]);
    a.addContact(npubEncode(m.pk));
    expect(targetFor(a, sent, group().id, m)).toBe("identity");
    a.stop();
  });

  it("🔴 我是被邀請的：同群但非聯絡人的成員**即使開了 FS** 也拿不到——他的 10040 我根本沒訂", () => {
    const m = member();
    const inviter = member();
    const { net, a, sent, group } = boot([m.pk], "invited", inviter.sk);
    net.connect("x", {}).publish(buildEkAnnounce(m.sk, m.ek.pk)); // 他有發，我沒訂
    expect(targetFor(a, sent, group().id, m)).toBe("identity");
    a.stop();
  });

  it("🔴 但他只要在群裡**發過一次言**，我就學到了（ADR-0326 的 seal 層 hint）", () => {
    const m = member();
    const inviter = member();
    const { net, store, a, sent, group } = boot([m.pk], "invited", inviter.sk);
    expect(targetFor(a, sent, group().id, m)).toBe("identity"); // 發言前

    const w = wrapGroupMessage("我也在", m.sk, m.pk, group(), { myEk: m.ek.pk });
    for (const e of w.events) net.connect("m", {}).publish(e);
    expect(store.loadFsState().contactEks[m.pk]).toBe(m.ek.pk);

    expect(targetFor(a, sent, group().id, m)).toBe("ek"); // 發言後
    a.stop();
  });

  it("建群者的覆蓋率天然是滿的——`createGroup()` 會把成員全部加成聯絡人（先釘住這個不對稱）", () => {
    const m = member();
    const { store } = boot([m.pk]);
    expect(store.loadContacts().some((c) => c.pubkey === m.pk)).toBe(true);
  });

  it("🔴 我的群訊也帶著我的 EK——否則發現只有單向，對方永遠給不了我 FS", () => {
    const m = member();
    const { a, sent, group } = boot([m.pk]);
    sent.length = 0;
    a.sendGroupMessage(group().id, "群訊");
    const mine = sent.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === m.pk))!;
    expect(openWrap(mine, m.sk).sealTags.some((t) => t[0] === "ek")).toBe(true);
    a.stop();
  });

  it("未啟用 FS 時不帶 hint（沒開的人一個位元組都不多送）", () => {
    const m = member();
    const net = createInMemoryRelayNetwork();
    const sk = generateSecretKey();
    const store = new MemoryStorage();
    store.saveIdentity({ nsec: nsecEncode(sk), name: "我" });
    const a = new RelayChatBackend(store, (h) => net.connect("a", h), "我");
    a.start(noop);
    const sent: NostrEvent[] = [];
    net.core.handle = new Proxy(net.core.handle, {
      apply(t, self, args) {
        try {
          const msg = JSON.parse(args[1] as string) as unknown[];
          if (msg[0] === "EVENT" && msg[1]) sent.push(msg[1] as NostrEvent);
        } catch {
          /* 略 */
        }
        return Reflect.apply(t, self, args as never);
      },
    });
    a.createGroup("群", [m.pk]);
    sent.length = 0;
    a.sendGroupMessage(store.loadGroups()[0]!.id, "群訊");
    const mine = sent.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === m.pk))!;
    expect(openWrap(mine, m.sk).sealTags).toEqual([]);
    a.stop();
  });
});
