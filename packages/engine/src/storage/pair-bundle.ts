// 配對捆包（D4a，ADR-0072）：一次性 P2P 全量搬家的內容層。
//
// 信封＝`{ v, relayUrl, cloudSync?, snapshot }`，snapshot 直接採 B2 的
// `StorageSnapshot`（零新格式）。經 core `encryptBundle`（一次性金鑰 AEAD）傳輸；
// 本模組只管「組包/驗包/套用」，加密與傳輸在協定層（core pairing）。
//
// 匯出/套用走 `AppStorage` 介面（而非特定實作的 export/import），
// 讓瀏覽器 LocalStorage 與 TauriStorage 一體適用。

import { stripDeviceLocalFile } from "./types.js";
import { utf8ByteLength } from "./utf8-size.js";
import type { AppStorage, StorageSnapshot, StoredFsState, StoredIdentity, StoredMessage } from "./types.js";

/**
 * 企業身分精華（ADR-0172）：搬家時把「這是不是工作/企業主身分」隨捆包帶到新機，
 * 讓新機（尤其行動端——本身無入職流程）能還原企業身分脈絡、據以設閘企業專屬 UI（如頭銜編輯）。
 * 這些欄位在 `Profile`（登錄）而非 `AppStorage`（快照）裡，故獨立帶。捆包本身走一次性金鑰
 * E2E 加密＋SAS 人工比對，且都是使用者自己的資料/持有的權杖 → 帶自己的兩台裝置間無隱私顧慮。
 */
export interface PairBundleOrg {
  /** 工作身分（受 allowlist、鎖漫遊）。 */
  enterprise?: boolean;
  /** 企業主（可管理名冊，ADR-0155）。 */
  orgOwner?: boolean;
  /** 企業名冊管理者 pubkey（ADR-0047）：新機據此訂閱並採用組織通訊錄。 */
  adminPubkey?: string;
  /** 成員入職權杖（ADR-0156）。 */
  orgJoinToken?: string;
  /** 公司帳號金鑰託管旗標（ADR-0163）。 */
  orgEscrow?: boolean;
  /** 企業主的核准權杖（ADR-0156）：嵌入邀請碼、比對入職請求。企業主身分才有。 */
  orgInviteToken?: string;
}

/** 配對捆包信封。 */
export interface PairBundle {
  v: 1;
  /** 來源身分的 home relay（新機建 profile 用）。 */
  relayUrl: string;
  /** 雲端快照模式（ADR-0071）：新機接續備份習慣；未設＝關閉。 */
  cloudSync?: "off" | "basic" | "full";
  /** 企業身分精華（ADR-0172）：舊捆包無此欄＝一般身分（向後相容）。 */
  org?: PairBundleOrg;
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
    // 剝除裝置本地欄位（同雲端快照）：`received` 帶到新機會讓它永遠不收那個檔案。
    const msgs = storage.loadMessages(key).map(stripDeviceLocalFile);
    if (msgs.length > 0) messages[key] = msgs;
  }
  return {
    identity: identity ?? storage.loadIdentity(),
    selfAvatar: storage.loadSelfAvatar(), // ADR-0154：搬家帶上自己的廣播頭像（含 "" 移除記號）
    selfTitle: storage.loadSelfTitle(), // ADR-0158：企業頭銜同理
    contacts,
    blocked,
    messages,
    reactions: storage.loadReactions(),
    deleted: storage.loadDeleted(),
    groups,
    bootstrapList: storage.loadBootstrapList(),
    // FS 狀態（ADR-0245）：**帶金鑰、不帶 `enabled`**（語意與理由見 StorageSnapshot.fs）。
    // 不帶金鑰的後果不是「少個功能」，是新機**靜默丟掉**所有加密到 EK 的訊息。
    // ADR-0316／0325：`failures`／`pending` 是**來源裝置**的東西，不隨捆包搬到新機。
    fs: { ...omitFailures(storage.loadFsState()), enabled: false },
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
/**
 * 「大捆包」門檻（bytes）——**ADR-0072／0305 §7，2026-07-31**。
 *
 * **為什麼是提示而不是續傳**：查證後，傳輸層已有 60 KB 分塊（`pairing-transport.ts`），
 * 大小本身傳得過去；缺的只有**中斷續傳**。而天真的續傳**省不到麻煩的那一半**——
 * 重連時 `nonceA`／`nonceB` 是新的 ⇒ **SAS 會變** ⇒ 使用者仍要再比對一次，
 * 而 SAS 比對正是這個流程最麻煩的部分。要真有價值得再加一層續傳票證（約 150–250 行）。
 *
 * ⇒ **決定：不做續傳**，階段 2 改為「可跳過、失敗可整份重來」，
 * 但**在量大時誠實提示重來的風險**（使用者指定）。
 *
 * 取值依據**來自量測而非拍腦袋**：實測每則中文文字訊息約 **193 UTF-8 bytes**
 * （正文 ~90 ＋ id ~30 ＋ JSON 結構 ~70），8 MB ≈ **四萬則上下**
 * ——落在「累積了不少歷史」而非「用兩天就跳警告」。
 * `pair-bundle.test.ts` 有測試把這個對應關係釘住，改門檻時會看到它的實際意義。
 *
 * ⚠ **原本這裡寫「200–300 bytes」的量測是用 `String.length` 做的**
 * ⇒ **訂門檻的依據與門檻本身錯在同一個地方，兩個錯誤互相掩護，測試自然會過。**
 * 已一併改為以 UTF-8 位元組量測。
 * ⚠ 修正時另一個誇大也要記下：低估幅度對**真實捆包是約 1.4 倍**，不是三倍——
 * 捆包裡有大量 ASCII（id、pubkey、時間戳、JSON 鍵），只有正文是中文。
 *
 * ⚠ 注意：檔案**只帶 metadata 不帶位元組**（`StoredFileMeta` 無 bytes），故主要成本是訊息與頭像。
 */
export const LARGE_BUNDLE_BYTES = 8 * 1024 * 1024;

/**
 * 這份捆包是否大到值得先警告「失敗要整份重來」。
 *
 * 🔴 **以 UTF-8 位元組計，不是 `String.length`**（審查發現的錯誤，2026-08-01 修）：
 * 傳輸實際送的是 `new TextEncoder().encode(bundleJson)`（`pairing.ts`），
 * 而 `.length` 是 UTF-16 code unit——中文一字 1 unit 但 **3 bytes**
 * ⇒ 舊寫法對中文內容**低估到三分之一**，警告會晚三倍才跳，
 * 而那個警告存在的理由正是「早點講」。
 */
export function isLargeBundle(bundleJson: string): boolean {
  return utf8ByteLength(bundleJson) > LARGE_BUNDLE_BYTES;
}

export function buildPairBundle(
  storage: AppStorage,
  profile: { relayUrl: string; cloudSync?: "off" | "basic" | "full"; org?: PairBundleOrg },
  identity?: StoredIdentity,
): string {
  const snapshot = exportFullSnapshot(storage, identity);
  if (!snapshot.identity?.nsec) {
    throw new Error("配對捆包缺少身分（nsec）：私鑰不在 AppStorage 時必須顯式傳入 identity");
  }
  // ADR-0172：只在真的是企業身分時帶 org（有任一旗標/欄位才帶，避免一般身分捆包多一個空物件）。
  const org = sanitizeBundleOrg(profile.org);
  const bundle: PairBundle = {
    v: 1,
    relayUrl: profile.relayUrl,
    ...(profile.cloudSync ? { cloudSync: profile.cloudSync } : {}),
    ...(org ? { org } : {}),
    snapshot,
  };
  return JSON.stringify(bundle);
}

/** 淨化 org（ADR-0172）：只留合法欄位；全空回 undefined（＝一般身分，不帶）。 */
/** 剝掉裝置本地的解封失敗觀測與待補解密文（ADR-0316／0325）；其餘 FS 狀態原樣帶走。 */
function omitFailures(fs: StoredFsState): StoredFsState {
  if (!fs.failures && !fs.pending) return fs;
  const { failures: _drop, pending: _alsoDrop, ...rest } = fs;
  return rest;
}

function sanitizeBundleOrg(raw: unknown): PairBundleOrg | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const org: PairBundleOrg = {};
  if (o.enterprise === true) org.enterprise = true;
  if (o.orgOwner === true) org.orgOwner = true;
  if (typeof o.adminPubkey === "string" && o.adminPubkey) org.adminPubkey = o.adminPubkey;
  if (typeof o.orgJoinToken === "string" && o.orgJoinToken) org.orgJoinToken = o.orgJoinToken;
  if (o.orgEscrow === true) org.orgEscrow = true;
  if (typeof o.orgInviteToken === "string" && o.orgInviteToken) org.orgInviteToken = o.orgInviteToken;
  return Object.keys(org).length > 0 ? org : undefined;
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
    // ADR-0172：淨化 org（不信任收到的形狀）——先剝掉原始 org，只回淨化後的；無/非法＝一般身分。
    const { org: _rawOrg, ...rest } = b as PairBundle;
    const org = sanitizeBundleOrg(_rawOrg);
    return { ...rest, ...(org ? { org } : {}) } as PairBundle;
  } catch {
    return null;
  }
}

/** 套用（新機）：走介面把全量狀態灌進（通常是全新命名空間的）儲存。 */
export function applyPairBundle(storage: AppStorage, bundle: PairBundle): void {
  const s = bundle.snapshot;
  if (s.identity) storage.saveIdentity(s.identity);
  // ADR-0154：舊捆包沒有 selfAvatar（undefined）→ 維持未設定；null 亦同（無可搬）。
  if (typeof s.selfAvatar === "string") storage.saveSelfAvatar(s.selfAvatar);
  if (typeof s.selfTitle === "string") storage.saveSelfTitle(s.selfTitle); // ADR-0158

  for (const c of s.contacts) storage.addContact(c);
  for (const g of s.groups) storage.saveGroup(g);
  for (const [, msgs] of Object.entries(s.messages)) {
    for (const m of msgs) storage.appendMessage(m);
  }
  for (const r of s.reactions) storage.addReaction(r);
  for (const id of s.deleted) storage.markDeleted(id);
  for (const b of s.blocked) storage.blockContact(b);
  if (s.bootstrapList) storage.saveBootstrapList(s.bootstrapList);
  // FS（ADR-0245）：舊捆包沒有這個欄位 → 略過（向後相容）。
  // `enabled` 在匯出端已被壓為 false；此處再明寫一次，避免日後有人改了匯出端就悄悄開啟。
  if (s.fs) storage.saveFsState({ ...s.fs, enabled: false });
}
