// 加密雲端快照的內容組裝與合併（ADR-0071）。
//
// 三檔模式：關（不發佈）／基本（聯絡人/群組/封鎖）／完整（＋近期訊息，上限內最新者）。
// 合併採交換律語意（同 ADR-0009）：聯絡人/群組補缺不覆蓋（本機活資料優先）、
// 封鎖聯集（安全優先，封鎖者同時移出聯絡人）、訊息以 id 去重補回——
// 多台裝置的快照以任意順序合併，結果一致。

import {
  isWellFormedAsset,
  isWellFormedOrSetTombstone,
  isWellFormedSyncedPref,
  isWellFormedTombstone,
  mergeAssetLibrary,
  mergeOrSet,
  mergeSyncedPrefs,
  OR_SET_TOMBSTONE_RETENTION_MS,
  pruneTombstonesByTime,
  type AssetTombstone,
  type CustomAsset,
  type OrSetTombstone,
  type SyncedPrefs,
} from "@cinderous/core";
import type { AppStorage, OrSetName, StoredContact, StoredGroup, StoredMessage } from "./types.js";

/** 雲端同步模式（ADR-0071 三檔）。 */
export type CloudSyncMode = "off" | "basic" | "full";

/** 完整模式的訊息則數上限（近期優先）。 */
export const SNAPSHOT_MESSAGE_CAP = 500;

/**
 * 明文位元組預算（審查修正 #2）：NIP-44 加密＋base64 膨脹（約 1.35×）＋事件外殼後，
 * 仍須低於 relay 端單顆 256KB（ADDRESSABLE_MAX_BYTES）——否則 relay 拒收、備份靜默失敗。
 */
export const SNAPSHOT_PLAINTEXT_BUDGET = 180_000;

/** 快照內自訂資產庫的子預算（ADR-0224）：與訊息共用 180KB 明文，庫最多吃這麼多、其餘留給訊息。 */
export const SNAPSHOT_ASSET_BUDGET = 90_000;

/** 快照合併時本地庫的寬鬆上限（ADR-0224）；權威策展上限在 UI 層（ADR-0220），此處只防灌爆。 */
export const SNAPSHOT_LIBRARY_MAX = 256;

/** 快照明文內容（NIP-44 加密前）。 */
export interface CloudSnapshotContent {
  v: 1;
  /** 產生時間（ms）。 */
  at: number;
  /** 產生端的模式（隨快照傳播；合併端於還原時採用）。 */
  mode: Exclude<CloudSyncMode, "off">;
  contacts: StoredContact[];
  groups: StoredGroup[];
  blocked: StoredContact[];
  /** 完整模式才有：近期訊息（跨對話、以 at 新到舊取前 N 則）。 */
  messages?: StoredMessage[];
  /** 自訂資產庫（ADR-0224）：小圖帶行內 svg、大 raster 只帶 ref（blob 另走自我 backfill）；預算內截斷。 */
  customAssets?: CustomAsset[];
  /** 資產刪除墓碑（ADR-0224）：LWW 交換律合併，跨自機傳播刪除。 */
  assetTombstones?: AssetTombstone[];
  /** 聯絡人刪除墓碑（ADR-0242 OR-Set）：跨裝置傳播「移除聯絡人」，修刪除復活。 */
  contactTombstones?: OrSetTombstone[];
  /** 群組離群墓碑（ADR-0242 OR-Set）：跨裝置傳播「離開/移除群組」，修離群復活。 */
  groupTombstones?: OrSetTombstone[];
  /** 封鎖解封墓碑（ADR-0242 OR-Set）：跨裝置傳播「解封」，修解封不傳播（G-Set→OR-Set）。 */
  blockTombstones?: OrSetTombstone[];
  /** 跨裝置同步設定（ADR-0242 階段③）：逐鍵 LWW（如每對話靜音）。只含該跨裝置的項。 */
  syncedPrefs?: SyncedPrefs;
}

/** 組裝快照內容：基本＝聯絡人/群組/封鎖；完整＝＋近期訊息。 */
/**
 * 剝除廣播頭像（ADR-0154）：data URI 每人數 KB，N 個聯絡人即撐爆 180KB 明文預算
 * （relay 單顆 256KB 上限、超過即拒收＝備份靜默失敗）。開機廣播會重新學到，不損失。
 */
function stripAvatar(c: StoredContact): StoredContact {
  const { avatar: _drop, ...rest } = c;
  return rest;
}

export function buildSnapshotContent(
  storage: AppStorage,
  mode: Exclude<CloudSyncMode, "off">,
  opts: { now?: number } = {},
): CloudSnapshotContent {
  const contacts = storage.loadContacts().map(stripAvatar);
  const groups = storage.loadGroups();
  const blocked = storage.loadBlocked().map(stripAvatar);
  // 自訂資產庫（ADR-0224）：mine（自建）優先、逐筆累加至子預算即停；
  // 大 raster 的內容本就不在庫（svg 已空、只帶 ref），blob 走自我 backfill。
  const orderedAssets = [...storage.loadCustomAssets()].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0));
  const customAssets: CustomAsset[] = [];
  let assetBytes = 0;
  for (const a of orderedAssets) {
    const len = JSON.stringify(a).length + 1;
    if (assetBytes + len > SNAPSHOT_ASSET_BUDGET) break;
    customAssets.push(a);
    assetBytes += len;
  }
  const assetTombstones = storage.loadAssetTombstones();
  // 時間 GC（ADR-0242）：不把早於保留窗的墓碑放進快照——超窗即回收，收斂快照大小。
  const tombFloor = (opts.now ?? Date.now()) - OR_SET_TOMBSTONE_RETENTION_MS;
  const contactTombstones = pruneTombstonesByTime(storage.loadCrdtTombstones("contacts"), tombFloor);
  const groupTombstones = pruneTombstonesByTime(storage.loadCrdtTombstones("groups"), tombFloor);
  const blockTombstones = pruneTombstonesByTime(storage.loadCrdtTombstones("blocked"), tombFloor);
  const syncedPrefs = storage.loadSyncedPrefs(); // ADR-0242 階段③
  const base: CloudSnapshotContent = {
    v: 1,
    at: opts.now ?? Date.now(),
    mode,
    contacts,
    groups,
    blocked,
    ...(customAssets.length ? { customAssets } : {}),
    ...(assetTombstones.length ? { assetTombstones } : {}),
    ...(contactTombstones.length ? { contactTombstones } : {}),
    ...(groupTombstones.length ? { groupTombstones } : {}),
    ...(blockTombstones.length ? { blockTombstones } : {}),
    ...(Object.keys(syncedPrefs).length ? { syncedPrefs } : {}),
  };
  if (mode !== "full") return base;
  const all: StoredMessage[] = [];
  for (const key of [...contacts.map((c) => c.pubkey), ...groups.map((g) => g.id)]) {
    all.push(...storage.loadMessages(key));
  }
  all.sort((a, b) => b.at - a.at);
  // 則數＋位元組雙預算（審查修正 #2）：由新到舊累計，超過任一上限即停——
  // 保證「最新優先的前綴」且序列化後不會被 relay 的單顆上限拒收。
  const kept: StoredMessage[] = [];
  let used = JSON.stringify({ ...base, messages: [] }).length;
  for (const m of all) {
    if (kept.length >= SNAPSHOT_MESSAGE_CAP) break;
    const len = JSON.stringify(m).length + 1;
    if (used + len > SNAPSHOT_PLAINTEXT_BUDGET) break;
    kept.push(m);
    used += len;
  }
  return { ...base, messages: kept };
}

/** 解析並驗證快照明文；格式不符回 null。 */
export function parseSnapshotContent(json: string): CloudSnapshotContent | null {
  try {
    const s = JSON.parse(json) as Partial<CloudSnapshotContent>;
    if (s.v !== 1 || (s.mode !== "basic" && s.mode !== "full")) return null;
    if (!Array.isArray(s.contacts) || !Array.isArray(s.groups) || !Array.isArray(s.blocked)) return null;
    if (s.messages !== undefined && !Array.isArray(s.messages)) return null;
    if (s.customAssets !== undefined && !Array.isArray(s.customAssets)) return null; // ADR-0224
    if (s.assetTombstones !== undefined && !Array.isArray(s.assetTombstones)) return null; // ADR-0224
    // ADR-0242：OR-Set 墓碑（逐筆過濾留到 merge，此處只驗頂層為陣列）。
    if (s.contactTombstones !== undefined && !Array.isArray(s.contactTombstones)) return null;
    if (s.groupTombstones !== undefined && !Array.isArray(s.groupTombstones)) return null;
    if (s.blockTombstones !== undefined && !Array.isArray(s.blockTombstones)) return null;
    // ADR-0242 階段③：同步設定為物件（逐筆過濾留到 merge）。
    if (s.syncedPrefs !== undefined && (typeof s.syncedPrefs !== "object" || Array.isArray(s.syncedPrefs))) return null;
    return s as CloudSnapshotContent;
  } catch {
    return null;
  }
}

/**
 * 兩端皆有的聯絡人做 per-field LWW（ADR-0242 階段②）：同步 `alias`／`notifySound` 兩個本地私有偏好，
 * 逐欄位取「fieldsAt 較新」的一方（含「清除」——清除也帶時間戳）。遠端較新才寫回並推進本地 fieldsAt；
 * 回報是否有**使用者可見**變更（值不同才算，純推進時間戳不算）。並發改不同欄位互不覆蓋。
 */
function mergeContactFieldsInto(storage: AppStorage, local: StoredContact, remote: StoredContact): boolean {
  const lf = local.fieldsAt ?? {};
  const rf = remote.fieldsAt ?? {};
  let changed = false;
  if ((rf.alias ?? 0) > (lf.alias ?? 0)) {
    if (remote.alias !== local.alias) changed = true;
    storage.setContactAlias(local.pubkey, remote.alias, rf.alias); // 遠端較新 → 採用（含清除），推進 fieldsAt
  }
  if ((rf.notifySound ?? 0) > (lf.notifySound ?? 0)) {
    if (remote.notifySound !== local.notifySound) changed = true;
    storage.setContactNotifySound(local.pubkey, remote.notifySound, rf.notifySound);
  }
  return changed;
}

/** OR-Set 墓碑集合有變才寫回並回報（避免順序/無變更誤報 changed）。 */
function saveTombstonesIfChanged(storage: AppStorage, set: OrSetName, merged: OrSetTombstone[]): boolean {
  const key = (t: OrSetTombstone): string => `${t.key}:${t.at}`;
  const before = new Set(storage.loadCrdtTombstones(set).map(key));
  const after = new Set(merged.map(key));
  if (before.size === after.size && [...after].every((k) => before.has(k))) return false;
  storage.saveCrdtTombstones(set, merged);
  return true;
}

/**
 * 合併快照進本機儲存（交換律）。回傳有訊息補回的對話鍵（供 UI 重放歷史）；
 * 無任何變更時 `changed` 為 false。
 */
export function mergeSnapshotContent(
  storage: AppStorage,
  content: CloudSnapshotContent,
  opts: { now?: number } = {},
): { changed: boolean; convos: string[] } {
  let changed = false;
  // 時間 GC（ADR-0242）：合併後回寫墓碑前，丟棄早於保留窗者——超窗回收、收斂大小。
  const tombFloor = (opts.now ?? Date.now()) - OR_SET_TOMBSTONE_RETENTION_MS;

  // ── 封鎖清單（OR-Set＋墓碑，ADR-0242）：解封現在能傳播（舊為聯集、只增不減＝解封失效）。 ──
  const localBlocked = storage.loadBlocked();
  const mb = mergeOrSet(
    localBlocked,
    content.blocked,
    storage.loadCrdtTombstones("blocked"),
    (content.blockTombstones ?? []).filter(isWellFormedOrSetTombstone),
    { keyOf: (b) => b.pubkey, atOf: (b) => b.at ?? 0 },
  );
  const blockedNow = new Set(mb.items.map((b) => b.pubkey));
  const blockedBefore = new Set(localBlocked.map((b) => b.pubkey));
  for (const b of mb.items) {
    if (!blockedBefore.has(b.pubkey)) {
      storage.blockContact(b); // 新封鎖：亦清出聯絡人（安全不變式）
      changed = true;
    }
  }
  for (const b of localBlocked) {
    if (!blockedNow.has(b.pubkey)) {
      storage.unblockContact(b.pubkey); // 解封傳播（墓碑較新蓋過封鎖）
      changed = true;
    }
  }
  if (saveTombstonesIfChanged(storage, "blocked", pruneTombstonesByTime(mb.tombstones, tombFloor))) changed = true;

  // ── 聯絡人（OR-Set＋墓碑）：移除傳得出去（舊為補缺、刪除會復活）。封鎖者永不入列。 ──
  const localContacts = storage.loadContacts();
  const mc = mergeOrSet(
    localContacts,
    content.contacts.filter((c) => !blockedNow.has(c.pubkey)),
    storage.loadCrdtTombstones("contacts"),
    (content.contactTombstones ?? []).filter(isWellFormedOrSetTombstone),
    { keyOf: (c) => c.pubkey, atOf: (c) => c.at ?? 0 },
  );
  const contactSurvivors = mc.items.filter((c) => !blockedNow.has(c.pubkey));
  const contactNow = new Set(contactSurvivors.map((c) => c.pubkey));
  const localContactByKey = new Map(localContacts.map((c) => [c.pubkey, c]));
  const remoteContactByKey = new Map(content.contacts.map((c) => [c.pubkey, c]));
  for (const c of contactSurvivors) {
    const local = localContactByKey.get(c.pubkey);
    if (!local) {
      storage.addContact(c); // 補新聯絡人（含遠端欄位）
      changed = true;
      continue;
    }
    // 階段②：兩端皆有 → 逐欄位 LWW（暱稱/音效）；成員身分不變、只同步欄位。
    const remote = remoteContactByKey.get(c.pubkey);
    if (remote && mergeContactFieldsInto(storage, local, remote)) changed = true;
  }
  for (const c of localContacts) {
    if (!contactNow.has(c.pubkey)) {
      storage.removeContact(c.pubkey); // 刪除傳播（遠端墓碑較新）
      changed = true;
    }
  }
  if (saveTombstonesIfChanged(storage, "contacts", pruneTombstonesByTime(mc.tombstones, tombFloor))) changed = true;

  // ── 群組（OR-Set＋墓碑）：離群/移除傳得出去（舊為補缺、離群會復活）。 ──
  const localGroups = storage.loadGroups();
  const mg = mergeOrSet(
    localGroups,
    content.groups,
    storage.loadCrdtTombstones("groups"),
    (content.groupTombstones ?? []).filter(isWellFormedOrSetTombstone),
    { keyOf: (g) => g.id, atOf: (g) => g.at ?? 0 },
  );
  const groupNow = new Set(mg.items.map((g) => g.id));
  const groupBefore = new Set(localGroups.map((g) => g.id));
  for (const g of mg.items) {
    if (!groupBefore.has(g.id)) {
      storage.saveGroup(g); // 補新群組（既有不覆蓋——admin 快照/名冊才是對帳權威）
      changed = true;
    }
  }
  for (const g of localGroups) {
    if (!groupNow.has(g.id)) {
      storage.removeGroup(g.id); // 離群傳播
      changed = true;
    }
  }
  if (saveTombstonesIfChanged(storage, "groups", pruneTombstonesByTime(mg.tombstones, tombFloor))) changed = true;

  // ── 同步設定（ADR-0242 階段③）：逐鍵 LWW（每對話靜音等）。畸形項先過濾再合併。 ──
  if (content.syncedPrefs !== undefined) {
    const localPrefs = storage.loadSyncedPrefs();
    const remotePrefs: SyncedPrefs = {};
    for (const [k, v] of Object.entries(content.syncedPrefs)) if (isWellFormedSyncedPref(v)) remotePrefs[k] = v;
    const mergedPrefs = mergeSyncedPrefs(localPrefs, remotePrefs);
    if (JSON.stringify(mergedPrefs) !== JSON.stringify(localPrefs)) {
      storage.saveSyncedPrefs(mergedPrefs);
      changed = true;
    }
  }

  const convos: string[] = [];
  if (content.messages) {
    const idsByConvo = new Map<string, Set<string>>();
    const knownIds = (convo: string): Set<string> => {
      let ids = idsByConvo.get(convo);
      if (!ids) {
        ids = new Set(storage.loadMessages(convo).map((m) => m.id));
        idsByConvo.set(convo, ids);
      }
      return ids;
    };
    // 由舊到新補回：還原情境（空機）下寫入順序＝時間順序。
    const sorted = [...content.messages].sort((a, b) => a.at - b.at);
    for (const m of sorted) {
      const ids = knownIds(m.contact);
      if (ids.has(m.id)) continue;
      storage.appendMessage(m);
      ids.add(m.id);
      if (!convos.includes(m.contact)) convos.push(m.contact);
      changed = true;
    }
  }
  // 自訂資產庫（ADR-0224）：LWW＋墓碑交換律合併；mine 受保護；僅集合/內容有變才寫回
  // （順序變不算變更，避免 acquireAssets 的 LRU 序與合併的 at 序不同而誤報 changed）。
  if (content.customAssets !== undefined || content.assetTombstones !== undefined) {
    const localAssets = storage.loadCustomAssets();
    const localTombs = storage.loadAssetTombstones();
    const merged = mergeAssetLibrary(
      localAssets,
      (content.customAssets ?? []).filter(isWellFormedAsset), // 過濾畸形項（審查修正）：勿讓壞資料污染本機庫
      localTombs,
      (content.assetTombstones ?? []).filter(isWellFormedTombstone),
      { max: SNAPSHOT_LIBRARY_MAX, protect: (a) => a.mine === true },
    );
    const akey = (a: CustomAsset): string => `${a.id}:${a.at ?? 0}:${a.shortcode ?? ""}:${a.mine ? 1 : 0}`;
    const beforeA = new Set(localAssets.map(akey));
    if (merged.assets.length !== localAssets.length || merged.assets.some((a) => !beforeA.has(akey(a)))) {
      storage.saveCustomAssets(merged.assets);
      changed = true;
    }
    const tkey = (t: AssetTombstone): string => `${t.id}:${t.at}`;
    const beforeT = new Set(localTombs.map(tkey));
    if (merged.tombstones.length !== localTombs.length || merged.tombstones.some((t) => !beforeT.has(tkey(t)))) {
      storage.saveAssetTombstones(merged.tombstones);
      changed = true;
    }
  }
  return { changed, convos };
}
