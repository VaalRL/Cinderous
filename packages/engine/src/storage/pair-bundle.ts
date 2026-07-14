// 配對捆包（D4a，ADR-0072）：一次性 P2P 全量搬家的內容層。
//
// 信封＝`{ v, relayUrl, cloudSync?, snapshot }`，snapshot 直接採 B2 的
// `StorageSnapshot`（零新格式）。經 core `encryptBundle`（一次性金鑰 AEAD）傳輸；
// 本模組只管「組包/驗包/套用」，加密與傳輸在協定層（core pairing）。
//
// 匯出/套用走 `AppStorage` 介面（而非特定實作的 export/import），
// 讓瀏覽器 LocalStorage 與 TauriStorage 一體適用。

import type { AppStorage, StorageSnapshot, StoredIdentity, StoredMessage } from "./types.js";

/** 配對捆包信封。 */
export interface PairBundle {
  v: 1;
  /** 來源身分的 home relay（新機建 profile 用）。 */
  relayUrl: string;
  /** 雲端快照模式（ADR-0071）：新機接續備份習慣；未設＝關閉。 */
  cloudSync?: "off" | "basic" | "full";
  snapshot: StorageSnapshot;
}

/**
 * 自任意 AppStorage 匯出全量快照（訊息鍵＝聯絡人 pubkey 與群組 id）。
 *
 * `identity` 可顯式覆寫——**這是必要的**：私鑰不在 `AppStorage` 裡的環境（Tauri 走 OS 金鑰庫、
 * 行動端根本不持久化 nsec、瀏覽器只存 Argon2id 包裹的 blob，見 ADR-0053/0112），
 * `storage.loadIdentity()` 會回 `null`。
 */
export function exportFullSnapshot(storage: AppStorage, identity?: StoredIdentity): StorageSnapshot {
  const contacts = storage.loadContacts();
  const groups = storage.loadGroups();
  const blocked = storage.loadBlocked();
  const messages: Record<string, StoredMessage[]> = {};
  for (const key of [...contacts.map((c) => c.pubkey), ...groups.map((g) => g.id)]) {
    const msgs = storage.loadMessages(key);
    if (msgs.length > 0) messages[key] = msgs;
  }
  return {
    identity: identity ?? storage.loadIdentity(),
    contacts,
    blocked,
    messages,
    reactions: storage.loadReactions(),
    deleted: storage.loadDeleted(),
    groups,
    bootstrapList: storage.loadBootstrapList(),
  };
}

/**
 * 組包（舊機）：全量快照＋profile 精華。輸出 JSON 字串（交給協定層加密）。
 *
 * **沒有 nsec 就當場拋錯**（ADR-0118）。過去這裡會靜默產出 `identity: null` 的捆包——
 * 舊機顯示「配對成功」，新機才在最後拋出「捆包缺少身分」。**失敗要發生在源頭，而不是在
 * 使用者已經比對完 SAS、以為搬家成功之後。**
 *
 * 這個洞是真的存在的：`nsecOverride` 的環境（**桌面 Tauri**、行動端）後端**不會**把 nsec
 * 寫進 `AppStorage`（ADR-0053：私鑰託給 OS 金鑰庫），於是 `storage.loadIdentity()` 回 `null`
 * ——**桌面的換機搬家一直是壞的**。呼叫端必須顯式傳入 `identity`（nsec 由金鑰庫/記憶體提供）。
 */
export function buildPairBundle(
  storage: AppStorage,
  profile: { relayUrl: string; cloudSync?: "off" | "basic" | "full" },
  identity?: StoredIdentity,
): string {
  const snapshot = exportFullSnapshot(storage, identity);
  if (!snapshot.identity?.nsec) {
    throw new Error("配對捆包缺少身分（nsec）：私鑰不在 AppStorage 時必須顯式傳入 identity");
  }
  const bundle: PairBundle = {
    v: 1,
    relayUrl: profile.relayUrl,
    ...(profile.cloudSync ? { cloudSync: profile.cloudSync } : {}),
    snapshot,
  };
  return JSON.stringify(bundle);
}

/** 驗包（新機）：格式不符回 null（解密已由協定層 GCM 驗證，這裡驗形狀）。 */
export function parsePairBundle(json: string): PairBundle | null {
  try {
    const b = JSON.parse(json) as Partial<PairBundle>;
    if (b.v !== 1 || typeof b.relayUrl !== "string") return null;
    const s = b.snapshot as Partial<StorageSnapshot> | undefined;
    if (!s || typeof s !== "object") return null;
    if (!Array.isArray(s.contacts) || !Array.isArray(s.groups) || !Array.isArray(s.blocked)) return null;
    if (!s.messages || typeof s.messages !== "object") return null;
    if (!Array.isArray(s.reactions) || !Array.isArray(s.deleted)) return null;
    if (!s.identity || typeof (s.identity as { nsec?: unknown }).nsec !== "string") return null;
    return b as PairBundle;
  } catch {
    return null;
  }
}

/** 套用（新機）：走介面把全量狀態灌進（通常是全新命名空間的）儲存。 */
export function applyPairBundle(storage: AppStorage, bundle: PairBundle): void {
  const s = bundle.snapshot;
  if (s.identity) storage.saveIdentity(s.identity);
  for (const c of s.contacts) storage.addContact(c);
  for (const g of s.groups) storage.saveGroup(g);
  for (const [, msgs] of Object.entries(s.messages)) {
    for (const m of msgs) storage.appendMessage(m);
  }
  for (const r of s.reactions) storage.addReaction(r);
  for (const id of s.deleted) storage.markDeleted(id);
  for (const b of s.blocked) storage.blockContact(b);
  if (s.bootstrapList) storage.saveBootstrapList(s.bootstrapList);
}
