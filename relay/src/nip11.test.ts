import { MAX_FUTURE_SKEW_SEC, MAX_PAST_SKEW_SEC } from "./host-config.js";
import { TIMESTAMP_JITTER_SECONDS } from "@cinderous/core";
import { describe, expect, it } from "vitest";
import { MAX_QUERY_ROWS } from "./message-store.js";
import { buildRelayInfo, SUPPORTED_NIPS, wantsRelayInfo } from "./nip11.js";

describe("NIP-11 Relay Information Document（ADR-0260）", () => {
  describe("內容協商", () => {
    it("只有帶 application/nostr+json 的 Accept 才要文件", () => {
      expect(wantsRelayInfo("application/nostr+json")).toBe(true);
      expect(wantsRelayInfo("Application/Nostr+JSON")).toBe(true); // 大小寫不敏感
      expect(wantsRelayInfo("application/nostr+json, */*")).toBe(true);
      expect(wantsRelayInfo("text/html")).toBe(false);
      expect(wantsRelayInfo(undefined)).toBe(false);
      expect(wantsRelayInfo(null)).toBe(false);
    });
  });

  describe("文件內容", () => {
    it("未設定的欄位不出現（而非空字串佔位）", () => {
      const doc = buildRelayInfo();
      expect(doc.pubkey).toBeUndefined();
      expect(doc.contact).toBeUndefined();
      expect("cinder_donations" in doc).toBe(false); // 全空＝無贊助入口
      expect("cinder_node" in doc).toBe(false);
      expect(doc.name).toBe("Cinderous relay"); // 有預設值的才出現
    });

    it("supported_nips 只列 relay 這層真的強制的（不謊報客戶端語意）", () => {
      const doc = buildRelayInfo();
      expect(doc.supported_nips).toEqual([1, 11, 13, 40, 42, 62]);
      // NIP-17/25/09/59 是客戶端語意——中繼只看到密文外殼，列上去等於對外謊報能力。
      for (const clientSideNip of [17, 25, 9, 59]) {
        expect(SUPPORTED_NIPS).not.toContain(clientSideNip);
      }
    });

    it("limitation 取自實際生效的常數，不另抄一份", () => {
      const lim = buildRelayInfo({ authRequired: true }).limitation as Record<string, unknown>;
      expect(lim.max_limit).toBe(MAX_QUERY_ROWS);
      expect(lim.auth_required).toBe(true);
      expect(lim.restricted_writes).toBe(true);
      expect(lim.payment_required).toBe(false); // 本專案不做站內金流（PRD §12）
    });

    it("retention 反映站方 TTL 上限（MAX_TTL_DAYS）", () => {
      expect(buildRelayInfo().retention).toEqual([{ time: 7 * 86_400 }]); // 預設 7 天
      expect(buildRelayInfo({ maxTtlDays: "90" }).retention).toEqual([{ time: 90 * 86_400 }]);
    });

    it("贊助管道：只放有填的（ADR-0089）", () => {
      const doc = buildRelayInfo({
        donations: { github_sponsors: "https://github.com/sponsors/me", buy_me_a_coffee: "" },
      });
      expect(doc.cinder_donations).toEqual({ github_sponsors: "https://github.com/sponsors/me" });
    });

    it("節點自報：合法 JSON 解析進文件；壞 JSON 當沒設、不讓整份文件掛掉", () => {
      const attestation = JSON.stringify({ kind: 10039, content: "{}" });
      expect(buildRelayInfo({ nodeAttestation: attestation }).cinder_node).toEqual({ kind: 10039, content: "{}" });
      expect("cinder_node" in buildRelayInfo({ nodeAttestation: "{壞掉" })).toBe(false);
    });

    it("檔案塊開關誠實反映站方設定（客戶端不必試錯）", () => {
      expect(buildRelayInfo({ acceptsFiles: true }).cinder_accepts_files).toBe(true);
      expect(buildRelayInfo().cinder_accepts_files).toBe(false);
    });

    it("整份文件可序列化為 JSON（回應直接吐這個）", () => {
      const doc = buildRelayInfo({ name: "我的節點", contact: "op@example.com" });
      const round = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
      expect(round.name).toBe("我的節點");
      expect(round.contact).toBe("op@example.com");
    });
  });
});

describe("時鐘窗與車道政策（ADR-0366 P1 #6）", () => {
  it("🔴 揭露時鐘窗——第三方的 epoch 結算以它為下界，在此之前問不到", () => {
    const doc = buildRelayInfo();
    expect(doc.cinder_max_past_skew_sec).toBe(MAX_PAST_SKEW_SEC);
    expect(doc.cinder_max_future_skew_sec).toBe(MAX_FUTURE_SKEW_SEC);
  });

  it("值與實際生效的常數同源（抄一份就會漂移）", () => {
    const doc = buildRelayInfo();
    // 過去窗必須大於 NIP-59 的抖動窗——那條不變量由 host-config.test.ts 釘著，
    // 這裡確認對外報的就是同一個值，而不是另一個看起來差不多的數字。
    expect(doc.cinder_max_past_skew_sec).toBeGreaterThan(TIMESTAMP_JITTER_SECONDS);
  });

  it("訂閱政策隨車道不同：named（嚴格）vs tagged（車道）", () => {
    expect(buildRelayInfo().cinder_subscription_scope).toBe("named");
    expect(buildRelayInfo({ profile: "strict" }).cinder_subscription_scope).toBe("named");
    expect(buildRelayInfo({ profile: "app" }).cinder_subscription_scope).toBe("tagged");
  });
});
