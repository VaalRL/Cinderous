// 清除單一身分的本機命名空間（ADR-0202）。
//
// ADR-0202 的決策是「唯一能徹底移除身分的方式是**刪本機資料**」。桌面 `native/wipe.ts`
// 早有這個純函式，但**行動端沒有**——其「移除此身分」只刪 nsec blob，
// 命名空間資料（含 `fsState` 的 EK 私鑰）整批留在 localStorage。
//
// 🔴 為什麼留著不只是「佔空間」：`fsState` 以 `deriveStorageKey(nsec)` 加密，而該導出是
// **決定性的**——同一把 nsec 再輸入一次，dek 就回來了。於是被移除的身分留下的 EK 私鑰
// **仍可解**，而那批金鑰本來會被 `pruneFsKeys` 的 grace 政策刪掉。
// ⇒ 移除身分反而**凍結**了一批應該消失的 EK，在「nsec 日後外洩」這個 FS 正要防的情境下，
// 那是實質的削弱。
//
// Fix First：搬到共用層一份，兩端都用它，而不是在行動端再寫一次。

/**
 * 刪掉 `nb.<namespace>.` 前綴下的所有鍵。
 *
 * - **空 namespace 一律不做事**：舊的單一身分用的是無前綴鍵（`nb.<suffix>`，見 `local.ts`），
 *   若對空字串展開前綴會把**全部**資料清掉。
 * - 前綴含結尾的 `.`：`nb.profiles`／`nb.deviceId` 這類**全域／裝置級**鍵不得被波及。
 * - **先收集再刪**：邊列舉邊刪會讓索引位移、漏掉鍵。
 *
 * `storage` 可注入以便測試；預設用全域 `localStorage`（不可用時靜默略過）。
 */
export function clearStorageNamespace(namespace: string, storage?: Storage): void {
  if (!namespace) return;
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!store) return;
  const prefix = `nb.${namespace}.`;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  keys.forEach((k) => store.removeItem(k));
}
