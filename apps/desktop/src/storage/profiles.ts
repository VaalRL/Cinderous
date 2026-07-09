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
  /** localStorage 命名空間；空＝既有單一身分的舊鍵（ADR-0045）。 */
  namespace: string;
  /** 企業名冊管理者 hex pubkey（工作身分可選，ADR-0047）：訂閱並自動採用組織通訊錄。 */
  adminPubkey?: string;
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

/**
 * 更換某身分的 home relay（ADR-0066 H2）：只改 relayUrl，namespace／name／enterprise
 * 等其餘欄位與作用中選擇全數保留——搬家不是換身分，資料零損失。未知 pubkey 回原狀態。
 */
export function changeProfileRelay(state: ProfilesState, pubkey: string, relayUrl: string): ProfilesState {
  if (!state.profiles.some((p) => p.pubkey === pubkey)) return state;
  return {
    ...state,
    profiles: state.profiles.map((p) => (p.pubkey === pubkey ? { ...p, relayUrl } : p)),
  };
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
