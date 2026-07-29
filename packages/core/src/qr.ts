// QR 產生（M9 加好友）：把自己的 npub 編成可掃描的 QR 碼，讓好友用手機掃描交換 ID。
//
// 桌面端負責「顯示 QR」；掃描（相機解碼）在行動端（Phase D）。加好友的同意/加入
// 流程沿用既有 `addContact(npub)`（A3）。編碼採廣泛使用的 qrcode-generator。

import qrcode from "qrcode-generator";

/** QR 模組矩陣：`count` 為每邊模組數，`isDark(r,c)` 為該格是否為暗點。 */
export interface QrMatrix {
  count: number;
  isDark: (row: number, col: number) => boolean;
}

/** 以自動版本 + 中等容錯（M）產生 QR 模組矩陣。 */
export function makeQr(text: string): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return { count, isDark: (r, c) => qr.isDark(r, c) };
}

/**
 * 產生 QR 的 SVG 字串（白底、暗點為單一 path）。`quiet` 為靜區（模組數），
 * `cell` 為每模組像素邊長。SVG 可縮放不失真、利於掃描。
 */
export function qrSvg(text: string, opts: { quiet?: number; cell?: number } = {}): string {
  const quiet = opts.quiet ?? 4;
  const cell = opts.cell ?? 4;
  const { count, isDark } = makeQr(text);
  const dim = (count + quiet * 2) * cell;
  let path = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (isDark(r, c)) {
        const x = (c + quiet) * cell;
        const y = (r + quiet) * cell;
        path += `M${x} ${y}h${cell}v${cell}h-${cell}z`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/>` +
    `</svg>`
  );
}

/** 把 SVG 轉為可放進 `<img src>` 的 data URI。 */
export function qrDataUri(text: string, opts?: { quiet?: number; cell?: number }): string {
  return `data:image/svg+xml,${encodeURIComponent(qrSvg(text, opts))}`;
}
