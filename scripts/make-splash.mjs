// iPhone アプリの起動画面（ios/App/App/Assets.xcassets/Splash.imageset の 2732×2732）を作る。
// クリーム色の背景の真ん中に、角丸のアイコン（icons/icon.svg と同じ絵）を置く。外部ライブラリなしで描く。
// 使い方：node scripts/make-splash.mjs（npx cap add ios のあとに 1 回）
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 2732;
const ICON = 560; // アイコンの大きさ
const S = ICON / 512;
const O = (N - ICON) / 2; // アイコンの左上
const BG = [0xff, 0xf8, 0xf0];
const ORANGE = [0xf0, 0x8a, 0x4b];
const P = ([x, y]) => [O + x * S, O + y * S];
const house = [[256, 104], [92, 240], [136, 240], [136, 408], [376, 408], [376, 240], [420, 240]].map(P);
const check = [[196, 300], [238, 342], [320, 256]].map(P);
const half = 15 * S;
const R = 112 * S; // 角丸

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
const inRounded = (x, y) => {
  const lx = x - O;
  const ly = y - O;
  if (lx < 0 || ly < 0 || lx > ICON || ly > ICON) return false;
  const cx = Math.min(Math.max(lx, R), ICON - R);
  const cy = Math.min(Math.max(ly, R), ICON - R);
  return Math.hypot(lx - cx, ly - cy) <= R;
};
const colorAt = (x, y) => {
  if (!inRounded(x, y)) return BG;
  return inPoly(x, y, house) && !nearLine(x, y) ? BG : ORANGE;
};

const SS = 3;
const row = N * 3 + 1;
const raw = Buffer.alloc(row * N);
for (let y = 0; y < N; y++) {
  raw[y * row] = 0;
  const near = y >= O - 2 && y <= O + ICON + 2;
  for (let x = 0; x < N; x++) {
    const o = y * row + 1 + x * 3;
    let c = BG;
    if (near && x >= O - 2 && x <= O + ICON + 2) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = colorAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          r += s[0];
          g += s[1];
          b += s[2];
        }
      }
      c = [r, g, b].map((v) => Math.round(v / SS ** 2));
    }
    raw[o] = c[0];
    raw[o + 1] = c[1];
    raw[o + 2] = c[2];
  }
}

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
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const dir = 'ios/App/App/Assets.xcassets/Splash.imageset';
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) writeFileSync(`${dir}/${name}`, png);
console.log('起動画面の画像を作りました');
