// Open Graph 分享圖產生器（ADR-0235 SEO-4）。
//
// OG 標籤指向一張不存在的圖，比沒有 OG 標籤更糟——社群平台會抓到 404 並快取「無圖」。
// 這裡以純 Node 產出一張 1200×630 的 PNG，**零相依**（不引入 sharp/canvas/puppeteer：
// 官網的建置鏈要能在 CI 的乾淨容器裡跑完，多一個原生相依就多一個失敗點）。
//
// 做法：手工組 PNG——單一 IDAT、zlib deflate 由 node:zlib 提供，CRC32 自己算。
// 畫面是品牌漸層底 ＋ 中央火焰字標的簡化色塊；文字交給 OG 標題本身（各平台都會顯示）。

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 1200;
const H = 630;

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 品牌色（與 favicon／CinderMark 一致）。 */
const NAVY = [0x0f, 0x1f, 0x3a];
const EMBER = [0xff, 0x7a, 0x2f];
const GOLD = [0xff, 0xd6, 0x6b];

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

/** 火焰外形（與 favicon 的 path 同一組控制點，改以解析式近似）。 */
function flame(x, y, cx, cy, scale) {
  const dx = (x - cx) / scale;
  const dy = (y - cy) / scale;
  if (dy < -1 || dy > 1) return false;
  // 上窄下圓的水滴：頂端收成尖點（dy=-1 → 半寬 0），底端是半圓（dy=1 → 半寬 0）。
  // 底部若不收斂到 0 會被畫成一截平底，看起來像燈籠而不是火焰。
  const halfWidth = dy < 0 ? 0.6 * Math.pow(1 + dy, 1.7) : 0.6 * Math.sqrt(1 - dy * dy);
  return Math.abs(dx) <= halfWidth;
}

const raw = Buffer.alloc((W * 3 + 1) * H);
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    // 底：由左上到右下的深藍漸層，帶一圈中央輝光。
    const t = (x / W) * 0.5 + (y / H) * 0.5;
    let r = lerp(NAVY[0], 0x1b, t);
    let g = lerp(NAVY[1], 0x33, t);
    let b = lerp(NAVY[2], 0x5c, t);

    const cx = W / 2;
    const cy = H / 2;
    const glow = Math.max(0, 1 - Math.hypot((x - cx) / 420, (y - cy) / 300));
    r = Math.min(255, r + Math.round(glow * 26));
    g = Math.min(255, g + Math.round(glow * 14));

    if (flame(x, y, cx, cy, 240)) {
      const inner = flame(x, y, cx, cy + 62, 150);
      const shade = Math.min(1, Math.max(0, (y - (cy - 240)) / 480)); // 上冷下暖
      const [c0, c1] = inner ? [GOLD, GOLD] : [EMBER, EMBER];
      r = lerp(c0[0], c1[0], shade);
      g = lerp(c0[1], c1[1], shade);
      b = lerp(c0[2], c1[2], shade);
      if (!inner) {
        // 外焰下緣略深，讓形體有體積感。
        r = Math.max(0, r - Math.round(shade * 30));
        g = Math.max(0, g - Math.round(shade * 40));
      }
    }
    raw[p++] = r;
    raw[p++] = g;
    raw[p++] = b;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "og.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`已產生 ${out}（${W}×${H}, ${(png.length / 1024).toFixed(1)} KB）`);
