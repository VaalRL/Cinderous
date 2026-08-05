// 身分世代守衛（ADR-0329／Phase P4）。
//
// ## 要擋的是什麼
//
// 行動端切身分是**就地切換**（桌面走 `location.reload()`＝結構性保證）。`signInWith` 內有一份
// 手寫的重設清單把 per-identity 狀態歸零，`MobileApp.perIdentityState.test.ts` 強制它不漏。
//
// 但那份清單只在**切換的那一瞬間**生效。已經發出去、還沒回來的非同步工作**不受它管**：
//
// ```ts
// // 開對話 → 查封存塊數（OPFS，非同步）
// void arch.chunkCount(id).then((n) => setArchived(...));
// //                                   ↑ 若這中間切了身分，這一行把**上個身分**的東西
// //                                     寫進**新身分**的 state
// ```
//
// `archived` 正是 ADR-0294 §2 抓到的那個「歷史入口閘門」——同一個 bug 換一條路回來。
// 而全專案原本 `grep cancelled|generation|epoch|abort` **是空的**：桌面 `App.tsx` 有
// `let cancelled = false`，行動端一個都沒有。
//
// ## 做法
//
// 每次 `signInWith` 把世代 +1。任何「等一下才會回來」的回呼在**發出前**記下當時的世代，
// **落地時**比對——變了就丟掉。
//
// 🔴 **丟掉是正確的失敗方向**：那份結果屬於上一個身分，對現在這個身分沒有意義。
// 反過來（照寫）就是跨身分洩漏。
//
// ## ADR-0332 2c 之後為什麼**還留著**
//
// 掛上 `key` 之後，`AppSession` 會在切身分時重掛，所以原本的計畫是「這支守衛可以退場——
// 舊 session 的落地寫進的是已卸載元件的 state，React 直接忽略」。
//
// 🔴 **那個推論只對一半。** 實際看了四個守衛點之後：
//
//   - `openConvo → setArchived`：確實是純 state 寫入 ⇒ 重掛已經涵蓋。
//   - **`sendFileFromPicker`／`sendPhotoFromCamera`／`depositToSlot`**：它們在 `.then` 裡呼叫的是
//     **閉包抓住的舊後端**（`b.sendFile(...)`）。元件卸載**不會**取消那個呼叫——
//     那是副作用，不是 setState，React 幫不上忙。
//
// ⇒ 「React 會忽略已卸載元件的 setState」買到的是**狀態**那一半，不是**副作用**那一半。
// 憑「反正 React 會忽略」就把守衛拆掉，會靜默地讓後三個點失去保護。故保留。

/** 一個身分世代守衛。 */
export interface EpochGuard {
  /** 記下當前世代，回傳「現在還是同一個身分嗎」。在**發出非同步工作前**呼叫。 */
  mark(): () => boolean;
  /** 進入新世代（切身分／登出）。 */
  bump(): void;
}

/** 建一個世代守衛（每個 App 實例一個，存在 ref 裡）。 */
export function makeEpochGuard(): EpochGuard {
  let epoch = 0;
  return {
    mark() {
      const at = epoch;
      return () => epoch === at;
    },
    bump() {
      epoch += 1;
    },
  };
}
