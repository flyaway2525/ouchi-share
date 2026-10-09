// アクセスの計測（GA4 = Google Analytics for Firebase）。
// - ブラウザ版・ホーム画面版だけ送る。アプリ版（Capacitor）は Web の計測がうまく動かないので、専用のプラグインを入れるまで送らない
// - 手元の開発（localhost など）では送らない（自分のテストで数字が増えないように）。localStorage の ouchi-share:gaDebug を true にすると送る（DebugView で確かめる用）
// - 送るのは画面の種類（「group/list」など）と、アプリの形（browser / home_screen）だけ。グループ ID やユーザー ID は送らない
// - 計測の部品は、最初の画面が出てからあとで読み込む（起動を遅くしない）
// 測定 ID は firebaseConfig に書かなくても、Firebase のプロジェクトで Google Analytics を有効にしていれば自動で取ってくる
import { app, isNativeApp } from './firebase.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js';
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');
const debug = (() => {
  try {
    return localStorage.getItem('ouchi-share:gaDebug') === 'true';
  } catch {
    return false;
  }
})();
const enabled = !isNativeApp && (!isLocal || debug);
const appForm = () => (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true ? 'home_screen' : 'browser');

let ready = null;
function load() {
  if (!enabled) return Promise.resolve(null);
  ready ??= import(SDK)
    .then(async (m) => {
      if (!(await m.isSupported())) return null;
      // 自動の page_view は送らない（URL の # にグループ ID が入るので）。画面の種類だけを自分で送る
      const a = m.initializeAnalytics(app, { config: { send_page_view: false, ...(debug ? { debug_mode: true } : {}) } });
      m.setUserProperties(a, { app_form: appForm() });
      return { a, m };
    })
    .catch((e) => {
      console.warn('アクセスの計測を始められませんでした', e);
      return null;
    });
  return ready;
}

// URL の # から、ID を除いた画面の種類を作る（#/g/abc/l/def → group/list）
export function screenName(hash) {
  const path = hash.replace(/^#\/?/, '');
  if (!path) return 'home';
  return path
    .replace(/^join\/.*/, 'join')
    .replace(/^recover(\/.*)?$/, 'recover')
    .replace(/^g\/[^/]+/, 'group')
    .replace(/\/l\/[^/]+/, '/list')
    .replace(/\/e\/[^/]+/, '/event')
    .replace(/\/d\/[\d-]+/, '/day')
    .replace(/\/m\/[^/]+/, '/member');
}

// 画面を開いた（ルーターから呼ぶ）
let lastScreen = null;
export function logScreen(hash) {
  const name = screenName(hash);
  if (name === lastScreen) return;
  lastScreen = name;
  load().then((x) => {
    if (!x) return;
    x.m.logEvent(x.a, 'page_view', { page_title: name, page_location: `${location.origin}${location.pathname}#/${name}`, page_path: `/${name}` });
    x.m.logEvent(x.a, 'screen_view', { firebase_screen: name, screen_name: name });
  });
}

// そのほかの出来事（例：logEvent('add_plan')）。params に個人の情報や ID を入れない
export function logEvent(name, params = {}) {
  load().then((x) => x?.m.logEvent(x.a, name, params));
}
