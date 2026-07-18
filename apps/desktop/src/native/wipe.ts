// 移除身分 / 清空裝置（ADR-0202）：破壞性、不可逆。桌面（Tauri）走 Rust 刪金鑰庫與磁碟；
// 瀏覽器清 localStorage / IndexedDB / OPFS。呼叫端負責二次確認與呼叫後 reload。

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Profile } from "@cinderous/engine";

/** 供清除用的最小身分資訊（pubkey＋namespace）。 */
export type WipeTarget = Pick<Profile, "pubkey" | "namespace">;

/**
 * 清掉某 namespace 的瀏覽器 localStorage 資料（鍵格式 `nb.{ns}.*`，見 engine/local.ts）。
 * 空 namespace（legacy 單一身分）刻意略過——其鍵是 `nb.{suffix}`、與全域鍵（nb.profiles…）
 * 無法安全區分；該資料為 DEK 加密、無 nsec 不可解，整台清空時才一併清掉。純函式、可測。
 */
export function clearBrowserNamespace(namespace: string): void {
  if (!namespace) return;
  const prefix = `nb.${namespace}.`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

/** 移除單一身分的本機資料（金鑰＋儲存）。桌面走 Rust `wipe_identity`；瀏覽器清 localStorage。 */
export async function wipeIdentityLocal(p: WipeTarget): Promise<void> {
  if (isTauri()) {
    await invoke("wipe_identity", { pubkey: p.pubkey, namespace: p.namespace });
  } else {
    clearBrowserNamespace(p.namespace);
  }
}

/** 盡力清掉瀏覽器的 IndexedDB 與 OPFS 封存（整台清空用；失敗不阻斷）。 */
async function clearBrowserBulk(): Promise<void> {
  try {
    const dbs = await indexedDB.databases?.();
    dbs?.forEach((d) => d.name && indexedDB.deleteDatabase(d.name));
  } catch {
    /* 略 */
  }
  try {
    const root = await navigator.storage?.getDirectory?.();
    // @ts-expect-error OPFS 目錄 async 迭代（規格較新，型別未涵蓋）
    for await (const name of root?.keys?.() ?? []) {
      await root!.removeEntry(name, { recursive: true }).catch(() => {});
    }
  } catch {
    /* 略 */
  }
}

/**
 * 清空整台裝置：所有身分的金鑰＋磁碟儲存＋登錄＋WebView 資料。呼叫後應 `location.reload()`
 * 回到全新登入頁。桌面逐一 `wipe_identity`（金鑰庫無法枚舉，故靠登錄提供清單）再 `wipe_store_dir`。
 */
export async function wipeDeviceLocal(profiles: WipeTarget[]): Promise<void> {
  if (isTauri()) {
    for (const p of profiles) {
      await invoke("wipe_identity", { pubkey: p.pubkey, namespace: p.namespace });
    }
    await invoke("wipe_store_dir");
  } else {
    await clearBrowserBulk();
  }
  // 兩端都清 WebView 儲存（登錄 nb.profiles、relay、presence、per-ns 瀏覽器資料…）。
  try {
    localStorage.clear();
  } catch {
    /* 略 */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* 略 */
  }
}
