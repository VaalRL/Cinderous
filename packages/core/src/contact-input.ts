// 加好友輸入的解析（ADR-0281）：`npub…` 或 `npub…@wss://…`（亦可空白分隔）。
//
// ## 為什麼要抽出來
//
// 這條規則原本只寫在 `RelayChatBackend.addContact` 裡。行動端的 QR 掃描（ADR-0280）
// 另外寫了一份「是不是 npub」的檢查——只認裸 npub——結果掃桌面版產出的 QR 直接被打回。
// 因為桌面 QR 編的是 `selfShareUri`＝`npub…@wss://…`（帶中繼提示，ADR-0034），
// 兩邊規則不一致，能加的東西掃不進來。
//
// 同一個輸入格式只該有一份解析規則。

import { npubDecode } from "./keys.js";

/** 解析結果：`npub` 為裸 npub 字串，`hint` 為附帶的中繼提示（可能沒有）。 */
export interface ContactInput {
  npub: string;
  hint: string | undefined;
}

/**
 * 拆出 npub 與中繼提示。**只做切分，不驗證** npub 是否解得開——
 * 呼叫端要驗就自己 `npubDecode`（後端本來就會丟，UI 則用 {@link isContactInput}）。
 */
export function parseContactInput(input: string): ContactInput {
  const [rawNpub, inlineHint] = input.trim().split(/[@\s]+/, 2);
  return { npub: (rawNpub ?? "").trim(), hint: inlineHint };
}

/**
 * 這串輸入能不能拿去加好友（裸 npub 或帶中繼提示的分享字串都算）。
 * 供 UI 在把內容送進 `addContact` 之前先擋——特別是 QR 掃描：
 * 掃到的可能是網址、Wi-Fi 設定、別人的名片，不驗就把垃圾灌進去。
 */
export function isContactInput(input: string): boolean {
  try {
    npubDecode(parseContactInput(input).npub);
    return true;
  } catch {
    return false;
  }
}
