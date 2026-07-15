// 行動端多身分（ADR-0138）：沿用 @cinder/engine 的 profiles 登錄（純狀態轉換，ADR-0045），
// 行動端補上兩塊行動端專屬的儲存：
//   1. **每身分一份密碼包裹的 nsec**（`nb.remembered.<pubkey>`）——行動端絕不明文存 nsec（ADR-0112），
//      每身分各有本地密碼，切換即解該身分的密碼。
//   2. **舊單一身分的遷移**：多身分之前只存一份 `nb.remembered`；首次載入時遷成一個 profile。
//
// 資料隔離本就免費：行動端一向以 pubkey 為 LocalStorage 命名空間（見 storage/local.ts），
// 故切換身分＝換命名空間，各身分的聯絡人/訊息/群組天然分開。

import {
  activeProfile,
  loadProfiles,
  type Profile,
  type ProfilesState,
  removeProfile,
  saveProfiles,
  setActive,
  upsertProfile,
  visibleProfiles,
} from "@cinder/engine";
import { npubDecode } from "@cinder/core";
import { isRemembered, type MobileIdentity, rememberIdentity, type RememberedIdentity } from "./auth.js";

export { activeProfile, type Profile, type ProfilesState, visibleProfiles };

/** 每身分的密碼包裹 blob 鍵：`nb.remembered.<pubkey>`。 */
const REMEMBER_PREFIX = "nb.remembered.";
/** 舊的單一記住身分鍵（多身分之前）。 */
const LEGACY_REMEMBER_KEY = "nb.remembered";

const blobKey = (pubkey: string): string => REMEMBER_PREFIX + pubkey;

/** 讀某身分的密碼包裹 blob；非法/不存在回 null。 */
export function getRemembered(pubkey: string): RememberedIdentity | null {
  try {
    const raw = localStorage.getItem(blobKey(pubkey));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return isRemembered(v) ? v : null; // 只認 Argon2id blob——明文一律不收（ADR-0112 紅線）
  } catch {
    return null;
  }
}

/** 寫某身分的密碼包裹 blob。回 false＝配額/不可用。 */
export function putRemembered(r: RememberedIdentity): boolean {
  try {
    localStorage.setItem(blobKey(r.pubkey), JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
}

function deleteRemembered(pubkey: string): void {
  try {
    localStorage.removeItem(blobKey(pubkey));
  } catch {
    /* 忽略 */
  }
}

/**
 * 載入身分登錄。首次（無 `nb.profiles`）且存在舊的單一記住身分（`nb.remembered`）時，
 * 遷移為一個 profile ＋ 每身分 blob，並清掉舊鍵（單一真實來源），向後相容。
 */
export function loadIdentities(relayUrl: string): ProfilesState {
  const state = loadProfiles(); // engine：行動端無 nb.identity → 空；或既有 nb.profiles
  if (state.profiles.length > 0) return state;
  try {
    const raw = localStorage.getItem(LEGACY_REMEMBER_KEY);
    if (raw) {
      const v: unknown = JSON.parse(raw);
      if (isRemembered(v)) {
        const profile: Profile = {
          pubkey: v.pubkey,
          name: v.name,
          relayUrl,
          enterprise: false,
          namespace: v.pubkey, // 行動端資料一向以 pubkey 命名空間
        };
        putRemembered(v); // 複製到 per-pubkey 鍵
        const next = upsertProfile(state, profile);
        saveProfiles(next);
        try {
          localStorage.removeItem(LEGACY_REMEMBER_KEY);
        } catch {
          /* 忽略——登錄已寫入，舊鍵殘留無害（下次不再遷移） */
        }
        return next;
      }
    }
  } catch {
    /* 忽略 */
  }
  return state;
}

/**
 * 記住／更新一個身分：以密碼包裹 nsec、寫入該身分 blob，並在登錄中 upsert（設為作用中）。
 * 密碼空回 null（不接受無密碼——那等於明文，ADR-0112）。回新狀態與 blob。
 */
export function rememberInProfile(
  state: ProfilesState,
  identity: MobileIdentity,
  password: string,
  relayUrl: string,
): { state: ProfilesState; remembered: RememberedIdentity } | null {
  const r = rememberIdentity(identity, password);
  if (!r || !putRemembered(r)) return null;
  const profile: Profile = {
    pubkey: identity.pubkey,
    name: identity.name,
    relayUrl,
    enterprise: false,
    namespace: identity.pubkey,
  };
  const next = upsertProfile(state, profile);
  saveProfiles(next);
  return { state: next, remembered: r };
}

/** 移除一個身分（登出/刪除）：刪 blob＋登錄移除；回新狀態（作用中改指剩餘第一個或 null）。 */
export function removeIdentity(state: ProfilesState, pubkey: string): ProfilesState {
  deleteRemembered(pubkey);
  const next = removeProfile(state, pubkey);
  saveProfiles(next);
  return next;
}

/** 切換作用中身分並持久化。 */
export function switchActive(state: ProfilesState, pubkey: string): ProfilesState {
  const next = setActive(state, pubkey);
  saveProfiles(next);
  return next;
}

/**
 * 這個 npub 是不是**自己的某個身分**（ADR-0055：跨身分交友＝社交圖譜洩漏，一律禁止）。
 * 後端只擋作用中身分；多身分下連其他已註冊身分也要擋。解不出 pubkey 回 false（交後端驗格式）。
 */
export function isOwnIdentity(state: ProfilesState, npub: string): boolean {
  try {
    const pk = npubDecode(npub.trim());
    return state.profiles.some((p) => p.pubkey === pk);
  } catch {
    return false;
  }
}
