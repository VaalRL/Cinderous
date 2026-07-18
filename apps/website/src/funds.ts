// 官方資金透明度（ADR-0090）：純函式。funds.json ＝以「專屬透明度金鑰」簽章的 Nostr 事件
// （同 relay-list 信任根模式，ADR-0039）。前端**驗簽通過才渲染數字**——CDN/host 被入侵也改不動。
import { finalizeEvent, type NostrEvent, type PubkeyHex, type SecretKey, verifyEvent } from "@cinderous/core";

/** funds.json 事件 kind：僅為靜態檔的結構標記，不發佈到任何 relay。 */
export const FUNDS_KIND = 30088;

/**
 * 釘死於原始碼的透明度公鑰（信任根，ADR-0090）。與 relay-list 維護者金鑰、任何使用者身分**皆分離**。
 * ⚠️ 目前為**佔位金鑰**（開發用）；正式上線前必須換成專屬離線金鑰並重簽 funds.json（見 README）。
 */
export const TRANSPARENCY_PUBKEY: PubkeyHex = "7fb989c676cce640d545919144ef1f9a65009a79c573cea451e822bd16b5f5a3";

export interface FundsAllocation {
  /** 期別，例 "2026-06"。 */
  period: string;
  /** 官方節點營運支出。 */
  nodeOps: number;
  /** 已承諾/發放的貢獻者獎金。 */
  bonuses: number;
  /** 其他。 */
  other: number;
  note?: string;
}

export interface FundsData {
  balance: number;
  currency: string;
  /** 月燒＝官方節點成本＋已承諾獎金。 */
  monthlyBurn: number;
  /** 上次更新（ISO 8601）；誠實標示「非秒級即時」。 */
  updatedAt: string;
  allocations: FundsAllocation[];
}

/** 以透明度金鑰簽章一份 funds 文件（內容 JSON 進事件、schnorr 簽；同 relay-list 模式）。 */
export function signFunds(data: FundsData, sk: SecretKey): NostrEvent {
  return finalizeEvent(
    {
      kind: FUNDS_KIND,
      created_at: Math.floor(new Date(data.updatedAt).getTime() / 1000),
      tags: [],
      content: JSON.stringify(data),
    },
    sk,
  );
}

function isAllocation(x: unknown): x is FundsAllocation {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (
    typeof a.period === "string" &&
    typeof a.nodeOps === "number" &&
    typeof a.bonuses === "number" &&
    typeof a.other === "number" &&
    (a.note === undefined || typeof a.note === "string")
  );
}

/**
 * 驗證 funds 事件並取出文件；任一不符回 null（**fail-closed**：不顯示數字）：
 * kind 不符、作者非釘死透明度公鑰、簽章無效、內容非法。
 */
export function verifyFunds(event: NostrEvent, pubkey: PubkeyHex = TRANSPARENCY_PUBKEY): FundsData | null {
  if (event.kind !== FUNDS_KIND) return null;
  if (event.pubkey !== pubkey) return null;
  if (!verifyEvent(event)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const d = parsed as Record<string, unknown>;
  if (
    typeof d.balance !== "number" ||
    typeof d.currency !== "string" ||
    typeof d.monthlyBurn !== "number" ||
    typeof d.updatedAt !== "string" ||
    !Array.isArray(d.allocations) ||
    !d.allocations.every(isAllocation)
  ) {
    return null;
  }
  return {
    balance: d.balance,
    currency: d.currency,
    monthlyBurn: d.monthlyBurn,
    updatedAt: d.updatedAt,
    allocations: d.allocations as FundsAllocation[],
  };
}

/** Runway：以餘額與月燒推估「官方節點可續營運約幾個月」。monthlyBurn≤0 回 Infinity。 */
export function runwayMonths(data: FundsData): number {
  if (data.monthlyBurn <= 0) return Infinity;
  return data.balance / data.monthlyBurn;
}
