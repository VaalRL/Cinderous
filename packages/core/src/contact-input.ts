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

/** 解析結果：`npub` 為裸 npub 字串，`hint` 為中繼提示，`name` 為對方自報的顯示名稱。 */
export interface ContactInput {
  npub: string;
  hint: string | undefined;
  /**
   * 自報顯示名稱（ADR-0284）：只有 QR 這種**當面交換**的載體會帶。
   *
   * 為什麼需要它：單向加好友時，對方**在接受之前不會回送個人檔**——那是 ADR-0121 的
   * 反垃圾紅線（回送等於向陌生人確認「這把金鑰是活的」）。於是加完好友到對方按下接受
   * 之前，清單上只有 `npub1abc…`。當面掃碼時對方本來就是自願把名字亮給你看，
   * 由 QR 直接帶過來即可，不需要任何協定層的回饋。
   */
  name: string | undefined;
}

/**
 * 拆出 npub、中繼提示與自報名稱。**只做切分，不驗證** npub 是否解得開——
 * 呼叫端要驗就自己 `npubDecode`（後端本來就會丟，UI 則用 {@link isContactInput}）。
 *
 * 格式：`npub…`／`npub…@wss://…`／`npub…@wss://… #顯示名稱`／`npub… #顯示名稱`。
 *
 * **名稱一律以 `#` 標記**，不能只靠位置。沒有中繼提示時 `npub… 小明` 只有兩段，
 * 「小明」會被當成中繼提示——這正是第一版寫錯的地方。`#` 讓兩者永遠分得開。
 *
 * **舊版客戶端天然相容**：它們用 `split(sep, 2)` 只取前兩段。帶提示時多出的
 * `#名字` 直接被丟掉；不帶提示時 `#名字` 會落到 hint，但 `normalizeRelayUrl`
 * 認不得（不是 ws／wss）而丟棄——兩種情況都不會污染路由。
 */
export function parseContactInput(input: string): ContactInput {
  const parts = input
    .trim()
    .split(/[@\s]+/)
    .filter(Boolean);
  const rest = parts.slice(1);
  const at = rest.findIndex((p) => p.startsWith("#"));
  // `#` 之後全算名稱（名稱可含空白）。
  const name = at >= 0 ? [rest[at]!.slice(1), ...rest.slice(at + 1)].join(" ").trim() : "";
  const hint = at === 0 ? undefined : rest[0];
  return { npub: (parts[0] ?? "").trim(), hint, name: name || undefined };
}

/**
 * 組出可分享／編成 QR 的字串。`name` 只在當面交換的載體（QR）帶——
 * 純文字複製不帶，避免使用者把自己的名字連同 npub 貼到公開場合。
 */
export function formatContactInput(npubOrShareUri: string, name?: string): string {
  const n = name?.trim();
  return n ? `${npubOrShareUri.trim()} #${n}` : npubOrShareUri.trim();
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
