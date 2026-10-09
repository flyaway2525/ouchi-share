// 壁紙（自分の画面だけ）。全体の設定と、グループごとの設定（このグループだけ別の壁紙）がある。
// - 設定は端末に保存（localStorage の ouchi-share:wallpaper:<scope>。scope は 'global' か 'g:<グループ ID>'）
//   { type: 'none' | 'season' | 'photo', clarity: 1 | 2 | 3, layers: [{ kind: 'image' | 'video', fit: 'cover' | 'contain' } | null × 3] }
//   layers は 奥（0）・まん中（1）・手前（2）の 3 枚まで。グループの設定がなければ全体の設定を使う
// - 画像・GIF・動画は、この端末の中（IndexedDB）にだけ保存する（キー '<scope>:<0〜2>'）。Firebase には送らない（通信・費用なし）
//   - 写真（JPEG など）は長い辺 1600px に縮める。PNG・WebP は透明なところを残す。GIF と動画は動きを残すため縮めない
// - 季節の壁紙は、その月の色と絵文字（カレンダーの季節と同じ）で描く（SVG。グラデーションと模様の 2 枚）
// - タブ（カレンダー・イベント・リスト・日記）を移ると、壁紙が横にずれる。奥はゆっくり、手前は大きく動いて奥行きが出る（setParallax）
// - clarity（見やすさ）：壁紙の上にかける膜の濃さ。1 うすい（壁紙がよく見える）〜 3 こい（文字が読みやすい）
// - 「動きを減らす」設定の人には、ずれる動きと動画を止める

const KEY = (scope) => `ouchi-share:wallpaper:${scope}`;
const SEASONS = [
  ['#d0453c', '🎍'],
  ['#d9608a', '🌺'],
  ['#d4a800', '🌼'],
  ['#e57fa3', '🌸'],
  ['#43a047', '🌿'],
  ['#7e66c9', '☔'],
  ['#1e96d2', '🌊'],
  ['#f29a0c', '🌻'],
  ['#a8873a', '🎑'],
  ['#ec7424', '🎃'],
  ['#c2412d', '🍁'],
  ['#2e8a5c', '🎄'],
];
export const LAYER_NAMES = ['奥', 'まん中', '手前'];
const DEPTH = [0.35, 0.65, 1]; // タブを移ったときの動く量（奥 → 手前）
const STEP_VW = 7; // タブ 1 つぶんのずれ（手前の画像。画面の幅の %）
const MAX_TABS = 3;
const VEIL = [0, 0.35, 0.55, 0.75];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function getSetting(scope) {
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(KEY(scope))) ?? null;
  } catch {
    return null;
  }
  // v122 の写真 1 枚の設定（キーは scope）→ 奥の 1 枚として読む
  if (s?.type === 'photo' && !s.layers) s = { ...s, layers: [{ kind: 'image', fit: 'cover', legacy: true }, null, null] };
  return s;
}

export function setSetting(scope, value) {
  try {
    if (value) localStorage.setItem(KEY(scope), JSON.stringify(value));
    else localStorage.removeItem(KEY(scope));
  } catch {
    // 保存できなくても、今の表示はそのまま
  }
}

// ---- 画像・動画（IndexedDB） ----
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ouchi-share-wallpaper', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const req = fn(tx.objectStore('photos'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const urlCache = new Map(); // key → object URL
export const layerKey = (scope, i, layer) => (layer?.legacy ? scope : `${scope}:${i}`);

export async function saveMedia(key, blob) {
  await idb('readwrite', (s) => s.put(blob, key));
  if (urlCache.has(key)) URL.revokeObjectURL(urlCache.get(key));
  urlCache.delete(key);
}

export async function deleteMedia(key) {
  await idb('readwrite', (s) => s.delete(key)).catch(() => {});
  if (urlCache.has(key)) URL.revokeObjectURL(urlCache.get(key));
  urlCache.delete(key);
}

export async function mediaBlob(key) {
  return (await idb('readonly', (s) => s.get(key)).catch(() => null)) ?? null;
}

// おすそわけの一覧に出す小さな見本（画像の層を重ねて 120×160 に。動画の層は飛ばす）。季節は色だけ
export async function makeThumb(setting, scope) {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#fff8f0';
  g.fillRect(0, 0, 120, 160);
  if (setting.type === 'season') {
    const [color, emoji] = SEASONS[new Date().getMonth()];
    g.fillStyle = color;
    g.globalAlpha = 0.35;
    g.fillRect(0, 0, 120, 160);
    g.globalAlpha = 1;
    g.font = '40px serif';
    g.fillText(emoji, 38, 96);
  } else {
    for (const [i, layer] of (setting.layers ?? []).entries()) {
      if (!layer || layer.kind === 'video') continue;
      const blob = await mediaBlob(layerKey(scope, i, layer));
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = reject;
          el.src = url;
        });
        const contain = layer.fit === 'contain';
        const scale = (contain ? Math.min : Math.max)(120 / img.naturalWidth, 160 / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const hh = img.naturalHeight * scale;
        g.drawImage(img, (120 - w) / 2, contain ? 160 - hh : (160 - hh) / 2, w, hh);
      } catch {
        // 読めない画像は飛ばす
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }
  return c.toDataURL('image/jpeg', 0.7);
}

export async function mediaUrl(key) {
  if (urlCache.has(key)) return urlCache.get(key);
  const blob = await idb('readonly', (s) => s.get(key)).catch(() => null);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

// 選んだファイルを壁紙用にする → { blob, kind }。GIF・動画はそのまま、PNG・WebP は透明を残し、ほかは JPEG に縮める
export async function prepareMedia(file) {
  if (file.type.startsWith('video/')) {
    if (file.size > 40 * 1024 * 1024) throw new Error('動画が大きすぎます（40MB まで）。短く切ってから選んでください');
    return { blob: file, kind: 'video' };
  }
  if (file.type === 'image/gif') {
    if (file.size > 25 * 1024 * 1024) throw new Error('GIF が大きすぎます（25MB まで）');
    return { blob: file, kind: 'image' };
  }
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
  if (keepAlpha && file.size <= 4 * 1024 * 1024) return { blob: file, kind: 'image' }; // アニメーション PNG・WebP も動いたまま
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('画像を読み込めませんでした'));
      el.src = src;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, keepAlpha ? 'image/png' : 'image/jpeg', 0.82));
    return { blob, kind: 'image' };
  } finally {
    URL.revokeObjectURL(src);
  }
}

// ---- 季節の壁紙：奥にその月の色のグラデーション、手前に絵文字を散らした模様 ----
function seasonLayers(month = new Date().getMonth() + 1) {
  const [color, emoji] = SEASONS[month - 1];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><g font-size='26' opacity='0.5'><text x='18' y='42' transform='rotate(-12 30 32)'>${emoji}</text><text x='98' y='112' transform='rotate(14 110 102)'>${emoji}</text></g><g font-size='16' opacity='0.35'><text x='108' y='36'>${emoji}</text><text x='26' y='130'>${emoji}</text></g></svg>`;
  return [
    { css: `linear-gradient(160deg, color-mix(in srgb, ${color} 32%, var(--bg)), color-mix(in srgb, ${color} 12%, var(--bg)) 60%, color-mix(in srgb, ${color} 24%, var(--bg)))`, fit: 'cover' },
    null,
    { css: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, fit: 'pattern' },
  ];
}
export const seasonBackground = () => seasonLayers().filter(Boolean).reverse().map((l) => l.css).join(', ');

// その画面で使う設定と、その持ち主（グループの中ならグループの設定、なければ全体の設定）
export function effective(groupId) {
  const own = groupId && getSetting(`g:${groupId}`);
  return own ? { s: own, scope: `g:${groupId}` } : { s: getSetting('global') ?? { type: 'none' }, scope: 'global' };
}

// 設定 → 描く層 [{ css } | { video } | null × 3]
export async function resolveLayers(s, scope) {
  if (s.type === 'season') return seasonLayers();
  if (s.type !== 'photo') return [null, null, null];
  return Promise.all(
    [0, 1, 2].map(async (i) => {
      const layer = s.layers?.[i];
      if (!layer) return null;
      const url = await mediaUrl(layerKey(scope, i, layer));
      if (!url) return null;
      return layer.kind === 'video' ? { video: url, fit: layer.fit ?? 'cover' } : { css: `url("${url}")`, fit: layer.fit ?? 'cover' };
    }),
  );
}

// 層を container に描く（画面の壁紙と、設定の見本で共通）
export function renderLayers(container, layers, clarity) {
  container.replaceChildren(
    ...layers.map((l, i) => {
      if (!l) return null;
      let el;
      if (l.video) {
        el = document.createElement('video');
        Object.assign(el, { src: l.video, muted: true, loop: true, autoplay: !reduced(), playsInline: true, defaultMuted: true });
        el.setAttribute('muted', '');
        el.setAttribute('playsinline', '');
      } else {
        el = document.createElement('div');
        el.style.backgroundImage = l.css;
      }
      el.className = `wp-layer wp-${l.fit} wp-depth-${i}`;
      el.dataset.depth = String(i);
      return el;
    }).filter(Boolean),
    Object.assign(document.createElement('div'), { className: 'wp-veil', style: `opacity: ${VEIL[clarity ?? 2]}` }),
  );
}

// タブの位置（0〜3）に合わせて、層を横にずらす
// unit：画面は 'vw'、設定の見本は '%'（層の幅に対して）
export function shiftLayers(container, index, unit = 'vw') {
  for (const el of container.querySelectorAll('.wp-layer')) {
    const d = DEPTH[Number(el.dataset.depth)] ?? 1;
    el.style.transform = `translate3d(${-Math.min(index, MAX_TABS) * STEP_VW * d}${unit}, 0, 0)`;
  }
}

let host = null;
let parallaxIndex = 0;
function ensureHost() {
  if (!host) {
    host = document.createElement('div');
    host.id = 'wallpaper';
    host.setAttribute('aria-hidden', 'true');
    document.body.prepend(host);
  }
  return host;
}

// 着せ替え（skins.js）の壁紙。自分の壁紙（写真・季節）を設定していないときに出す
let fallback = null; // { id, layers }
export function setFallback(id, layers) {
  fallback = layers ? { id, layers } : null;
}

// 画面に壁紙を反映する（ルーターから呼ぶ）
let applySeq = 0;
let shown = '';
export async function apply(groupId) {
  const seq = ++applySeq;
  let { s, scope } = effective(groupId);
  let layers = await resolveLayers(s, scope);
  if (seq !== applySeq) return; // 読み込んでいる間に別の画面に移った
  if (!layers.some(Boolean) && fallback) {
    layers = fallback.layers;
    s = { type: 'skin', id: fallback.id, clarity: 2 };
    scope = 'skin';
  }
  const on = layers.some(Boolean);
  document.documentElement.classList.toggle('has-wallpaper', on);
  if (!on) {
    host?.replaceChildren();
    shown = '';
    return;
  }
  // 同じ壁紙なら描き直さない（動画が最初からにならないように）
  const sig = JSON.stringify([scope, s, new Date().getMonth()]);
  if (sig !== shown) {
    renderLayers(ensureHost(), layers, s.clarity);
    shown = sig;
  }
  shiftLayers(host, parallaxIndex);
}

// タブを移ったときに呼ぶ（0：カレンダー、1：イベント、2：リスト、3：日記。グループの外は 0）
export function setParallax(index) {
  parallaxIndex = index;
  if (host) shiftLayers(host, index);
}
