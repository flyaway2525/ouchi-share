// App Store 用の 1024×1024 のアイコン（icons/icon-1024.png）を作る。icons/icon-full.svg と同じ絵を、外部ライブラリなしで描く。
// 使い方：node scripts/make-icon-1024.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 1024;
const S = N / 512; // SVG（512）からの拡大率
const BG = [0xf0, 0x8a, 0x4b];
const HOUSE = [0xff, 0xf8, 0xf0];
const house = [[256, 104], [92, 240], [136, 240], [136, 408], [376, 408], [376, 240], [420, 240]].map(([x, y]) => [x * S, y * S]);
const check = [[196, 300], [238, 342], [320, 256]].map(([x, y]) => [x * S, y * S]);
const half = 15 * S; // 線の太さ 30 の半分（端と角は丸）

const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const nearLine = (x, y) => {
  for (let i = 0; i < check.length - 1; i++) {
    const [ax, ay] = check[i];
    const [bx, by] = check[i + 1];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    if (Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) <= half) return true;
  }
  return false;
};

// 1 ピクセルを 4×4 に分けて色を平均（ふちをなめらかに）
const SS = 4;
const raw = Buffer.alloc((N * 3 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 3 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        const py = y + (sy + 0.5) / SS;
        const c = inPoly(px, py, house) && !nearLine(px, py) ? HOUSE : BG;
        r += c[0];
        g += c[1];
        b += c[2];
      }
    }
    const o = y * (N * 3 + 1) + 1 + x * 3;
    raw[o] = Math.round(r / SS ** 2);
    raw[o + 1] = Math.round(g / SS ** 2);
    raw[o + 2] = Math.round(b / SS ** 2);
  }
}

// PNG（透明なし・RGB 8bit）
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // 8bit
ihdr[9] = 2; // RGB
writeFileSync(
  'icons/icon-1024.png',
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]),
);
console.log('icons/icon-1024.png を作りました');
