// App 版號（ADR-0227 P2）：build-time 由 vite `define` 注入（`__APP_VERSION__`），
// 源自 root package.json 的 version（SSOT）。與桌面 `apps/desktop/src/version.ts` 同構。
//
// 🔴 **必須有人讀它，否則那個 define 等於不存在。** `define` 是純文字替換：
// 沒有任何原始碼提到 `__APP_VERSION__` 時，版號字串根本不會出現在 bundle 裡
// ——行動端從 ADR-0227 起就是這個狀態，`vite.config.ts` 設了 define，卻沒有一處用到，
// 於是「四端統一版號」對使用者而言在行動端是不存在的（2026-09-21 發 v0.0.18 時發現）。
export const APP_VERSION: string = __APP_VERSION__;
