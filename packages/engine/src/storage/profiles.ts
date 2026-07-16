// 多身分設定檔登錄（ADR-0045）：工作＋個人身分並存，一次一個作用中。
//
// 每身分的資料以 pubkey 命名空間隔離（見 LocalStorage）。此模組只管「有哪些身分、
// 誰在作用中」的全域登錄（`nb.profiles`），純邏輯可測；載入時把既有單一身分
// （舊 `nb.identity`）遷移為 namespace 為空的 legacy 設定檔，向後相容。

import { getPublicKey, nsecDecode } from "@cinder/core";

export interface Profile {
  /** hex pubkey，作為身分主鍵。 */
  pubkey: string;
  name: string;
  /** 此身分的 home relay URL。 */
  relayUrl: string;
  /** 工作身分（連公司座、受 allowlist、鎖定漫遊）。 */
  enterprise: boolean;
  /**
   * 企業主（ADR-0155）：可管理/發佈組織名冊的身分標記。後端語意與一般個人身分完全相同
   * （漫遊/搬家/配對全開；成員的鎖定是「接受組織管理」的結果，管理者不受自己管理）——
   * 此旗標只決定 UI：切換器前綴 🗂 與 idbar 名冊管理按鈕的顯示。舊資料無此欄＝false。
   */
  orgOwner?: boolean;
  /** localStorage 命名空間；空＝既有單一身分的舊鍵（ADR-0045）。 */
  namespace: string;
  /** 企業名冊管理者 hex pubkey（工作身分可選，ADR-0047）：訂閱並自動採用組織通訊錄。 */
  adminPubkey?: string;
  /** 搬家前的舊 home relay（ADR-0066 H3 排水）；排水期滿或提前完成後移除。 */
  previousRelayUrl?: string;
  /** 排水截止（ms epoch）＝搬家時間＋7 天，對齊 relay 端 TTL 上限（ADR-0065）。 */
  drainUntil?: number;
  /** 本地密碼已啟用（ADR-0067）：開機須先解鎖；真實狀態以金鑰庫為準，此旗標供 UI 閘門。 */
  locked?: boolean;
  /** 隱藏身分（ADR-0067）：不在切換器顯示（作用中除外）；僅供已啟用密碼的身分選用。 */
  hidden?: boolean;
  /** 加密雲端快照模式（ADR-0071 三檔）；未設＝關閉。 */
  cloudSync?: "off" | "basic" | "full";
}

export interface ProfilesState {
  profiles: Profile[];
  /** 作用中身分的 pubkey；無身分時為 null。 */
  active: string | null;
}

const KEY = "nb.profiles";

/** 新增或更新設定檔（以 pubkey 為鍵），並設為作用中。 */
export function upsertProfile(state: ProfilesState, profile: Profile): ProfilesState {
  const profiles = state.profiles.filter((p) => p.pubkey !== profile.pubkey);
  profiles.push(profile);
  return { profiles, active: profile.pubkey };
}

/** 排水窗長度：7 天，對齊 relay 端離線留言 TTL 上限（ADR-0065）——到期後舊站保證沒有自己的信。 */
export const DRAIN_MS = 7 * 86_400_000;

/**
 * 更換某身分的 home relay（ADR-0066 H2）：只改 relayUrl，namespace／name／enterprise
 * 等其餘欄位與作用中選擇全數保留——搬家不是換身分，資料零損失。未知 pubkey 回原狀態。
 * 同時記下舊站與排水截止（H3）；排水為單槽：期內再搬只保留最近一站。
 */
export function changeProfileRelay(
  state: ProfilesState,
  pubkey: string,
  relayUrl: string,
  opts: { now?: number } = {},
): ProfilesState {
  if (!state.profiles.some((p) => p.pubkey === pubkey)) return state;
  const now = opts.now ?? Date.now();
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.pubkey === pubkey
        ? { ...p, relayUrl, ...(p.relayUrl ? { previousRelayUrl: p.relayUrl, drainUntil: now + DRAIN_MS } : {}) }
        : p,
    ),
  };
}

/**
 * 排水期滿或使用者提前完成：移除舊站記錄（ADR-0066 H3）。未知 pubkey 回原狀態。
 * 註：ADR-0083 排水完全內部化後目前無生產呼叫端（到期由 activeDrain 自然回 null）；
 * 保留此純函式供未來「立即斷開舊中繼站」進階選項或資料清理復用（含單元測試）。
 */
export function clearDrain(state: ProfilesState, pubkey: string): ProfilesState {
  if (!state.profiles.some((p) => p.pubkey === pubkey)) return state;
  return {
    ...state,
    profiles: state.profiles.map((p) => {
      if (p.pubkey !== pubkey) return p;
      const { previousRelayUrl: _prev, drainUntil: _until, ...rest } = p;
      return rest;
    }),
  };
}

/** 進行中的排水（ADR-0066 H3）：未到期回舊站與截止時間；到期、與現站相同或從未搬家回 null。 */
export function activeDrain(p: Profile | null, now: number): { url: string; until: number } | null {
  if (!p?.previousRelayUrl || p.drainUntil === undefined) return null;
  if (p.previousRelayUrl === p.relayUrl || now >= p.drainUntil) return null;
  return { url: p.previousRelayUrl, until: p.drainUntil };
}

/** 移除設定檔；若移除的是作用中，改指向剩餘的第一個（或 null）。 */
export function removeProfile(state: ProfilesState, pubkey: string): ProfilesState {
  const profiles = state.profiles.filter((p) => p.pubkey !== pubkey);
  const active = state.active === pubkey ? (profiles[0]?.pubkey ?? null) : state.active;
  return { profiles, active };
}

/** 切換作用中身分（pubkey 不存在則不變）。 */
export function setActive(state: ProfilesState, pubkey: string): ProfilesState {
  if (!state.profiles.some((p) => p.pubkey === pubkey)) return state;
  return { ...state, active: pubkey };
}

/** 目前作用中的設定檔（無則 null）。 */
export function activeProfile(state: ProfilesState): Profile | null {
  return state.profiles.find((p) => p.pubkey === state.active) ?? null;
}

/** 更新某身分的本地密碼旗標（ADR-0067）；未指定的旗標不動。未知 pubkey 回原狀態。 */
export function setProfileSecurity(
  state: ProfilesState,
  pubkey: string,
  patch: { locked?: boolean; hidden?: boolean },
): ProfilesState {
  if (!state.profiles.some((p) => p.pubkey === pubkey)) return state;
  return {
    ...state,
    profiles: state.profiles.map((p) => (p.pubkey === pubkey ? { ...p, ...patch } : p)),
  };
}

/** 切換器可見的身分（ADR-0067 隱藏身分）：過濾 hidden，但作用中即使 hidden 也顯示。 */
export function visibleProfiles(state: ProfilesState): Profile[] {
  return state.profiles.filter((p) => !p.hidden || p.pubkey === state.active);
}

/**
 * 登入畫面以顯示名稱解析身分（ADR-0146）。name 不是加密金鑰，只是「選哪個既有身分」的查找鍵：
 * - `enter`：恰好命中一個**可見（非隱藏）**同名身分 → 進入既有身分（有鎖則後續解鎖驗密碼）。
 * - `ambiguous`：命中多個同名（僅可能來自本規則之前的舊資料；新資料受 `nameTaken` 擋重名）→
 *   不得靜默進入以免登入到錯的身分，由 UI 擋下。
 * - `create`：無命中 → 建立新身分（新金鑰）。
 *
 * 隱藏身分永不被名稱命中（維持 ADR-0067 的隱藏性；只能經「解鎖隱藏身分」逐一試密碼）。
 */
export type SignInResolution =
  | { kind: "enter"; profile: Profile }
  | { kind: "ambiguous"; profiles: Profile[] }
  | { kind: "create" };

export function resolveSignIn(state: ProfilesState, name: string): SignInResolution {
  const trimmed = name.trim();
  if (!trimmed) return { kind: "create" };
  const hits = state.profiles.filter((p) => !p.hidden && p.name.trim() === trimmed);
  if (hits.length === 1) return { kind: "enter", profile: hits[0]! };
  if (hits.length > 1) return { kind: "ambiguous", profiles: hits };
  return { kind: "create" };
}

/**
 * 本機是否已有同名的**可見（非隱藏）**身分（ADR-0146 名稱唯一）。用於新增/改名時擋重名，
 * 讓 `resolveSignIn` 的命中無歧義。排除 hidden：既不因「名稱被佔用」洩漏隱藏身分的存在，
 * 也允許一個可見與一個隱藏同名並存（登入只命中可見那個）。`exceptPubkey` 排除自己（改名情境）。
 */
export function nameTaken(state: ProfilesState, name: string, exceptPubkey?: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  return state.profiles.some((p) => p.pubkey !== exceptPubkey && !p.hidden && p.name.trim() === trimmed);
}

/** 設定某身分的雲端快照模式（ADR-0071）；未知 pubkey 回原狀態。 */
export function setProfileCloudSync(
  state: ProfilesState,
  pubkey: string,
  cloudSync: "off" | "basic" | "full",
): ProfilesState {
  if (!state.profiles.some((p) => p.pubkey === pubkey)) return state;
  return {
    ...state,
    profiles: state.profiles.map((p) => (p.pubkey === pubkey ? { ...p, cloudSync } : p)),
  };
}

/**
 * 還原時採用快照傳播的模式（ADR-0071）：**僅在本機從未設定**（undefined）時採用——
 * 新還原裝置自動接續備份習慣，但不覆蓋使用者較新的手動選擇（含明確設「off」）。
 */
export function adoptCloudSyncMode(
  state: ProfilesState,
  pubkey: string,
  mode: "basic" | "full",
): ProfilesState {
  const p = state.profiles.find((x) => x.pubkey === pubkey);
  if (!p || p.cloudSync !== undefined) return state;
  return setProfileCloudSync(state, pubkey, mode);
}

function validate(value: unknown): ProfilesState | null {
  if (typeof value !== "object" || value === null) return null;
  const s = value as { profiles?: unknown; active?: unknown };
  if (!Array.isArray(s.profiles)) return null;
  const profiles = s.profiles.filter(
    (p): p is Profile =>
      !!p &&
      typeof p === "object" &&
      typeof (p as Profile).pubkey === "string" &&
      typeof (p as Profile).name === "string" &&
      typeof (p as Profile).relayUrl === "string" &&
      typeof (p as Profile).enterprise === "boolean" &&
      typeof (p as Profile).namespace === "string",
  );
  const active = typeof s.active === "string" && profiles.some((p) => p.pubkey === s.active) ? s.active : (profiles[0]?.pubkey ?? null);
  return { profiles, active };
}

/**
 * 載入設定檔登錄。首次（無 `nb.profiles`）時，若存在既有單一身分（`nb.identity`），
 * 將其遷移為 namespace 為空的 legacy 設定檔並持久化，達成向後相容。
 */
export function loadProfiles(): ProfilesState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = validate(JSON.parse(raw));
      if (parsed) return parsed;
    }
    // 遷移既有單一身分
    const idRaw = localStorage.getItem("nb.identity");
    if (idRaw) {
      const id = JSON.parse(idRaw) as { nsec: string; name: string };
      const pubkey = getPublicKey(nsecDecode(id.nsec));
      const relayUrl = localStorage.getItem("nb.relayUrl") ?? "";
      const legacy: Profile = { pubkey, name: id.name, relayUrl, enterprise: false, namespace: "" };
      const state: ProfilesState = { profiles: [legacy], active: pubkey };
      saveProfiles(state);
      return state;
    }
  } catch {
    /* 毀損/不可用：回空 */
  }
  return { profiles: [], active: null };
}

export function saveProfiles(state: ProfilesState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 配額或不可用時忽略 */
  }
}
