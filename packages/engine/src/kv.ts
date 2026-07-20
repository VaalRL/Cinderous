// 可換式同步鍵值儲存（ADR-0219）：把 app 級「直接呼叫 localStorage」的**同步**存取抽成可換
// 基質，供行動端（RN）注入同步 MMKV。比照 notify.ts 的 getNotifier() 模式（單一基質、可 set）。
//
// 為何同步：身分登錄（profiles）、裝置 id 等是同步呼叫；RN 的 AsyncStorage 是**非同步**、換不
// 進來，要用**同步**的 react-native-mmkv（getString/set/delete）。預設 localStorage，環境不支援
// 時各方法優雅失敗（回 null / no-op），維持既有「localStorage 不可用就退回預設」的行為。

export interface KvStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage 基質（瀏覽器/桌面 webview/RN-web 預設）；環境不支援時各方法優雅失敗。 */
const localStorageKv: KvStore = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 配額/不可用忽略 */
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* 不可用忽略 */
    }
  },
};

let backend: KvStore = localStorageKv;

/** 取當前 KV 基質（同步）。 */
export function getKv(): KvStore {
  return backend;
}

/** 換 KV 基質（RN 進入點注入同步 MMKV 版）。傳 null 還原為預設 localStorage 基質。 */
export function setKvBackend(store: KvStore | null): void {
  backend = store ?? localStorageKv;
}
