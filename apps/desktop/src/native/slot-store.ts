// 公司儲存槽落盤（ADR-0161，企業主端）：靜默寫入槽目錄＋附加 index.jsonl。
// 平台縫——只這裡碰 Tauri IPC；寫入的路徑安全（基底外拒寫、逐段消毒）由 Rust 端保證。

import { invoke, isTauri } from "@tauri-apps/api/core";

const SLOT_DIR_PREFIX = "nb.slotDir.";

/** 讀槽目錄設定（依身分）；空字串＝使用 `<appData>/CinderSlot` 預設槽。 */
export function slotDir(pubkey: string): string {
  try {
    return localStorage.getItem(SLOT_DIR_PREFIX + pubkey) ?? "";
  } catch {
    return "";
  }
}

export function setSlotDir(pubkey: string, dir: string): void {
  try {
    localStorage.setItem(SLOT_DIR_PREFIX + pubkey, dir);
  } catch {
    /* 忽略 */
  }
}

/** 開原生「選擇資料夾」對話框設定槽目錄；取消回 null。 */
export async function pickSlotFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  return await invoke<string | null>("pick_folder");
}

/**
 * 落盤一筆存放（ADR-0161）：`<槽>/<員工名>/<YYYY-MM-DD>-<檔名>`（重名 Rust 端自動加尾碼）
 * ＋附加一行 index.jsonl。回傳實際相對路徑；非 Tauri 回 null。
 */
export async function storeSlotDeposit(
  base: string,
  deposit: { senderName: string; senderPubkey: string; name: string; origin: string; bytes: Uint8Array },
  now = new Date(),
): Promise<string | null> {
  if (!isTauri()) return null;
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const rel = await invoke<string>("write_slot_file", {
    base,
    sub: deposit.senderName,
    name: `${date}-${deposit.name}`,
    bytes: Array.from(deposit.bytes),
  });
  const line = JSON.stringify({
    at: now.toISOString(),
    from: deposit.senderName,
    pubkey: deposit.senderPubkey,
    origin: deposit.origin,
    file: deposit.name,
    path: rel,
  });
  await invoke("append_slot_index", { base, name: "index.jsonl", line });
  return rel;
}
