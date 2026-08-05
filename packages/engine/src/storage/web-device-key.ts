// 瀏覽器的裝置金鑰保管庫（ADR-0323 後續：把瀏覽器從 `plaintext` 拉到 `encrypted`）。
//
// ## 為什麼不是「用 nsec 導出的 DEK 包起來」
//
// 那條路（ADR-0112 的 `deriveStorageKey`）**更強**——攻擊者得先有密碼或 nsec 才解得開。
// 但它把裝置金鑰變成**身分層**的東西，而裝置金鑰是**裝置層**的（桌面與 Android 都是一把、
// 跨身分共用）。真正的殺手是**遷移**：舊的明文 `nb.deviceKey` 是共用的，第一個身分把它包進
// 自己的槽並抹掉明文後，**同一台上的其他身分就找不到自己的裝置金鑰了** ⇒ 掉出目錄、要重新授權，
// 而使用者只會看到「我另一個帳號的裝置不見了」。用一個看不見的破壞換一級保護，不划算。
//
// ## 做法：IndexedDB 裡一把**不可匯出**的 WebCrypto 金鑰
//
// `generateKey(..., extractable: false, ...)` 產出的 `CryptoKey` 可以存進 IndexedDB，
// 但**腳本永遠讀不出原始金鑰材料**。裝置金鑰以它 AES-GCM 加密後，密文放在同一個 store。
//
// 🔴 **這買到的是「不可外洩」，不是「不可使用」**：
//   - XSS／惡意腳本**再也偷不走**裝置金鑰（以前 localStorage 一行就撈走了）——這是實質改善；
//   - 但**完整複製瀏覽器設定檔**的人仍可能取得，因為包裹金鑰是瀏覽器自己保管的、沒有使用者祕密。
// 所以這是 `encrypted`（軟體包裹）而**不是** `keystore`。混講就是 ADR-0297 §6 紅線擋的事。
//
// ⚠ 包裹金鑰與密文**刻意放在同一個 store**：瀏覽器清儲存時兩者一起消失 ⇒ 只會落到
// 「什麼都沒有」（乾淨地生一把新的），不會落到「有密文卻沒鑰匙」那種永遠解不開的狀態。

import type { DeviceKeyVault } from "./device-key.js";

const DB_NAME = "cinder-device-key";
const STORE = "vault";
const ROW = "v1";

/** 保管庫的持久化面（抽出來是為了讓加解密邏輯可測；IDB 那層是薄接線）。 */
export interface WrapStore {
  read(): Promise<{ key: CryptoKey; blob: ArrayBuffer } | null>;
  write(key: CryptoKey, blob: ArrayBuffer): Promise<void>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb-open-failed"));
  });
}

/** IndexedDB 實作。金鑰與密文同一筆、同一個交易 ⇒ 不會有半套狀態。 */
export function idbWrapStore(): WrapStore {
  const tx = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexeddb-tx-failed"));
      });
    } finally {
      db.close();
    }
  };
  return {
    async read() {
      const row = await tx<{ key: CryptoKey; blob: ArrayBuffer } | undefined>("readonly", (s) => s.get(ROW));
      return row ?? null;
    },
    async write(key, blob) {
      await tx("readwrite", (s) => s.put({ key, blob }, ROW));
    },
  };
}

const IV_BYTES = 12;

/**
 * 瀏覽器裝置金鑰保管庫；環境不支援（無 IndexedDB／無 `crypto.subtle`，例如非安全脈絡）時回 null
 * ——**呼叫端據此不注入**，維持明文並如實顯示 `plaintext`（不裝比裝了說謊好）。
 *
 * ⚠ 內部**刻意不吞例外**：IndexedDB 被封（如 Firefox 隱私視窗）或解不開時要讓
 * `openDeviceKey()` 收到，它會落到 `ephemeral`——看得見的失敗，而不是靜默換一把新的（ADR-0122）。
 */
export function webDeviceKeyVault(store: WrapStore | null = defaultStore()): DeviceKeyVault | null {
  const subtle = globalThis.crypto?.subtle;
  if (!store || !subtle) return null;
  return {
    async load() {
      const row = await store.read();
      if (!row) return null;
      const bytes = new Uint8Array(row.blob);
      const iv = bytes.subarray(0, IV_BYTES);
      const ct = bytes.subarray(IV_BYTES);
      const plain = await subtle.decrypt({ name: "AES-GCM", iv }, row.key, ct);
      return new TextDecoder().decode(plain);
    },
    async save(nsec) {
      // 沿用既有那把（若有）：換一把會讓已存的密文解不開，而那是使用者的裝置身分。
      const key =
        (await store.read())?.key ??
        (await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ct = new Uint8Array(
        await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(nsec)),
      );
      const blob = new Uint8Array(new ArrayBuffer(iv.length + ct.length));
      blob.set(iv);
      blob.set(ct, iv.length);
      await store.write(key, blob.buffer);
    },
    // 包裹金鑰由瀏覽器保管、沒有使用者祕密參與 ⇒ 只到 `encrypted`，不到 `keystore`。
    tier: async () => "encrypted",
  };
}

function defaultStore(): WrapStore | null {
  try {
    return typeof indexedDB === "undefined" ? null : idbWrapStore();
  } catch {
    return null;
  }
}
