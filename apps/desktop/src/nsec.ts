// nsec 解碼的小工具（ADR-0119 由 App.tsx 抽出，供 `native/browser-store.ts` 共用）。

import { nsecDecode } from "@cinderous/core";

/** 解 nsec，失敗回 undefined（不讓一個壞掉的 nsec 讓整個登入炸掉）。 */
export function safeNsecDecode(nsec: string): Uint8Array | undefined {
  try {
    return nsecDecode(nsec);
  } catch {
    return undefined;
  }
}
