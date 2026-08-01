// UTF-8 位元組長度。
//
// 為什麼需要它：`String.length` 是 **UTF-16 code unit** 數，而我們送出去的一律是 UTF-8
// （`pairing.ts` 的 `new TextEncoder().encode(...)`、relay 事件的位元組上限皆然）。
// 中文一個字＝**1 個 UTF-16 unit 但 3 個 UTF-8 bytes** ⇒ 以 `.length` 當位元組會**低估到三分之一**，
// 而中文正是本專案的主要語系。
//
// 為什麼不直接 `new TextEncoder().encode(s).byteLength`：那會為了「只是量一下」而配置整份副本
// ——8 MB 的捆包要多配 20 MB 以上。此處以逐 code unit 計算，**不配置**。

/**
 * 字串編成 UTF-8 後的位元組數（不配置暫存）。
 *
 * 代理對（emoji 等增補平面字元）算 **4 bytes** 並跳過配對的低位 unit——
 * 否則會被當成兩個 3-byte 字元而多算 2。
 * 孤立代理（毀損字串）按 3 bytes 計，只求不拋錯、不歸零。
 */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4;
        i++; // 低位 unit 已計入，跳過
        continue;
      }
      n += 3; // 孤立高位代理
    } else {
      n += 3;
    }
  }
  return n;
}
