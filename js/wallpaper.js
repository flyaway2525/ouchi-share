// 壁紙（自分の画面だけ）。全体の設定と、グループごとの設定（このグループだけ別の壁紙）がある。
// - 設定は端末に保存（localStorage の ouchi-share:wallpaper:<scope>。scope は 'global' か 'g:<グループ ID>'）
//   { type: 'none' | 'season' | 'photo', clarity: 1 | 2 | 3 }。グループの設定がなければ全体の設定を使う
// - 写真は縮小して、この端末の中（IndexedDB）にだけ保存する。Firebase には送らない（通信・費用なし）。
//   別のスマホや、Safari とホーム画面版では、それぞれで設定が要る
// - 季節の壁紙は、その月の色と絵文字（カレンダーの季節と同じ）で模様を描く（SVG。画像ファイルなし）
// - clarity（見やすさ）：壁紙の上にかける膜の濃さ。1 うすい（壁紙がよく見える）〜 3 こい（文字が読みやすい）

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

export function getSetting(scope) {
  try {
    return JSON.parse(localStorage.getItem(KEY(scope))) ?? null;
  } catch {
    return null;
  }
}

export function setSetting(scope, value) {
  try {
    if (value) localStorage.setItem(KEY(scope), JSON.stringify(value));
    else localStorage.removeItem(KEY(scope));
  } catch {
    // 保存できなくても、今の表示はそのまま
  }
}

// ---- 写真（IndexedDB） ----
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

const urlCache = new Map(); // scope → object URL

export async function savePhoto(scope, blob) {
  await idb('readwrite', (s) => s.put(blob, scope));
  if (urlCache.has(scope)) URL.revokeObjectURL(urlCache.get(scope));
  urlCache.delete(scope);
}

export async function deletePhoto(scope) {
  await idb('readwrite', (s) => s.delete(scope)).catch(() => {});
  if (urlCache.has(scope)) URL.revokeObjectURL(urlCache.get(scope));
  urlCache.delete(scope);
}

export async function photoUrl(scope) {
  if (urlCache.has(scope)) return urlCache.get(scope);
  const blob = await idb('readonly', (s) => s.get(scope)).catch(() => null);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(scope, url);
  return url;
}

// 写真を壁紙の大きさ（長い辺 1600px）の JPEG にする
export async function resizeForWallpaper(file) {
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
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } finally {
    URL.revokeObjectURL(src);
  }
}

// ---- 季節の壁紙（その月の色のグラデーションに、絵文字を散らした模様） ----
export function seasonBackground(month = new Date().getMonth() + 1) {
  const [color, emoji] = SEASONS[month - 1];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><g font-size='26' opacity='0.5'><text x='18' y='42' transform='rotate(-12 30 32)'>${emoji}</text><text x='98' y='112' transform='rotate(14 110 102)'>${emoji}</text></g><g font-size='16' opacity='0.35'><text x='108' y='36'>${emoji}</text><text x='26' y='130'>${emoji}</text></g></svg>`;
  const pattern = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return `${pattern}, linear-gradient(160deg, color-mix(in srgb, ${color} 32%, var(--bg)), color-mix(in srgb, ${color} 12%, var(--bg)) 60%, color-mix(in srgb, ${color} 24%, var(--bg)))`;
}

// その画面で使う設定（グループの中ならグループの設定、なければ全体の設定）
export function effectiveSetting(groupId) {
  return (groupId && getSetting(`g:${groupId}`)) || getSetting('global') || { type: 'none' };
}

// 画面に壁紙を反映する（ルーターから呼ぶ）
let applySeq = 0;
export async function apply(groupId) {
  const seq = ++applySeq;
  const s = effectiveSetting(groupId);
  const scope = groupId && getSetting(`g:${groupId}`) ? `g:${groupId}` : 'global';
  let bg = null;
  if (s.type === 'season') bg = seasonBackground();
  else if (s.type === 'photo') {
    const url = await photoUrl(scope);
    if (url) bg = `url("${url}")`;
  }
  if (seq !== applySeq) return; // 読み込んでいる間に別の画面に移った
  const root = document.documentElement;
  root.classList.toggle('has-wallpaper', !!bg);
  root.classList.toggle('wallpaper-photo', s.type === 'photo' && !!bg);
  if (bg) {
    root.style.setProperty('--wallpaper', bg);
    root.style.setProperty('--wallpaper-veil', String([0, 0.35, 0.55, 0.75][s.clarity ?? 2]));
  } else {
    root.style.removeProperty('--wallpaper');
  }
}
