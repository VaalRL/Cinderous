// 經典佈局聯絡人分區/排序（ADR-0215，MSN 擬真）：純函式、可測。
// 三種模式：依狀態（現有）、依分組（沿用既有標籤、可多屬）、依名稱（A→Z 平列）。
import type { Contact, Status } from "@cinderous/engine";
import { contactLabel } from "@cinderous/engine";

export type SortMode = "status" | "group" | "name";

export interface ContactSection {
  /** 穩定鍵（收合狀態持久化用）。 */
  key: string;
  /** 依狀態模式：該區的狀態（標題以 STATUS_KEY 譯）。 */
  status?: Status;
  /** 依分組模式：標籤名（即分組名）。 */
  labelName?: string;
  /** 依分組模式：未分組 catch-all。 */
  ungrouped?: boolean;
  /** 依名稱模式：單一「全部」區。 */
  all?: boolean;
  contacts: Contact[];
  online: number;
  total: number;
  /** 標頭是否顯示「線上/總數」（分組模式）；否則只顯示總數（狀態/名稱模式）。 */
  showOnlineCount: boolean;
}

const STATUS_ORDER: Status[] = ["online", "away", "busy", "offline"];
/** MSN 語意：away/busy 仍算「線上」（已連線但離開/忙碌）；offline＝顯示為離線。 */
const isOnline = (c: Contact): boolean => c.status !== "offline";
const byName = (a: Contact, b: Contact): number => contactLabel(a).localeCompare(contactLabel(b));
const byOnlineThenName = (a: Contact, b: Contact): number =>
  Number(isOnline(b)) - Number(isOnline(a)) || byName(a, b);
const counts = (list: Contact[]): { online: number; total: number } => ({
  online: list.filter(isOnline).length,
  total: list.length,
});

/**
 * 依模式分區（ADR-0215）。純函式、不改動輸入。空區一律略過。
 * - status：線上→離開→忙碌→離線，區內依名稱；標頭顯示總數。
 * - group：每標籤一區（一人多標籤 → 多區都出現）＋未分組；區內線上優先再名稱；標頭顯示線上/總數。
 * - name：單一「全部」區、A→Z；標頭顯示總數。
 */
export function groupContacts(
  contacts: Contact[],
  mode: SortMode,
  contactLabels: Record<string, string[]>,
): ContactSection[] {
  if (mode === "name") {
    const list = [...contacts].sort(byName);
    return list.length > 0 ? [{ key: "all", all: true, contacts: list, ...counts(list), showOnlineCount: false }] : [];
  }
  if (mode === "status") {
    return STATUS_ORDER.map((status): ContactSection => {
      const list = contacts.filter((c) => c.status === status).sort(byName);
      return { key: `status:${status}`, status, contacts: list, ...counts(list), showOnlineCount: false };
    }).filter((s) => s.total > 0);
  }
  // group 模式：以標籤分區（可多屬）＋未分組
  const labelSet = new Set<string>();
  for (const c of contacts) for (const l of contactLabels[c.pubkey] ?? []) labelSet.add(l);
  const sections: ContactSection[] = [...labelSet]
    .sort((a, b) => a.localeCompare(b))
    .map((labelName): ContactSection => {
      const list = contacts.filter((c) => (contactLabels[c.pubkey] ?? []).includes(labelName)).sort(byOnlineThenName);
      return { key: `label:${labelName}`, labelName, contacts: list, ...counts(list), showOnlineCount: true };
    });
  const ungrouped = contacts.filter((c) => (contactLabels[c.pubkey] ?? []).length === 0).sort(byOnlineThenName);
  if (ungrouped.length > 0) {
    sections.push({ key: "ungrouped", ungrouped: true, contacts: ungrouped, ...counts(ungrouped), showOnlineCount: true });
  }
  return sections;
}
