// 本機記住上線狀態與自訂狀態文字（ADR-0164；行動端於 ADR-0168 補齊）：只存本機、依身分
// 命名空間，下次上線還原。與桌面 `apps/desktop/src/ui/presence-store.ts` 同一份契約。
//
// 這**不改變**狀態在中繼站仍是 Ephemeral 的性質（心跳/狀態不持久化於中繼，全域鐵則不變）
// ——只是讓使用者自己的裝置記住「我上次把自己設成什麼」，免得每次上線重打。只記**手動**
// 選擇；閒置自動 away 不落地。

import type { Status } from "@cinderous/engine";

export interface PresencePref {
  status: Status;
  statusMessage: string;
}

const PREFIX = "nb.presence.";
const VALID: Status[] = ["online", "away", "busy", "offline"];

/** 讀某身分的上次狀態；缺失/毀損/非法回 null（呼叫端退回後端預設）。 */
export function loadPresence(pubkey: string): PresencePref | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(PREFIX + pubkey);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<PresencePref>;
    if (!VALID.includes(o.status as Status)) return null;
    return { status: o.status as Status, statusMessage: typeof o.statusMessage === "string" ? o.statusMessage : "" };
  } catch {
    return null;
  }
}

/** 寫某身分的狀態（手動變更時）。 */
export function savePresence(pubkey: string, pref: PresencePref): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PREFIX + pubkey, JSON.stringify(pref));
  } catch {
    /* 配額或不可用時忽略 */
  }
}
