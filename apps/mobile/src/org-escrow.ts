// 入職金鑰託管・企業主端（ADR-0163／0179，行動端）：公司帳號成員入職時託管的私鑰，供日後
// 離職接管。與桌面 `apps/desktop/src/ui/org-escrow.ts` 同一組純函式，但**關鍵差異**：
//
// 桌面把託管 nsec **明文**存 localStorage（其 Tauri 版另有 OS 層保護）。行動端 web 沒有那層
// 保護，明文存員工私鑰＝XSS 就能一次撈走全公司的公司帳號金鑰。故行動端**一律加密落盤**：
// 以**企業主自己 nsec 導出的金鑰**（ADR-0112 `deriveStorageKey`）`sealValue` 封裝——密文離開
// 企業主的 nsec 就解不開，且企業主 nsec 本就不明文落盤（ADR-0112 紅線不破）。

import { deriveStorageKey, openValue, sealValue } from "@cinder/core";

export interface EscrowEntry {
  /** 成員 hex pubkey。 */
  pubkey: string;
  /** 入職時的顯示名。 */
  name: string;
  /** 託管私鑰（nsec）。 */
  nsec: string;
  /** 成員身分鎖定的公司 relay（接管登入用）。 */
  relayUrl: string;
  /** 託管到達時間（ms）。 */
  at: number;
}

const PREFIX = "nb.orgEscrow.";

/** 加入/更新一筆託管（以 pubkey 為鍵）；回傳新陣列。 */
export function upsertEscrow(list: EscrowEntry[], entry: EscrowEntry): EscrowEntry[] {
  return [...list.filter((e) => e.pubkey !== entry.pubkey), entry];
}

/** 移除一筆託管。 */
export function removeEscrow(list: EscrowEntry[], pubkey: string): EscrowEntry[] {
  return list.filter((e) => e.pubkey !== pubkey);
}

/**
 * 已離職（可接管）的託管條目（ADR-0163）：託管中、但**不在現行名冊在世成員**內者＝已被移出
 * 名冊＝離職。`liveMembers` 為現行名冊在世成員 pubkey 集合。
 */
export function offboardedEntries(list: EscrowEntry[], liveMembers: Set<string>): EscrowEntry[] {
  return list.filter((e) => !liveMembers.has(e.pubkey));
}

/** 讀某企業主的託管清單（以其 sk 導出的金鑰解密）；缺失/解不開/毀損回空。 */
export function loadEscrow(adminPubkey: string, ownerSk: Uint8Array): EscrowEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(PREFIX + adminPubkey);
    if (!raw) return [];
    const json = openValue(deriveStorageKey(ownerSk), raw); // 密文→明文；金鑰錯回 null
    if (!json) return [];
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is EscrowEntry =>
        !!e && typeof e === "object" && typeof (e as EscrowEntry).pubkey === "string" && typeof (e as EscrowEntry).nsec === "string" && typeof (e as EscrowEntry).name === "string",
    );
  } catch {
    return [];
  }
}

/** 寫某企業主的託管清單（**加密**：以其 sk 導出的金鑰封裝，密文才落盤）。 */
export function saveEscrow(adminPubkey: string, ownerSk: Uint8Array, list: EscrowEntry[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PREFIX + adminPubkey, sealValue(deriveStorageKey(ownerSk), JSON.stringify(list)));
  } catch {
    /* 配額或不可用時忽略 */
  }
}
