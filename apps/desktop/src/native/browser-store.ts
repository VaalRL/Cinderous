// 瀏覽器模式的儲存建構（ADR-0119）——**單一來源**。
//
// ## 為什麼要獨立成一個模組
//
// ADR-0112 立下規矩：web 的 localStorage 一律以 nsec 導出的 DEK 靜態加密。但
// `new LocalStorage(ns, cap)` **省略金鑰時是靜默寫明文的**（為了相容 CLI 與測試裡的
// 明文用法）——沒有警告、沒有錯誤，看起來一切正常。
//
// 結果：桌面 App 的瀏覽器分支有四個地方各自 `new LocalStorage(...)`，**全都忘了傳金鑰**，
// 而且其中兩處還把真的 nsec 寫進 `saveIdentity()`。**ADR-0112 在這條路徑上整個是死碼**，
// 而它宣稱修好的正是「web 明文存私鑰」。
//
// 所以「怎麼建一個瀏覽器儲存」只能有**一個**答案，而且它必須是可測的。呼叫端不再自己 new。
//
// ## 兩件事一起做
//
//  1. **靜態加密**：DEK 由 nsec 導出（ADR-0112）。
//  2. **封存共用同一把金鑰**：OPFS 封存（ADR-0111）拿 `store.storageKey()`——否則熱區加密、
//     冷區明文，等於沒加密。

import { LocalStorage, openOpfsArchive } from "@cinderous/engine";
import { safeNsecDecode } from "../nsec.js";

/**
 * 建立瀏覽器模式的儲存（localStorage ＋ OPFS 封存，兩者共用同一把 DEK）。
 *
 * `nsec` **必須傳**才會加密。傳 `undefined` 是明文——只有在「還沒有身分」（例如首次開啟、
 * 尚未產生金鑰）時才成立，此時儲存裡也還沒有任何敏感資料。
 *
 * 封存以 `void` 非同步掛上：OPFS 開啟是 async，但儲存必須同步可用。**掛上前不裁切熱區**
 * （`attachArchive` 才會啟用 writer），所以這個時間差不會弄丟訊息。
 */
export function browserStore(namespace: string, nsec: string | undefined): LocalStorage {
  const sk = nsec ? safeNsecDecode(nsec) : undefined;
  const store = new LocalStorage(namespace, 0, sk);
  void openOpfsArchive(namespace, store.storageKey()).then((a) => {
    if (a) store.attachArchive?.(a);
  });
  return store;
}
