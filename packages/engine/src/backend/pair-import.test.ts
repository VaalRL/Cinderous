// 配對搬家的**套用側**：加密 store 灌入全量捆包、抹掉 nsec、全新 backend 回放（ADR-0125）。
//
// 這條路徑桌面瀏覽器（ADR-0118）與行動端（ADR-0125）共用。行動端過去只還原身分、把捆包丟了
// ——換手機後聯絡人與訊息全部不見。這裡驗那條資料流的實質：
// 源機建捆包 → 序列化過線 → 新機以**加密 store** 套用 → 抹 nsec → backend.start() 回放。

import { generateSecretKey, getPublicKey, nsecDecode, nsecEncode } from "@cinderous/core";
import { createInMemoryRelayNetwork } from "@cinderous/relay";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "../storage/local.js";
import { applyPairBundle, buildPairBundle, parsePairBundle } from "../storage/pair-bundle.js";
import { RelayChatBackend } from "./relay-backend.js";

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    get length() {
      return backing.size;
    },
    key: (i: number) => [...backing.keys()][i] ?? null,
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

const noop: Record<string, unknown> = {
  onMessage: () => {},
  onContacts: () => {},
  onTyping: () => {},
  onNudge: () => {},
  onStatus: () => {},
};

/** 舊機（資料持有方）：建一份有聯絡人/訊息/群組的儲存，打包成過線的 JSON 捆包。 */
function sourceBundle() {
  const sk = generateSecretKey();
  const nsec = nsecEncode(sk);
  const pubkey = getPublicKey(sk);
  // 真的 pubkey——開機會對每位聯絡人 NIP-44 加密廣播個人檔（ADR-0066），假 pubkey 不在曲線上會爆。
  const bob = getPublicKey(generateSecretKey());
  const carol = getPublicKey(generateSecretKey());
  const src = new LocalStorage(`src-${pubkey}`, 0, sk);
  src.saveIdentity({ nsec, name: "小明" });
  src.addContact({ pubkey: bob, name: "Bob" });
  src.addContact({ pubkey: carol, name: "Carol" });
  src.appendMessage({ id: "m1", contact: bob, outgoing: false, text: "嗨 from Bob", at: 1 });
  src.appendMessage({ id: "m2", contact: bob, outgoing: true, text: "回 Bob", at: 2 });
  src.saveGroup({ id: "aa".repeat(16), name: "專案群", admin: pubkey, members: [pubkey, bob] });
  // ADR-0118：nsec 不在 AppStorage，須顯式傳入。
  const json = buildPairBundle(src, { relayUrl: "wss://home", cloudSync: "basic" }, { nsec, name: "小明" });
  return { json, nsec, pubkey, bob };
}

/** 新機匯入（＝ MobileApp.signInWith 的加密 store 那段，ADR-0125）。 */
function importOnNewDevice(json: string) {
  const bundle = parsePairBundle(json);
  if (!bundle) throw new Error("bundle 解析失敗");
  const nsec = bundle.snapshot.identity!.nsec;
  const store = new LocalStorage(getPublicKey(nsecDecode(nsec)), 0, nsecDecode(nsec)); // 加密：DEK 由 nsec 導出
  applyPairBundle(store, bundle);
  store.saveIdentity({ nsec: "", name: bundle.snapshot.identity!.name }); // 抹掉 nsec（ADR-0112/0125）
  return { pubkey: getPublicKey(nsecDecode(nsec)), nsec };
}

/** 開機（＝ signInWith 建後端那段）：全新 backend 以 nsecOverride ＋ expectPubkey 起。 */
function boot(pubkey: string, nsec: string, handlers: Record<string, unknown>) {
  const net = createInMemoryRelayNetwork();
  const backend = new RelayChatBackend(new LocalStorage(pubkey, 0, nsecDecode(nsec)), (h) => net.connect("me", h), "小明", {
    relayUrl: "wss://home",
    nsecOverride: nsec,
    expectPubkey: pubkey, // ADR-0122 守衛（行動端於 ADR-0125 補上）
  });
  backend.start({ ...noop, ...handlers } as never);
  return backend;
}

describe("配對搬家的套用側（ADR-0125：行動端換手機）", () => {
  it("🔴 **換手機後聯絡人與訊息都在**——不再只搬一個空身分", () => {
    const { json, bob } = sourceBundle();
    const { pubkey, nsec } = importOnNewDevice(json);

    const contacts: string[] = [];
    const history: Record<string, string[]> = {};
    const backend = boot(pubkey, nsec, {
      onContacts: (cs: { name: string }[]) => contacts.push(...cs.map((c) => c.name)),
      onHistory: (convo: string, msgs: { text: string }[]) => (history[convo] = msgs.map((m) => m.text)),
    });

    // 修正前：這些全是空的——捆包被丟掉了。
    expect(contacts).toEqual(expect.arrayContaining(["Bob", "Carol"]));
    expect(history[bob]).toEqual(["嗨 from Bob", "回 Bob"]);
    expect(backend.self.pubkey).toBe(pubkey); // 同一個帳號
    backend.stop();
  });

  it("群組也搬過去了", () => {
    const { json } = sourceBundle();
    const { pubkey, nsec } = importOnNewDevice(json);
    const groups: string[] = [];
    const backend = boot(pubkey, nsec, { onGroups: (gs: { name: string }[]) => groups.push(...gs.map((g) => g.name)) });
    expect(groups).toContain("專案群");
    backend.stop();
  });

  it("🔴 **nsec 絕不明文落盤**——即使捆包裡帶著真實 nsec（ADR-0112 紅線）", () => {
    const { json, nsec } = sourceBundle();
    importOnNewDevice(json);
    // 只看新機的鍵（`src-*` 是源機用的，同一個 backing map）。
    const onDisk = [...backing.entries()].filter(([k]) => !k.includes("src-")).map(([, v]) => v).join("\n");
    expect(onDisk).not.toContain(nsec);
    expect(onDisk).not.toContain(nsec.slice(0, 24));
  });
});
