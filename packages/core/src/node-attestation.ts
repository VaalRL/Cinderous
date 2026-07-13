// 節點成員自報 ＋ 分級收錄決策（ADR-0092）：把「申請/審查」做成可驗證的資料介面（非有狀態審查後台）。
//
// - 自報（申請）：營運者以自己的金鑰簽一份 CinderNodeDeclaration（亦可承載於 relay 的 NIP-11 `cinder_node`）。
//   驗簽通過＝可信「此節點自報為此、可問責」——**不等於保證誠實**，誠信由結構性隱私（E2E/TTL）不依賴之。
// - 收錄決策：evaluateAdmission 把黑箱一致性探測（NodeConformance）轉成 accepting/weight（ADR-0069 分級），
//   純函式、可測。信任根＝維護者簽章清單（ADR-0039），本模組只提供可驗證的自報與決策原語。
import type { NostrEvent } from "./event.js";
import type { PubkeyHex, SecretKey } from "./keys.js";
import { finalizeEvent, verifyEvent } from "./sign.js";

/**
 * 節點自報事件 kind（營運者自簽；NIP-01 可取代區間 10000–19999）。
 *
 * ⚠ 原為 10038——**與 `ORG_ROSTER_KIND` 撞號**。在可取代語意下（ADR-0035），同一把金鑰的
 * 節點自報會**直接覆蓋掉組織名冊**（每 (kind, pubkey) 只留一顆）。故改為 10039。
 * 此時尚無第三方節點（生產 relays.json 為空），無資料遷移問題。
 */
export const NODE_ATTEST_KIND = 10039;

/** 營運者對節點的自我宣告（＝申請書）。 */
export interface CinderNodeDeclaration {
  /** 節點 wss:// URL。 */
  url: string;
  /** 聯絡方式（問責用）。 */
  contact: string;
  /** 主機地區（可選）。 */
  region?: string;
  /** 實作/版本標記（可選）。 */
  software?: string;
  /** 切結項，例："ephemeral"、"nip40-ttl"、"no-plaintext-log"、"no-censor"。 */
  attests: string[];
  /** 宣告時間（秒）。 */
  updatedAt: number;
}

/** 以營運者金鑰簽章一份節點自報（同 relay-list 模式，ADR-0039）。 */
export function signNodeAttestation(decl: CinderNodeDeclaration, operatorSk: SecretKey): NostrEvent {
  return finalizeEvent(
    { kind: NODE_ATTEST_KIND, created_at: decl.updatedAt, tags: [["r", decl.url]], content: JSON.stringify(decl) },
    operatorSk,
  );
}

/** 驗證節點自報並取出宣告；作者須等於指定營運者公鑰、簽章有效、內容合法。否則回 null。 */
export function verifyNodeAttestation(event: NostrEvent, operatorPubkey: PubkeyHex): CinderNodeDeclaration | null {
  if (event.kind !== NODE_ATTEST_KIND) return null;
  if (event.pubkey !== operatorPubkey) return null;
  if (!verifyEvent(event)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const d = parsed as Record<string, unknown>;
  if (typeof d.url !== "string" || typeof d.contact !== "string" || typeof d.updatedAt !== "number") return null;
  if (!Array.isArray(d.attests) || !d.attests.every((a) => typeof a === "string")) return null;
  return {
    url: d.url,
    contact: d.contact,
    ...(typeof d.region === "string" ? { region: d.region } : {}),
    ...(typeof d.software === "string" ? { software: d.software } : {}),
    attests: d.attests as string[],
    updatedAt: d.updatedAt,
  };
}

/** 黑箱一致性探測結果（由 relay 端工具跑出）：只驗「行為」——relay 內部無法稽核。 */
export interface NodeConformance {
  /** REQ→EOSE 存活。 */
  live: boolean;
  /** Ephemeral 語意正確（轉發但不持久化）。 */
  ephemeral: boolean;
  /** 已過期事件不被回傳（NIP-40）。 */
  rejectsExpired: boolean;
  /** 滾動 uptime 百分比（0–100）；未知則省略。 */
  uptimePct?: number;
}

/** 分級收錄決策（ADR-0092/0069）：把一致性/uptime 轉為 accepting/weight，附透明理由。 */
export interface AdmissionDecision {
  /** 是否自動分配新帳號（false＝試用：列進清單供韌性/手動用，但不自動選座）。 */
  accepting: boolean;
  /** 自動選座權重（0＝不列入）。 */
  weight: number;
  reasons: string[];
}

/**
 * 由一致性結果決定分級收錄。原則：先過 liveness → 一致性 → uptime；未達門檻皆落「試用」
 * （列進清單但不自動分配），達標才升為正式收錄與較高權重。全程附可公開的理由。
 */
export function evaluateAdmission(c: NodeConformance): AdmissionDecision {
  if (!c.live) return { accepting: false, weight: 0, reasons: ["節點無回應（liveness 失敗）——不列入"] };
  const fails: string[] = [];
  if (!c.ephemeral) fails.push("Ephemeral 語意不符（疑似持久化）");
  if (!c.rejectsExpired) fails.push("回傳已過期事件（NIP-40 不符）");
  if (fails.length > 0) return { accepting: false, weight: 1, reasons: [...fails, "一致性未過——試用（不自動分配）"] };
  const uptime = c.uptimePct;
  if (uptime === undefined || uptime < 95) {
    return { accepting: false, weight: 1, reasons: ["一致性通過；uptime 不足或未知——試用中"] };
  }
  if (uptime >= 99) return { accepting: true, weight: 2, reasons: ["一致性通過＋uptime≥99%——正式收錄"] };
  return { accepting: true, weight: 1, reasons: ["一致性通過＋uptime≥95%——收錄（低權重）"] };
}
