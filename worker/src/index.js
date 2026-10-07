// ouchi-share の通知を送る Cloudflare Workers（無料プランで動かす）。
//
// POST /  … アプリから「このグループに通知して」と頼まれる
//   Authorization: Bearer <Firebase のログイン トークン（ID トークン）>
//   body: { groupId, kind: 'news' | 'plan' | 'reward'（ごほうびの交換） | 'appnews', title, body, url, participants }
//   - 頼んだ人がそのグループのメンバーか（appnews は管理者か）を確かめてから送る
//   - 送り先はグループのメンバー（participants があればその人たち）から、頼んだ本人を除いた人
//   - 各自の push/{uid}.prefs で、受け取らない種類にしている人には送らない
// POST /preview … リンクのタイトルと画像を取ってくる（行きたいところ・欲しいもの等の登録画面で使う）
//   Authorization: Bearer <ID トークン>、body: { groupId, url }
//   - グループのメンバーだけが使える（誰でも使える中継にしない）
//   - TikTok / YouTube は公式の oEmbed、ほかはページの og:title / og:image を読む
//   - 画像のアドレスは期限切れになることがあるので、画像そのものを data URL で返す（アプリ側で縮小して保存）
//   → { title, site, image: 'data:image/...' | null }
// 毎日の定期実行（wrangler.toml の crons）… 翌日の予定・イベントのリマインドを送る
//
// 必要な秘密の値（wrangler secret put で登録。リポジトリには入れない）：
//   FIREBASE_SERVICE_ACCOUNT … Firebase のサービスアカウントキー（JSON をそのまま）

const PROJECT_ID = 'ouchi-share';
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const ALLOWED_ORIGINS = ['https://flyaway2525.github.io', 'http://localhost:5173', 'capacitor://localhost', 'ionic://localhost'];
const PREF_FOR_KIND = { news: 'news', appnews: 'news', plan: 'plans', reward: 'news', reminder: 'reminders', test: null };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);
    try {
      const sender = await verifyIdToken((request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''));
      if (new URL(request.url).pathname === '/preview') {
        if (!rateLimit(`preview:${sender}`, 30)) return json({ error: 'too-many' }, 429, cors);
        const req = await request.json();
        const token = await accessToken(env);
        const group = await getDoc(token, `groups/${String(req.groupId ?? '')}`);
        if (!(group?.memberIds ?? []).includes(sender)) throw fail(403, 'not-member');
        return json(await linkPreview(String(req.url ?? '')), 200, cors);
      }
      if (!rateLimit(sender)) return json({ error: 'too-many' }, 429, cors);
      const req = await request.json();
      const sent = await handleNotify(env, sender, req);
      return json({ ok: true, sent }, 200, cors);
    } catch (e) {
      const status = e.status ?? 500;
      if (status === 500) console.error(e);
      return json({ error: e.message }, status, cors);
    }
  },

  // 毎日（夜 8 時ごろ）：翌日の予定・イベントのリマインド
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

// ---- 送りすぎの上限（1 人 1 分に 10 回まで。Workers のインスタンスごとの目安） ----
const recent = new Map();
function rateLimit(uid, max = 10) {
  const now = Date.now();
  const list = (recent.get(uid) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= max) return false;
  list.push(now);
  recent.set(uid, list);
  return true;
}

// ---- 頼まれた通知を送る ----
async function handleNotify(env, sender, req) {
  const kind = String(req.kind ?? '');
  if (!(kind in PREF_FOR_KIND) || kind === 'reminder') throw fail(400, 'kind');
  const title = String(req.title ?? '').slice(0, 100) || 'ouchi-share';
  const body = String(req.body ?? '').slice(0, 300);
  const url = /^#\/[\w/-]*$/.test(req.url ?? '') ? req.url : '#/';
  const token = await accessToken(env);

  // テスト通知：頼んだ本人の端末にだけ送る（受け取る種類の設定は見ない）
  if (kind === 'test') return sendToUsers(token, [sender], null, { title: '🔔 テスト通知', body: 'ouchi-share の通知が届きました', url: '#/' });

  let recipients;
  if (kind === 'appnews') {
    // アプリからのお知らせ：管理者だけが、全員に送れる
    if (!(await getDoc(token, `admins/${sender}`))) throw fail(403, 'not-admin');
    recipients = (await listDocs(token, 'push')).map((d) => d.id);
  } else {
    const group = await getDoc(token, `groups/${String(req.groupId ?? '')}`);
    const members = group?.memberIds ?? [];
    if (!members.includes(sender)) throw fail(403, 'not-member');
    const wanted = Array.isArray(req.participants) ? req.participants.filter((u) => members.includes(u)) : [];
    recipients = wanted.length ? wanted : members;
  }
  recipients = recipients.filter((u) => u !== sender);
  // tag は付けない（同じ tag だと前の通知が置き換わって見落とすため。リマインドだけ 1 日 1 通にまとめる）
  return sendToUsers(token, recipients, PREF_FOR_KIND[kind], { title, body, url });
}

// 各自の push/{uid} を見て、受け取る設定の人の全端末に送る。無効になったトークンは消す
async function sendToUsers(token, uids, prefKey, message) {
  let sent = 0;
  for (const uid of [...new Set(uids)]) {
    const push = await getDoc(token, `push/${uid}`);
    if (!push || (prefKey && push.prefs?.[prefKey] === false)) continue;
    for (const [id, t] of Object.entries(push.tokens ?? {})) {
      const res = await sendFcm(token, t.token, message);
      if (res === 'ok') sent++;
      else if (res === 'gone') await removeToken(token, uid, id);
    }
  }
  return sent;
}

async function sendFcm(token, deviceToken, { title, body, url, tag }) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        // データだけで送り、表示はアプリの Service Worker（sw.js）が行う（FCM の data は文字列だけ）
        data: { title, body, url, ...(tag ? { tag } : {}) },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } },
        // iPhone アプリ版（APNs）向け：通知として表示する
        apns: { payload: { aps: { alert: { title, body }, sound: 'default' } } },
      },
    }),
  });
  if (res.ok) return 'ok';
  const text = await res.text();
  if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(text)) return 'gone';
  console.warn('FCM error', res.status, text.slice(0, 300));
  return 'error';
}

async function removeToken(token, uid, id) {
  // tokens.<id> だけを消す（updateMask に指定して、値を入れずに送る）
  const mask = encodeURIComponent(`tokens.\`${id}\``);
  await fetch(`${FIRESTORE}/push/${uid}?updateMask.fieldPaths=${mask}&currentDocument.exists=true`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {} }),
  }).catch(() => {});
}

// ---- リンクのタイトルと画像 ----
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_HTML = 1_500_000;
const MAX_IMAGE = 4_000_000;

async function linkPreview(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw fail(400, 'url');
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || isLocalHost(url.hostname)) throw fail(400, 'url');
  const headers = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ja,en;q=0.8' };
  let title = '';
  let site = '';
  let image = '';

  // TikTok の短縮リンク（vt.tiktok.com など）は、先に本来のアドレスにする
  if (/^(vt|vm)\.tiktok\.com$/.test(url.hostname)) {
    const res = await fetch(url.href, { headers, redirect: 'follow' }).catch(() => null);
    if (res?.url) url = new URL(res.url);
    res?.body?.cancel();
  }
  const host = url.hostname.replace(/^www\./, '');
  const oembed = /(^|\.)tiktok\.com$/.test(host)
    ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url.href)}`
    : /(^|\.)(youtube\.com|youtu\.be)$/.test(host)
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`
      : null;
  if (oembed) {
    try {
      const res = await fetch(oembed, { headers });
      if (res.ok) {
        const d = await res.json();
        title = d.title ?? '';
        site = d.author_name ?? d.provider_name ?? '';
        image = d.thumbnail_url ?? '';
      }
    } catch {
      // ページから読むほうに任せる
    }
  }
  if (!title || !image) {
    try {
      const res = await fetch(url.href, { headers: { ...headers, Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' });
      if (res.ok && /html/i.test(res.headers.get('Content-Type') ?? '')) {
        const html = new TextDecoder().decode(await readLimited(res, MAX_HTML));
        const meta = parseMeta(html);
        title ||= meta['og:title'] || meta['twitter:title'] || meta.title || '';
        site ||= meta['og:site_name'] || '';
        const img = meta['og:image'] || meta['og:image:url'] || meta['og:image:secure_url'] || meta['twitter:image'] || meta['twitter:image:src'];
        if (!image && img) image = new URL(decodeEntities(img), res.url || url.href).href;
      } else {
        res.body?.cancel();
      }
    } catch {
      // 読めなければ取れたぶんだけ返す
    }
  }

  let imageData = null;
  if (/^https?:\/\//.test(image)) {
    try {
      const res = await fetch(image, { headers });
      const type = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
      if (res.ok && /^image\/(jpeg|png|webp|gif|avif)$/.test(type)) {
        const bytes = await readLimited(res, MAX_IMAGE);
        if (bytes.length < MAX_IMAGE) imageData = `data:${type};base64,${toBase64(bytes)}`;
      } else {
        res.body?.cancel();
      }
    } catch {
      // 画像なし
    }
  }
  const clean = (t, n) => decodeEntities(String(t)).replace(/\s+/g, ' ').trim().slice(0, n);
  // サイト共通の決まり文句（ログイン画面など）はタイトルとして使わない
  if (/^(TikTok - Make Your Day|TikTok|Instagram|X|Twitter|Amazon\.co\.jp|Amazon\.com|ログイン.*|Log ?in.*)$/i.test(clean(title, 300))) title = '';
  return { title: clean(title, 300), site: clean(site, 100), image: imageData };
}

function isLocalHost(hostname) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)|\.(local|internal|localhost)$/i.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

// 本文を上限まで読む（大きいページや画像で止まらないように）
async function readLimited(res, max) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - at);
    out.set(part, at);
    at += part.length;
    if (at >= out.length) break;
  }
  return out;
}

// <meta property|name="..." content="..."> と <title> を拾う
function parseMeta(html) {
  const meta = {};
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const attr = (name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    const key = attr('property') ?? attr('name');
    const content = attr('content');
    if (!key || !content) continue;
    const k = (key[2] ?? key[3] ?? key[4]).toLowerCase();
    if (!(k in meta)) meta[k] = content[2] ?? content[3] ?? content[4];
  }
  const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (t) meta.title = t[1];
  return meta;
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---- 翌日のリマインド ----
async function sendReminders(env) {
  const token = await accessToken(env);
  // 日本時間の「明日」
  const now = new Date(Date.now() + 9 * 3600_000);
  now.setUTCDate(now.getUTCDate() + 1);
  const tomorrow = now.toISOString().slice(0, 10);
  const label = `${now.getUTCMonth() + 1}/${now.getUTCDate()}`;

  for (const g of await listDocs(token, 'groups')) {
    const members = g.memberIds ?? [];
    const plans = await queryEq(token, `groups/${g.id}`, 'plans', 'date', tomorrow);
    const events = await queryEq(token, `groups/${g.id}`, 'events', 'startDate', tomorrow);
    // 人ごとにまとめて 1 通にする
    const perUser = new Map();
    const add = (participants, line) => {
      const who = participants?.length ? participants.filter((u) => members.includes(u)) : members;
      for (const u of who) perUser.set(u, [...(perUser.get(u) ?? []), line]);
    };
    for (const p of plans) add(p.participants, `${p.start ? `${p.start} ` : ''}${p.title}${p.endDate ? `（〜${Number(p.endDate.slice(5, 7))}/${Number(p.endDate.slice(8))}）` : ''}`);
    for (const e of events) add(e.participants, `${e.emoji ?? ''} ${e.title}（イベント開始）`);
    for (const [uid, lines] of perUser) {
      await sendToUsers(token, [uid], 'reminders', {
        title: `⏰ 明日（${label}）の予定・${g.name}`,
        body: lines.slice(0, 5).join('\n') + (lines.length > 5 ? `\nほか${lines.length - 5}件` : ''),
        url: `#/g/${g.id}`,
        tag: `reminder-${g.id}-${tomorrow}`,
      });
    }
  }
}

// ---- Firestore REST（サービスアカウントで読む） ----

async function getDoc(token, path) {
  const res = await fetch(`${FIRESTORE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore get ${res.status}`);
  return decodeDoc(await res.json());
}

async function listDocs(token, collection) {
  const out = [];
  let pageToken = '';
  do {
    const res = await fetch(`${FIRESTORE}/${collection}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`firestore list ${res.status}`);
    const data = await res.json();
    out.push(...(data.documents ?? []).map(decodeDoc));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

async function queryEq(token, parent, collectionId, field, value) {
  const res = await fetch(`${FIRESTORE}/${parent}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`firestore query ${res.status}`);
  return (await res.json()).filter((r) => r.document).map((r) => decodeDoc(r.document));
}

function decodeDoc(d) {
  return { id: d.name.split('/').pop(), ...decodeFields(d.fields ?? {}) };
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}

function decodeValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {});
  return null;
}

// ---- Google のアクセストークン（サービスアカウントの鍵で署名して取得。1 時間ほど使い回す） ----

let cachedToken = null;
async function accessToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const data = await res.json();
  cachedToken = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function signJwt(header, payload, pem) {
  const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const data = `${enc(header)}.${enc(payload)}`;
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- Firebase の ID トークンの確認（Google の公開鍵で署名を確かめる） ----

let cachedJwks = null;
async function verifyIdToken(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw fail(401, 'no-token');
  let header;
  let payload;
  let sig;
  try {
    const bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    header = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
    sig = bytes(parts[2]);
  } catch {
    throw fail(401, 'bad-token');
  }
  if (!cachedJwks || cachedJwks.exp < Date.now()) {
    const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    cachedJwks = { keys: (await res.json()).keys, exp: Date.now() + 3600_000 };
  }
  const jwk = cachedJwks.keys.find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw fail(401, 'bad-token');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || payload.aud !== PROJECT_ID || payload.iss !== `https://securetoken.google.com/${PROJECT_ID}` || payload.exp < now || !payload.sub) {
    throw fail(401, 'bad-token');
  }
  return payload.sub;
}
