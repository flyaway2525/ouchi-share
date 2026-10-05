// オフラインでも開けるようにするための Service Worker。
// ネットワーク優先で、つながらないときだけキャッシュを使う
// （開発中に古いファイルが表示され続けるのを避けるため）。

const CACHE = 'ouchi-share-v22';
const SHELL = ['./', './index.html', './css/style.css', './js/app.js', './js/store.js', './js/ui.js', './js/auth.js', './js/firebase.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Firebase SDK・QR ライブラリはバージョン付き URL で中身が変わらないので、キャッシュ優先で OK
  const versionedLib =
    (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) ||
    (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/qrcode-generator@'));
  if (versionedLib) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          }),
      ),
    );
    return;
  }
  if (url.origin !== location.origin) return;
  // ブラウザの HTTP キャッシュ（GitHub Pages は 10 分）を使わず、毎回サーバーに最新か確かめる。
  // 古い ui.js と新しい app.js が混ざって読み込まれるのを防ぐため
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
