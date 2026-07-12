import {
  createPairing,
  encodePairing,
  generateSecretKey,
  getPublicKey,
  npubEncode,
  nsecEncode,
  type PairTransport,
} from "@cinder/core";
import {
  createPairingOffer,
  MemoryStorage,
  type PairBundle,
  type PairTransportFactory,
  runPairSource,
  runPairTarget,
} from "@cinder/engine";
import { describe, expect, it } from "vitest";
import { identityFromNsec, identityFromPairBundle, npubFromNsec, previewPairing } from "./auth.js";

describe("行動端登入 A：nsec 匯入（ADR-0081）", () => {
  const sk = generateSecretKey();
  const nsec = nsecEncode(sk);
  const pubkey = getPublicKey(sk);

  it("有效 nsec：導出與桌面同一 pubkey/npub、名稱去空白、nsec 正規化", () => {
    const r = identityFromNsec(`  ${nsec}  `, "  夜  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity.pubkey).toBe(pubkey); // 同帳號
    expect(r.identity.npub).toBe(npubEncode(pubkey));
    expect(r.identity.nsec).toBe(nsec);
    expect(r.identity.name).toBe("夜");
  });

  it("名稱空白 → mobileSignIn_errName；nsec 非法/前綴錯 → mobileSignIn_errNsec", () => {
    expect(identityFromNsec(nsec, "   ")).toEqual({ ok: false, error: "mobileSignIn_errName" });
    expect(identityFromNsec("nsec1garbage", "夜")).toEqual({ ok: false, error: "mobileSignIn_errNsec" });
    expect(identityFromNsec(npubEncode(pubkey), "夜")).toEqual({ ok: false, error: "mobileSignIn_errNsec" }); // npub 前綴
  });

  it("npubFromNsec（預覽用）：有效回 npub、非法回 null", () => {
    expect(npubFromNsec(nsec)).toBe(npubEncode(pubkey));
    expect(npubFromNsec("nope")).toBeNull();
  });
});

describe("行動端登入 B：配對匯入（ADR-0081）", () => {
  it("捆包帶身分：萃取同帳號、名稱可覆寫", () => {
    const sk = generateSecretKey();
    const nsec = nsecEncode(sk);
    const bundle = { snapshot: { identity: { nsec, name: "舊機我" } } } as unknown as PairBundle;
    const r = identityFromPairBundle(bundle);
    expect(r.ok && r.identity.pubkey).toBe(getPublicKey(sk));
    expect(r.ok && r.identity.name).toBe("舊機我");
    const r2 = identityFromPairBundle(bundle, "新名");
    expect(r2.ok && r2.identity.name).toBe("新名");
  });

  it("捆包無身分 → mobilePair_errNoIdentity", () => {
    const empty = { snapshot: { identity: null } } as unknown as PairBundle;
    expect(identityFromPairBundle(empty)).toEqual({ ok: false, error: "mobilePair_errNoIdentity" });
  });

  it("捆包身分名稱為空：給預設名而非卡在 errName 死路（審查修 7）", () => {
    const sk = generateSecretKey();
    const bundle = { snapshot: { identity: { nsec: nsecEncode(sk), name: "  " } } } as unknown as PairBundle;
    const r = identityFromPairBundle(bundle);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.pubkey).toBe(getPublicKey(sk));
      expect(r.identity.name).toBe("我"); // 預設名，非 mobileSignIn_errName
    }
  });

  it("捆包形狀異常（缺 snapshot）：遵守回傳型別、不丟 TypeError（審查修 8）", () => {
    expect(identityFromPairBundle({} as unknown as PairBundle)).toEqual({
      ok: false,
      error: "mobilePair_errNoIdentity",
    });
  });

  it("previewPairing：有效碼取會合中繼站主機名、非法碼 → mobilePair_errCode", () => {
    const code = encodePairing(createPairing("", "webrtc", "wss://meet.example").payload);
    expect(previewPairing(code)).toEqual({ ok: true, relayHost: "meet.example" });
    expect(previewPairing("not-json")).toEqual({ ok: false, error: "mobilePair_errCode" });
  });

  it("整合：真實配對協定產出的捆包 → identityFromPairBundle 得同帳號", async () => {
    // 用真實配對協定（core runPairing*）跑一趟，證明 auth 萃取吃得下引擎實際輸出（抓形狀漂移）。
    const sk = generateSecretKey();
    const s = new MemoryStorage();
    s.saveIdentity({ nsec: nsecEncode(sk), name: "舊機我" });

    const inbox: Record<string, Uint8Array[]> = { source: [], target: [] };
    const handlers: Record<string, ((d: Uint8Array) => void) | undefined> = {};
    const deliver = (to: string, d: Uint8Array): void => {
      const h = handlers[to];
      if (h) h(d);
      else inbox[to]!.push(d);
    };
    const transport: PairTransportFactory = async (role) => {
      const peer = role === "source" ? "target" : "source";
      const t: PairTransport = {
        send: (d) => deliver(peer, d),
        onMessage(h) {
          handlers[role] = h;
          for (const d of inbox[role]!.splice(0)) h(d);
        },
        close() {},
      };
      return t;
    };

    const { offer, key } = createPairingOffer("wss://home", 1000);
    const [sent, bundle] = await Promise.all([
      runPairSource({ key, storage: s, profile: { relayUrl: "wss://home" }, transport, confirmSas: async () => true }),
      runPairTarget({ code: offer.code, transport }),
    ]);
    expect(sent).toBe(true);

    const r = identityFromPairBundle(bundle);
    expect(r.ok && r.identity.pubkey).toBe(getPublicKey(sk)); // 同帳號
  });
});
