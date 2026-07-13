import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "./keys.js";
import {
  type CinderNodeDeclaration,
  evaluateAdmission,
  type NodeConformance,
  signNodeAttestation,
  verifyNodeAttestation,
} from "./node-attestation.js";

const decl: CinderNodeDeclaration = {
  url: "wss://node.example",
  contact: "op@example.com",
  region: "EU",
  attests: ["ephemeral", "nip40-ttl", "no-censor"],
  updatedAt: 1_700_000_000,
};

describe("節點自報簽章（ADR-0092）", () => {
  it("sign→verify 往返一致（對營運者公鑰）", () => {
    const sk = generateSecretKey();
    expect(verifyNodeAttestation(signNodeAttestation(decl, sk), getPublicKey(sk))).toEqual(decl);
  });

  it("非該營運者公鑰、竄改內容 → null", () => {
    const sk = generateSecretKey();
    const event = signNodeAttestation(decl, sk);
    expect(verifyNodeAttestation(event, getPublicKey(generateSecretKey()))).toBeNull(); // 作者不符
    const tampered = { ...event, content: event.content.replace("node.example", "evil.example") };
    expect(verifyNodeAttestation(tampered, getPublicKey(sk))).toBeNull(); // 簽章失效
  });

  it("內容形狀非法（缺 attests）→ null", () => {
    const sk = generateSecretKey();
    const bad = signNodeAttestation({ ...decl, attests: undefined as never }, sk);
    expect(verifyNodeAttestation(bad, getPublicKey(sk))).toBeNull();
  });
});

describe("分級收錄決策 evaluateAdmission（ADR-0092/0069）", () => {
  const base: NodeConformance = { live: true, ephemeral: true, rejectsExpired: true, uptimePct: 99.9 };

  it("liveness 失敗 → 不列入（weight 0）", () => {
    expect(evaluateAdmission({ ...base, live: false })).toMatchObject({ accepting: false, weight: 0 });
  });
  it("一致性未過（Ephemeral 錯）→ 試用（accepting false, weight 1）", () => {
    const d = evaluateAdmission({ ...base, ephemeral: false });
    expect(d).toMatchObject({ accepting: false, weight: 1 });
    expect(d.reasons.join()).toContain("Ephemeral");
  });
  it("一致性過但 uptime 未知/不足 → 試用", () => {
    expect(evaluateAdmission({ live: true, ephemeral: true, rejectsExpired: true })).toMatchObject({ accepting: false, weight: 1 });
    expect(evaluateAdmission({ ...base, uptimePct: 80 })).toMatchObject({ accepting: false, weight: 1 });
  });
  it("一致性過＋uptime≥99% → 正式收錄 weight 2；≥95% → weight 1", () => {
    expect(evaluateAdmission({ ...base, uptimePct: 99.5 })).toMatchObject({ accepting: true, weight: 2 });
    expect(evaluateAdmission({ ...base, uptimePct: 96 })).toMatchObject({ accepting: true, weight: 1 });
  });
});
