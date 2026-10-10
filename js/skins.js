// 公式の着せ替え（壁紙・色・アイコン・フォント・演出が 1 セット）。
// - どれを使うか（端末に保存。localStorage の ouchi-share:skin:<scope>。scope は 'global' か 'g:<グループ ID>'）
//   グループの中：自分の「このグループだけ」 → グループの公式（groups/{id}.theme。オーナー・管理者が決める） → 自分の全体の設定 → いつもの
//   グループの外：自分の全体の設定
// - 色：CSS の変数（--bg・--accent など）を、明るい画面・暗い画面それぞれで上書きする（<style id="skin-style">）
// - フォント：Google Fonts から、その着せ替えを使うときだけ読み込む（日本語は使う文字のぶんだけ届く）
// - アイコン：グループのタブ（カレンダー・イベント・リスト・日記）の絵文字
// - 演出：紙吹雪の色と、飛び散る ✨ の代わりの絵文字（fx.js）
// - 壁紙：3 枚の層（奥のグラデーション・まん中の地面・手前の模様）。自分の壁紙（写真・季節）を設定していないときに出る
// - tier（段階）：free（無料）・sub（👑 サブスクで使い放題）・buy（💎 買い切り。price 円。買えばずっと自分のもの）
//   グループで使えるのは、サブスクの人がいるとき（👑 ぜんぶ＋その人が買った 💎）。今は試作中なので、だれでも使える（canUse）
import * as fx from './fx.js';

const KEY = (scope) => `ouchi-share:skin:${scope}`;
const OFFICIAL_KEY = 'ouchi-share:skin:official'; // グループの公式の着せ替え（次に開いたときすぐ出せるよう、端末に覚えておく）
const DEFAULT_ICONS = { calendar: '📅', anniv: '🎉', events: '✈️', lists: '📝', diary: '📔', trip: '🗓' };

// 地面（まん中の層）：横にくり返す SVG。fill は着せ替えの色
const ground = (path, fill, opacity = 0.35) =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='120' viewBox='0 0 400 120' preserveAspectRatio='none'><path d='${path}' fill='${fill}' fill-opacity='${opacity}'/></svg>`;
const HILLS = 'M0 70 Q50 30 100 60 T200 55 T300 62 T400 70 V120 H0Z';
const WAVES = 'M0 60 Q25 45 50 60 T100 60 T150 60 T200 60 T250 60 T300 60 T350 60 T400 60 V120 H0Z';
const PEAKS = 'M0 90 L40 55 L70 75 L120 30 L170 80 L210 50 L260 85 L300 40 L350 75 L400 60 V120 H0Z';
const TREES = 'M0 100 L20 60 L40 100 L55 70 L75 100 L95 45 L115 100 L135 75 L150 100 L175 55 L200 100 L220 65 L240 100 L265 40 L290 100 L310 70 L330 100 L355 50 L380 100 L400 75 V120 H0Z';
const BLOCKS = 'M0 80 H40 V60 H80 V80 H120 V50 H160 V70 H200 V40 H240 V80 H280 V60 H320 V75 H360 V55 H400 V120 H0Z';
const DRIPS = 'M0 0 H400 V30 Q390 60 380 30 Q360 20 340 30 Q330 70 320 30 Q300 20 280 30 Q270 55 260 30 Q240 20 220 30 Q210 75 200 30 Q180 20 160 30 Q150 50 140 30 Q120 20 100 30 Q90 65 80 30 Q60 20 40 30 Q30 55 20 30 Q10 20 0 30Z';

export const SKINS = [
  {
    id: 'standard',
    name: 'いつもの',
    emoji: '🏠',
    desc: 'ふだんの見た目（自分の色・自分の壁紙がそのまま出ます）',
    // 見本のカードの色だけ（css/style.css の :root と同じ。画面の色は変えない）
    sample: {
      light: { bg: '#fff8f0', surface: '#ffffff', text: '#2b2622', border: '#eee3d8', accent: '#f08a4b', accentText: '#ffffff' },
      dark: { bg: '#1c1a18', surface: '#2a2724', text: '#f3ede7', border: '#3a3632', accent: '#f59a5f', accentText: '#1c1a18' },
    },
  },
  {
    id: 'sakura',
    name: 'さくら',
    emoji: '🌸',
    desc: 'やわらかいピンクと丸い文字。花びらが舞います',
    font: { family: 'Zen Maru Gothic', query: 'Zen+Maru+Gothic:wght@400;700' },
    light: { bg: '#fff5f8', surface: '#ffffff', text: '#3a2a30', muted: '#9a7f88', border: '#f6dde6', accent: '#e5739a', accentText: '#ffffff', accentSoft: '#fde0ea' },
    dark: { bg: '#221a1d', surface: '#2e2327', text: '#f7e9ee', muted: '#b39aa3', border: '#45353b', accent: '#f28db0', accentText: '#221a1d', accentSoft: '#4d2c38' },
    icons: { calendar: '🌸', anniv: '💐', events: '🎀', lists: '🍡', diary: '🎐', trip: '🗾' },
    sparkle: '🌸',
    confetti: ['#f7a8c4', '#e5739a', '#ffd6e5', '#ffffff', '#c9e7a7'],
    wallpaper: { colors: ['#f6a5c0', '#ffe3ec', '#f9c6d8'], ground: ground(HILLS, '#e5739a', 0.22), pattern: ['🌸', '💮'] },
  },
  {
    id: 'umi',
    name: 'うみ',
    emoji: '🌊',
    tier: 'sub',
    desc: '青い海と波。あわが はじけます',
    font: { family: 'M PLUS Rounded 1c', query: 'M+PLUS+Rounded+1c:wght@400;700' },
    light: { bg: '#f1f9fd', surface: '#ffffff', text: '#1f3340', muted: '#6f8794', border: '#d6ebf4', accent: '#1e96d2', accentText: '#ffffff', accentSoft: '#d4eefa' },
    dark: { bg: '#0f1d26', surface: '#182a35', text: '#e6f3fa', muted: '#8fa9b6', border: '#2a3f4b', accent: '#4cb5e8', accentText: '#0f1d26', accentSoft: '#1d3d50' },
    icons: { calendar: '🐚', anniv: '🐬', events: '⛵', lists: '🐠', diary: '🦀', trip: '🏝️' },
    sparkle: '🫧',
    confetti: ['#1e96d2', '#7fd3f7', '#ffffff', '#2fc4b2', '#ffe08a'],
    wallpaper: { colors: ['#7fd3f7', '#e3f6fd', '#4cb5e8'], ground: ground(WAVES, '#1e96d2', 0.25), pattern: ['🐟', '🫧'] },
  },
  {
    id: 'mori',
    name: 'もり',
    emoji: '🌲',
    tier: 'sub',
    desc: '森の緑と手書きふうの文字。葉っぱが舞います',
    font: { family: 'Kiwi Maru', query: 'Kiwi+Maru:wght@400;500' },
    light: { bg: '#f5f8f0', surface: '#ffffff', text: '#273322', muted: '#7a8a70', border: '#e0e9d6', accent: '#4f8a3c', accentText: '#ffffff', accentSoft: '#e0eed6' },
    dark: { bg: '#161c13', surface: '#20291c', text: '#eaf2e3', muted: '#9aab8e', border: '#33402c', accent: '#7cba62', accentText: '#161c13', accentSoft: '#2c3f24' },
    icons: { calendar: '🍀', anniv: '🌻', events: '🏕️', lists: '🍄', diary: '🐿️', trip: '🗺️' },
    sparkle: '🍃',
    confetti: ['#4f8a3c', '#9ccc65', '#e0c068', '#a0703c', '#ffffff'],
    wallpaper: { colors: ['#a5d68f', '#eef6e6', '#7cba62'], ground: ground(TREES, '#3d6e2e', 0.28), pattern: ['🌿', '🍂'] },
  },
  {
    id: 'yozora',
    name: 'よぞら',
    emoji: '🌙',
    tier: 'sub',
    desc: 'いつでも夜の色。星がきらめきます',
    font: { family: 'Yusei Magic', query: 'Yusei+Magic' },
    dark: { bg: '#141a33', surface: '#1e2547', text: '#eef0ff', muted: '#9aa2cc', border: '#2e3763', accent: '#f6c945', accentText: '#141a33', accentSoft: '#3a3a5e' },
    alwaysDark: true,
    icons: { calendar: '🌙', anniv: '🌠', events: '🚀', lists: '🪐', diary: '🔭', trip: '🛸' },
    sparkle: '⭐',
    confetti: ['#f6c945', '#ffffff', '#9aa2cc', '#b48cff', '#7fd3f7'],
    wallpaper: { colors: ['#2b3570', '#141a33', '#3b2d6b'], ground: ground(PEAKS, '#0a0e22', 0.7), pattern: ['⭐', '✨'] },
  },
  {
    id: 'retro',
    name: 'レトロゲーム',
    emoji: '👾',
    tier: 'sub',
    desc: 'ドットの文字と、なつかしいゲームの色',
    font: { family: 'DotGothic16', query: 'DotGothic16' },
    light: { bg: '#eef3df', surface: '#f9fbf1', text: '#1f2a14', muted: '#64734f', border: '#d3dcbc', accent: '#3f6b2f', accentText: '#f9fbf1', accentSoft: '#d8e6c0' },
    dark: { bg: '#141a10', surface: '#1e2618', text: '#d8ecb8', muted: '#8ea075', border: '#33402a', accent: '#9bd65b', accentText: '#141a10', accentSoft: '#2c3d1f' },
    icons: { calendar: '🕹️', anniv: '🏆', events: '🗺️', lists: '🎒', diary: '💾', trip: '🚩' },
    sparkle: '🪙',
    confetti: ['#3f6b2f', '#9bd65b', '#e8d44d', '#d94f3d', '#3b7ddd'],
    wallpaper: { colors: ['#c8dca0', '#eef3df', '#a9c77e'], ground: ground(BLOCKS, '#3f6b2f', 0.3), pattern: ['👾', '⭐'] },
  },
  {
    id: 'okashi',
    name: 'おかし',
    emoji: '🍭',
    tier: 'sub',
    desc: 'あまい色とポップな文字。おかしが飛び出します',
    font: { family: 'Hachi Maru Pop', query: 'Hachi+Maru+Pop' },
    light: { bg: '#fff8ef', surface: '#ffffff', text: '#4a2f2a', muted: '#a08078', border: '#f6e3d3', accent: '#ff6f91', accentText: '#ffffff', accentSoft: '#ffe0e8' },
    dark: { bg: '#241a18', surface: '#302421', text: '#fbeee8', muted: '#b9a19a', border: '#4a3631', accent: '#ff8fab', accentText: '#241a18', accentSoft: '#52303a' },
    icons: { calendar: '🍰', anniv: '🎂', events: '🍭', lists: '🍪', diary: '🧁', trip: '🍦' },
    sparkle: '🍬',
    confetti: ['#ff6f91', '#ffc75f', '#8fd6c4', '#b48cff', '#ffffff'],
    wallpaper: { colors: ['#ffc2d1', '#fff8ef', '#bfe8dc'], ground: ground(DRIPS, '#ff8fab', 0.3), pattern: ['🍬', '🍩'], groundTop: true },
  },
];

export const byId = (id) => SKINS.find((s) => s.id === id) ?? null;

// ---- 段階と課金（docs/design.md の「有料プランの方針」） ----
export const TIERS = {
  free: { badge: '', label: '無料' },
  sub: { badge: '👑', label: 'サブスク' },
  buy: { badge: '💎', label: '買い切り' },
};
export const tierOf = (skin) => skin?.tier ?? 'free';
export const tierLabel = (skin) => (tierOf(skin) === 'buy' ? `💎 ${(skin.price ?? 0).toLocaleString()}円` : TIERS[tierOf(skin)].badge);

// 課金を入れるまでは試作として、だれでもぜんぶ使える
const TRIAL = true;

// 自分が持っているか。me：{ sub: サブスク中か, owned: 買った 💎 の id の配列 }（Worker がレシートを確かめて書く予定）
function mine(skin, me) {
  const t = tierOf(skin);
  if (t === 'free') return true;
  if (t === 'sub') return !!me?.sub;
  return !!me?.owned?.includes(skin.id);
}

// グループで使えるか。group.premium：{ subs: サブスク中のメンバーの uid の配列, owned: { 💎 の id: 買った人の uid の配列 } }
//   サブスクの人がいれば 👑 はぜんぶ。💎 は「サブスク中で、かつ買った人」がいるとき
function shared(skin, group) {
  const p = group?.premium;
  const subs = p?.subs ?? [];
  const t = tierOf(skin);
  if (t === 'free') return true;
  if (t === 'sub') return subs.length > 0;
  return (p?.owned?.[skin.id] ?? []).some((uid) => subs.includes(uid));
}

// 使えるか：自分の全体の設定は自分が持っているものだけ。グループの中では、グループにシェアされたものも。
//   グループの公式（official）は、グループにシェアされたものだけ
export function canUse(skin, { group = null, me = null, official = false } = {}) {
  if (TRIAL) return true;
  if (official) return shared(skin, group);
  return mine(skin, me) || (!!group && shared(skin, group));
}

// ---- 設定（端末に保存） ----
export function getChoice(scope) {
  try {
    return localStorage.getItem(KEY(scope)) || null;
  } catch {
    return null;
  }
}

export function setChoice(scope, id) {
  try {
    if (id) localStorage.setItem(KEY(scope), id);
    else localStorage.removeItem(KEY(scope));
  } catch {
    // 保存できなくても、今の表示はそのまま
  }
}

function officialMap() {
  try {
    return JSON.parse(localStorage.getItem(OFFICIAL_KEY)) ?? {};
  } catch {
    return {};
  }
}

export const official = (groupId) => (groupId && officialMap()[groupId]) || null;

// グループを読み込んだときに呼ぶ。変わったら true
export function setOfficial(groupId, id) {
  const map = officialMap();
  if ((map[groupId] || null) === (id || null)) return false;
  if (id) map[groupId] = id;
  else delete map[groupId];
  try {
    localStorage.setItem(OFFICIAL_KEY, JSON.stringify(map));
  } catch {
    // 覚えられなくても、今の表示は変える
  }
  return true;
}

// その画面で使う着せ替えと、どこで決まったか（'group'：自分のこのグループだけ、'official'：グループの公式、'global'：自分の全体）
export function resolve(groupId) {
  const mine = groupId && getChoice(`g:${groupId}`);
  if (mine && byId(mine)) return { skin: byId(mine), from: 'group' };
  const off = official(groupId);
  if (off && byId(off)) return { skin: byId(off), from: 'official' };
  return { skin: byId(getChoice('global')) ?? SKINS[0], from: 'global' };
}

// ---- 画面に反映する ----
let current = SKINS[0];
export const active = () => current;
export const hasColors = () => !!(current.light || current.dark);
export const icon = (name) => current.icons?.[name] ?? DEFAULT_ICONS[name];

const loadedFonts = new Set();
export function loadFont(skin) {
  if (!skin?.font || loadedFonts.has(skin.id)) return;
  loadedFonts.add(skin.id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${skin.font.query}&display=swap`;
  document.head.append(link);
}

const vars = (c) =>
  `--bg:${c.bg};--surface:${c.surface};--text:${c.text};--muted:${c.muted};--border:${c.border};--accent:${c.accent};--accent-text:${c.accentText};--accent-soft:${c.accentSoft};`;

function css(skin) {
  if (skin.id === 'standard') return '';
  const sel = `:root[data-skin="${skin.id}"]`;
  const font = skin.font ? `${sel} body,${sel} button,${sel} input,${sel} textarea,${sel} select{font-family:'${skin.font.family}',-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;}` : '';
  if (skin.alwaysDark) return `${sel}{${vars(skin.dark)}color-scheme:dark;}${font}`;
  return `${sel}{${vars(skin.light)}}@media (prefers-color-scheme: dark){${sel}{${vars(skin.dark)}}}${font}`;
}

// 着せ替えの壁紙（自分の壁紙がないときに出す）。wallpaper.js の層の形 [{ css, fit } | null × 3]
export function wallpaperLayers(skin) {
  const w = skin?.wallpaper;
  if (!w) return null;
  const [a, b, c] = w.colors;
  const mix = (col, p) => `color-mix(in srgb, ${col} ${p}%, var(--bg))`;
  const [e1, e2] = w.pattern;
  const pattern = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><g font-size='24' opacity='0.45'><text x='18' y='42' transform='rotate(-12 30 32)'>${e1}</text><text x='98' y='112' transform='rotate(14 110 102)'>${e2}</text></g><g font-size='14' opacity='0.35'><text x='108' y='36'>${e2}</text><text x='26' y='130'>${e1}</text></g></svg>`;
  return [
    { css: `linear-gradient(170deg, ${mix(a, 40)}, ${mix(b, 30)} 55%, ${mix(c, 38)})`, fit: 'cover' },
    { css: `url("data:image/svg+xml,${encodeURIComponent(w.ground)}")`, fit: w.groundTop ? 'ceiling' : 'ground' },
    { css: `url("data:image/svg+xml,${encodeURIComponent(pattern)}")`, fit: 'pattern' },
  ];
}

// 着せ替えを画面に反映する（色・フォント・演出）。アイコンと壁紙は、呼んだ側が描き直す
export function apply(skin) {
  current = skin ?? SKINS[0];
  const root = document.documentElement;
  let style = document.getElementById('skin-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'skin-style';
    document.head.append(style);
  }
  const text = css(current);
  if (style.textContent !== text) style.textContent = text;
  if (current.id === 'standard') delete root.dataset.skin;
  else root.dataset.skin = current.id;
  loadFont(current);
  fx.setSkin({ confetti: current.confetti ?? null, sparkle: current.sparkle ?? null });
  // ブラウザの上の帯の色
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    if (!m.dataset.base) m.dataset.base = m.content;
    const dark = m.media.includes('dark');
    const c = current.alwaysDark ? current.dark : dark ? current.dark : current.light;
    m.content = c?.bg ?? m.dataset.base;
  }
}
