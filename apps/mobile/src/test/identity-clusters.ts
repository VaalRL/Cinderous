// Phase P4 階段 1 抽出去的 per-identity 功能簇（ADR-0331）。
//
// 🔴 **抽出去不能變成繞過守衛的方法。** `MobileApp.perIdentityState.test.ts` 掃的是
// `MobileApp.tsx` 裡的 `useState`——把 state 搬進一個 hook，它就從那份掃描裡消失了。
// 若不同步把 hook 納管，「重構」就等於「把東西藏到守衛看不到的地方」。
//
// 故每抽一簇就在這裡登記一筆，兩支守衛都會據此檢查。

/**
 * ⚠ ADR-0332 階段 2a 起，這 7 簇由 `use-identity-session.ts` 聚合成一個 `session` 物件，
 * 但 `MobileApp` 仍解構出同名的 holder（`const { self, roster, … } = session`）
 * ⇒ 下列 `holder` 名稱與守衛規則都不受影響。
 */
export interface IdentityCluster {
  /** 相對於 `apps/mobile/src/` 的檔名。 */
  file: string;
  /** `MobileApp.tsx` 裡持有它的變數名（`signInWith` 內必須呼叫 `<holder>.reset()`）。 */
  holder: string;
}

/** 已抽出的簇（ADR-0331 階段 1，全部完成）。 */
export const IDENTITY_CLUSTERS: IdentityCluster[] = [
  { file: "use-call-session.ts", holder: "call" },
  { file: "use-org-session.ts", holder: "org" },
  { file: "use-identity-settings.ts", holder: "settings" },
  { file: "use-calendar-session.ts", holder: "cal" },
  { file: "use-self-session.ts", holder: "self" },
  { file: "use-roster-session.ts", holder: "roster" },
  { file: "use-thread-session.ts", holder: "threads" },
];
