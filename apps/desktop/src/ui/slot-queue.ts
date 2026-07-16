// 公司儲存槽佇列（ADR-0161，員工端）：待存放檔案的本地佇列——存 savedPath 與 metadata，
// **不存位元組**（傳輸時以 ADR-0103 的路徑重讀）。企業主上線後由 App 逐一背景傳輸。
// 純函式＋localStorage 持久化（依身分命名空間），可測。

export type SlotStatus = "pending" | "sending" | "done" | "failed";

export interface SlotItem {
  /** 佇列項 id（queuedAt＋隨機尾碼）。 */
  id: string;
  /** 原檔路徑（ADR-0103 savedPath；傳輸時重讀）。 */
  path: string;
  name: string;
  size: number;
  mime: string;
  /** 來源對話標註（存放時的對話顯示名）。 */
  origin: string;
  status: SlotStatus;
  queuedAt: number;
}

const PREFIX = "nb.slotQueue.";

/** 加入佇列（同路徑已在排隊/傳輸中則略過，避免重複存放）；回傳新陣列。 */
export function enqueueSlot(queue: SlotItem[], item: Omit<SlotItem, "id" | "status">): SlotItem[] {
  if (queue.some((q) => q.path === item.path && (q.status === "pending" || q.status === "sending"))) return queue;
  const id = `${item.queuedAt}-${Math.random().toString(36).slice(2, 8)}`;
  return [...queue, { ...item, id, status: "pending" }];
}

/** 更新某項狀態；回傳新陣列（未知 id 原樣）。 */
export function setSlotStatus(queue: SlotItem[], id: string, status: SlotStatus): SlotItem[] {
  return queue.map((q) => (q.id === id ? { ...q, status } : q));
}

/** 移除某項。 */
export function removeSlot(queue: SlotItem[], id: string): SlotItem[] {
  return queue.filter((q) => q.id !== id);
}

/** 下一個待傳項（pending 依排隊先後）；無則 undefined。 */
export function nextPending(queue: SlotItem[]): SlotItem | undefined {
  return queue.find((q) => q.status === "pending");
}

/** 失敗項全部重排為待傳（重試）。 */
export function retryFailed(queue: SlotItem[]): SlotItem[] {
  return queue.map((q) => (q.status === "failed" ? { ...q, status: "pending" } : q));
}

/** 載入某身分的佇列；毀損/缺失回空（並過濾非法形狀）。開機時 sending 視為中斷 → 退回 pending。 */
export function loadSlotQueue(pubkey: string): SlotItem[] {
  try {
    const raw = localStorage.getItem(PREFIX + pubkey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (q): q is SlotItem =>
          !!q &&
          typeof q === "object" &&
          typeof (q as SlotItem).id === "string" &&
          typeof (q as SlotItem).path === "string" &&
          typeof (q as SlotItem).name === "string" &&
          typeof (q as SlotItem).origin === "string",
      )
      .map((q) => (q.status === "sending" ? { ...q, status: "pending" as const } : q));
  } catch {
    return [];
  }
}

export function saveSlotQueue(pubkey: string, queue: SlotItem[]): void {
  try {
    localStorage.setItem(PREFIX + pubkey, JSON.stringify(queue));
  } catch {
    /* 配額或不可用時忽略 */
  }
}
