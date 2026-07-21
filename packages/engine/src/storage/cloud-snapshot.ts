// 加密雲端快照的內容組裝與合併（ADR-0071）。
//
// 三檔模式：關（不發佈）／基本（聯絡人/群組/封鎖）／完整（＋近期訊息，上限內最新者）。
// 合併採交換律語意（同 ADR-0009）：聯絡人/群組補缺不覆蓋（本機活資料優先）、
// 封鎖聯集（安全優先，封鎖者同時移出聯絡人）、訊息以 id 去重補回——
// 多台裝置的快照以任意順序合併，結果一致。

import { mergeAssetLibrary, type AssetTombstone, type CustomAsset } from "@cinderous/core";
import type { AppStorage, StoredContact, StoredGroup, StoredMessage } from "./types.js";

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
  const base: CloudSnapshotContent = {
    v: 1,
    at: opts.now ?? Date.now(),
    mode,
    contacts,
    groups,
    blocked,
    ...(customAssets.length ? { customAssets } : {}),
    ...(assetTombstones.length ? { assetTombstones } : {}),
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
    return s as CloudSnapshotContent;
  } catch {
    return null;
  }
}

/**
 * 合併快照進本機儲存（交換律）。回傳有訊息補回的對話鍵（供 UI 重放歷史）；
 * 無任何變更時 `changed` 為 false。
 */
export function mergeSnapshotContent(
  storage: AppStorage,
  content: CloudSnapshotContent,
): { changed: boolean; convos: string[] } {
  let changed = false;
  // 封鎖先行（安全優先）：聯集，且封鎖者不得經快照重新入列聯絡人。
  const blockedSet = new Set(storage.loadBlocked().map((b) => b.pubkey));
  for (const b of content.blocked) {
    if (blockedSet.has(b.pubkey)) continue;
    storage.blockContact(b);
    blockedSet.add(b.pubkey);
    changed = true;
  }
  const have = new Set(storage.loadContacts().map((c) => c.pubkey));
  for (const c of content.contacts) {
    if (have.has(c.pubkey) || blockedSet.has(c.pubkey)) continue;
    storage.addContact(c);
    have.add(c.pubkey);
    changed = true;
  }
  const gids = new Set(storage.loadGroups().map((g) => g.id));
  for (const g of content.groups) {
    if (gids.has(g.id)) continue; // 既有群組不覆蓋（admin 快照/名冊才是對帳權威）
    storage.saveGroup(g);
    gids.add(g.id);
    changed = true;
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
      content.customAssets ?? [],
      localTombs,
      content.assetTombstones ?? [],
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
