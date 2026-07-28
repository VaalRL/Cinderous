// 入職金鑰託管・企業主端（ADR-0163／0179／0258）：公司帳號成員入職時託管的私鑰，供日後離職
// 接管。與行動端 `apps/mobile/src/org-escrow.ts` 同一組純函式與**同一套加密落盤**。
//
// ## 為什麼這裡一定要加密（ADR-0258）
//
// 這份清單是**一整家公司的公司帳號私鑰**。ADR-0163 決策 #1 原本就寫明要「隨管理者身分的加密
// 儲存落地（ADR-0112）」，但實作曾直接 `localStorage.setItem(JSON)` ＝**明文落盤**：
//
// - **web 版**：任一 XSS 可一次撈走全公司公司帳號的 nsec；
// - **Tauri 版**：webview 的 localStorage 仍以明文落磁碟，保護僅來自 OS 檔案權限，
//   而非 ADR-0112 的靜態加密。
//
// 故改為與行動端一致：以**企業主自己 nsec 導出的金鑰**（`deriveStorageKey`）`sealValue` 封裝，
// 密文（`c1:` 前綴）才落盤——離開企業主的 nsec 就解不開，而企業主 nsec 本就不明文落盤。
//
// ## 舊明文的遷移
//
// `openValue` 對「無 `c1:` 前綴」的值原樣回傳，故舊明文自然仍讀得出來。但**光能讀不夠**——
// 磁碟上的明文必須真的消失。故 `loadEscrow` 一旦讀到未加密的舊值，**當場重寫為密文**
// （見 `migrateIfPlaintext`），不等到下次清單變動才補；使用者只要開過一次設定就完成遷移。

import { deriveStorageKey, openValue, sealValue } from "@cinderous/core";

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

/** ADR-0112 的密文前綴；用來辨識「這筆還是舊明文」。 */
const CIPHER_PREFIX = "c1:";

/** 加入/更新一筆託管（以 pubkey 為鍵）；回傳新陣列。 */
export function upsertEscrow(list: EscrowEntry[], entry: EscrowEntry): EscrowEntry[] {
  const rest = list.filter((e) => e.pubkey !== entry.pubkey);
  return [...rest, entry];
}

/** 移除一筆託管。 */
export function removeEscrow(list: EscrowEntry[], pubkey: string): EscrowEntry[] {
  return list.filter((e) => e.pubkey !== pubkey);
}

/**
 * 已離職（可接管）的託管條目（ADR-0163）：託管中、但**不在現行名冊在世成員**內者
 * ＝已被移出名冊＝離職。`liveMembers` 為現行名冊在世成員 pubkey 集合。
 */
export function offboardedEntries(list: EscrowEntry[], liveMembers: Set<string>): EscrowEntry[] {
  return list.filter((e) => !liveMembers.has(e.pubkey));
}

/** 形狀守門：只留下確實帶得動「接管」所需欄位的條目。 */
function isEntry(e: unknown): e is EscrowEntry {
  return (
    !!e &&
    typeof e === "object" &&
    typeof (e as EscrowEntry).pubkey === "string" &&
    typeof (e as EscrowEntry).nsec === "string" &&
    typeof (e as EscrowEntry).name === "string"
  );
}

/**
 * 讀某企業主的託管清單（以其 sk 導出的金鑰解密）；缺失／解不開／毀損一律回空。
 *
 * 讀到 ADR-0258 之前的**舊明文**時就地遷移為密文（見檔頭）。
 */
export function loadEscrow(adminPubkey: string, ownerSk: Uint8Array): EscrowEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(PREFIX + adminPubkey);
    if (!raw) return [];
    const json = openValue(deriveStorageKey(ownerSk), raw); // 密文→明文；金鑰錯回 null
    if (!json) return [];
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const list = parsed.filter(isEntry);
    migrateIfPlaintext(adminPubkey, ownerSk, raw, list);
    return list;
  } catch {
    return [];
  }
}

/** 舊明文就地改寫為密文（同一把鑰匙、同一個鍵）；已是密文則不動。 */
function migrateIfPlaintext(adminPubkey: string, ownerSk: Uint8Array, raw: string, list: EscrowEntry[]): void {
  if (raw.startsWith(CIPHER_PREFIX)) return;
  saveEscrow(adminPubkey, ownerSk, list); // 覆寫＝磁碟上的明文 nsec 就此消失
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
