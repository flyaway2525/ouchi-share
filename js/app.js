import * as store from './store.js';
import * as auth from './auth.js';
import { h, setChildren, header, progressBar, actionSheet, confirmSheet, askText, openSheet, toast, qrCode } from './ui.js';

const app = document.getElementById('app');
const LIST_EMOJIS = ['📝', '🧳', '🧻', '🧊', '🛒', '💊', '🎒', '🏕️', '🎁', '🐶'];
const EVENT_EMOJIS = ['✈️', '🏕️', '🚗', '🏖️', '♨️', '🎿', '🎂', '🎉', '👶', '📅'];

let user; // undefined = 確認中, null = 未ログイン
let isAdmin = false;
let unwatchAdmin = null;
// ログイン処理の途中（名前の設定など）で画面が切り替わらないようにする
let authBusy = false;

// この端末だけの表示設定（折りたたみ・最後に開いたタブなど）。保存できない環境でも動くようにする
const prefs = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(`ouchi-share:${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`ouchi-share:${key}`, JSON.stringify(value));
    } catch {
      // 保存できなくても表示はそのまま
    }
  },
};

// ---- お知らせ ----
// アプリからのお知らせ（key "app:ID"）とグループのお知らせ（key "g:GID:ID"）を、届いた順にポップアップで 1 件ずつ出す。
// 「既読にする」で reads に記録（二度と出ない）。「あとで見る」はこの起動中だけ出さない（次に開いたときにまた出る）。
// 自分が書いたお知らせは既読あつかい。

let newsReads = null; // 既読マップ（読み込むまでは null。null の間はポップアップを出さない）
const newsSources = new Map(); // 'app' / 'g:GID' → お知らせの配列
const newsListeners = new Set(); // 既読が変わったら描き直したい画面
const snoozedNews = new Set();
const newsQueue = [];
let newsShowing = null;
let unwatchReads = null;
let unwatchAppNews = null;

// 再アナウンスされたお知らせは、そのあとに読んでいなければ未読（再アナウンスした本人は既読あつかい）
function isNewsRead(n) {
  if (n.announcedAt) return (newsReads?.[n.key] ?? 0) >= n.announcedAt || n.announcedBy === user?.uid;
  return !!newsReads?.[n.key] || n.createdBy === user?.uid;
}

// 並べる時刻（再アナウンスしたらその時刻）と、「あとで見る」の記録の鍵（再アナウンスされたらまた出す）
const newsTime = (n) => n.announcedAt ?? n.createdAt ?? 0;
const snoozeKey = (n) => `${n.key}@${n.announcedAt ?? 0}`;

function unreadNewsCount(sourceId) {
  return (newsSources.get(sourceId) ?? []).filter((n) => !isNewsRead(n)).length;
}

function setNewsSource(sourceId, items) {
  newsSources.set(sourceId, items);
  checkNews();
}

function clearNewsSource(sourceId) {
  newsSources.delete(sourceId);
  for (let i = newsQueue.length - 1; i >= 0; i--) if (newsQueue[i].sourceId === sourceId) newsQueue.splice(i, 1);
}

function checkNews() {
  // 読み込み前・ログイン処理中・名前の入力前は出さない
  if (!newsReads || !user || authBusy || auth.needsName()) return;
  const all = [...newsSources.values()].flat().sort((a, b) => newsTime(a) - newsTime(b));
  for (const n of all) {
    if (isNewsRead(n) || snoozedNews.has(snoozeKey(n)) || newsShowing === n.key || newsQueue.some((q) => q.key === n.key)) continue;
    newsQueue.push(n);
  }
  pumpNews();
}

async function pumpNews() {
  if (newsShowing) return;
  const n = newsQueue.shift();
  if (!n) return;
  if (isNewsRead(n) || snoozedNews.has(snoozeKey(n))) return pumpNews();
  newsShowing = n.key;
  const res = await newsPopup(n, newsQueue.length);
  if (res === 'read') store.markRead(n.key).catch(showError);
  else snoozedNews.add(snoozeKey(n));
  newsShowing = null;
  pumpNews();
}

function fmtDateTime(ms) {
  const d = new Date(ms ?? 0);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// お知らせのポップアップ。戻り値 'read'（既読にする）/ それ以外（あとで見る・閉じる）
function newsPopup(n, remaining = 0) {
  const read = isNewsRead(n);
  return openSheet((close) => [
    h('div', { class: 'sheet-title' }, `📢 ${n.sourceName}からのお知らせ${remaining > 0 ? `（ほかに${remaining}件）` : ''}`),
    h(
      'div',
      { class: 'news-card' },
      h('h2', { class: 'news-title' }, n.title),
      h('p', { class: 'news-meta' }, `${n.createdByName ?? ''} ・ ${fmtDateTime(n.createdAt)}`),
      n.announcedAt && h('p', { class: 'news-meta' }, `🔁 再アナウンス ${n.announcedByName ?? ''} ・ ${fmtDateTime(n.announcedAt)}`),
      n.body && h('p', { class: 'news-body' }, n.body),
    ),
    !read && h('button', { class: 'sheet-action', onClick: () => close('read') }, '✓ 既読にする'),
    h('button', { class: 'sheet-action cancel', onClick: () => close('later') }, read ? '閉じる' : 'あとで見る'),
  ]);
}

function newsSheet() {
  return openSheet((close) => {
    const title = h('input', { class: 'text-input', placeholder: 'タイトル（例：今週末は大掃除します）', maxlength: 100, 'aria-label': 'タイトル' });
    const body = h('textarea', { class: 'text-input memo-input news-input', placeholder: '内容', maxlength: 2000, rows: 5, 'aria-label': '内容' });
    return [
      h('div', { class: 'sheet-title' }, 'お知らせを書く'),
      h(
        'form',
        {
          class: 'sheet-form',
          onSubmit: (e) => {
            e.preventDefault();
            const t = title.value.trim();
            if (!t) return title.focus();
            close({ title: t, body: body.value.trim() });
          },
        },
        title,
        body,
        h(
          'div',
          { class: 'sheet-buttons' },
          h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn primary' }, '送る'),
        ),
      ),
    ];
  });
}

// ---- 通知の設定 ----
// 通知のコード（Firebase Messaging）は使うときだけ読み込む（対応していないブラウザで余計な読み込みをしない）
const loadPush = () => import('./push.js');

// お知らせ・予定を追加したときに、Cloudflare Workers に通知を頼む（失敗しても何もしない）
function requestNotify(params) {
  loadPush()
    .then((push) => push.notify(params))
    .catch(() => {});
}

async function pushSettingsSheet() {
  let push;
  let status;
  try {
    push = await loadPush();
    status = await push.pushStatus();
  } catch {
    status = { state: 'unsupported' };
  }
  const prefs = push && ['on', 'off'].includes(status.state) ? await push.getPushPrefs() : null;
  const messages = {
    'not-ready': '通知は準備中です（通知を送る仕組みの設定がまだ終わっていません）。',
    'ios-home-screen': 'iPhone では、Safari の共有ボタン（□↑）→「ホーム画面に追加」で追加したアプリから開くと、通知をオンにできます。',
    unsupported: 'このブラウザでは通知を受け取れません。',
    denied: '通知がブロックされています。端末の「設定」で、このアプリ（またはブラウザ）の通知を許可してください。',
    off: 'この端末では、まだ通知を受け取っていません。',
    on: '🔔 この端末で通知を受け取ります。',
  };
  const pref = (key, label) => {
    const box = h('input', {
      type: 'checkbox',
      checked: !!prefs[key],
      onChange: () => {
        prefs[key] = box.checked;
        push.setPushPrefs(prefs).catch(showError);
      },
    });
    return h('label', { class: 'check-row' }, box, h('span', {}, label));
  };
  openSheet((close) => [
    h('div', { class: 'sheet-title' }, '通知の設定'),
    h('p', { class: 'push-status' }, messages[status.state]),
    status.state === 'off' &&
      h(
        'button',
        {
          class: 'sheet-action',
          onClick: async () => {
            try {
              await push.enablePush();
              toast('通知をオンにしました');
            } catch (e) {
              toast(e.message === 'denied' ? '通知が許可されませんでした' : '通知をオンにできませんでした');
            }
            close(null);
            pushSettingsSheet();
          },
        },
        '🔔 この端末で通知を受け取る',
      ),
    status.state === 'on' &&
      h(
        'button',
        {
          class: 'sheet-action',
          onClick: async () => {
            await push.notify({ kind: 'test', title: 'テスト' });
            toast('テスト通知を送りました（数秒で届きます）');
          },
        },
        '🔔 テスト通知を送る（自分の端末だけ）',
      ),
    status.state === 'on' &&
      h(
        'button',
        {
          class: 'sheet-action danger',
          onClick: async () => {
            await push.disablePush();
            toast('この端末の通知をオフにしました');
            close(null);
          },
        },
        'この端末の通知をやめる',
      ),
    prefs &&
      h(
        'div',
        { class: 'push-prefs' },
        h('span', { class: 'links-label' }, '受け取る通知（すべての端末に共通）'),
        pref('news', '📢 お知らせ'),
        pref('plans', '📅 予定・イベントが追加されたとき'),
        pref('reminders', '⏰ 前日のリマインド（夜8時ごろ）'),
      ),
    h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, '閉じる'),
  ]);
}

function startNewsWatchers(u) {
  unwatchReads?.();
  unwatchAppNews?.();
  unwatchReads = unwatchAppNews = null;
  newsReads = null;
  newsSources.clear();
  newsQueue.length = 0;
  if (!u) return;
  unwatchReads = store.watchReads(
    (seen) => {
      newsReads = seen;
      newsListeners.forEach((fn) => fn());
      checkNews();
    },
    () => {
      newsReads = {};
    },
  );
  unwatchAppNews = store.watchAppNews(
    (list) => setNewsSource('app', list.map((n) => ({ ...n, key: `app:${n.id}`, sourceId: 'app', sourceName: 'アプリ' }))),
    () => {},
  );
}

function showError(e) {
  console.error(e);
  toast(e?.code === 'permission-denied' ? '権限がありません' : 'エラーが発生しました');
}

function timeAgo(ms) {
  if (!ms) return '未アクセス';
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  return `${Math.floor(hour / 24)}日前`;
}

function onlineDot(online) {
  return h('span', { class: `dot${online ? ' online' : ''}`, 'aria-label': online ? 'オンライン' : 'オフライン' });
}

async function runAuth(fn) {
  authBusy = true;
  try {
    await fn();
  } catch (e) {
    const msg = auth.authErrorMessage(e);
    if (msg) toast(msg);
  } finally {
    authBusy = false;
    route();
    checkNews();
  }
}

async function renameAccount() {
  const name = await askText({ title: 'あなたの名前', value: auth.displayName(), placeholder: '例：たろう', okLabel: '保存' });
  if (!name) return;
  try {
    await auth.setDisplayName(name);
  } catch (e) {
    return showError(e);
  }
  store.touchPresence(null).catch(() => {});
  route();
  // グループごとに別の名前を付けている場合もあるので、全グループへの反映は選んでもらう
  actionSheet(`参加中のグループでの名前も「${name}」にしますか？`, [
    {
      label: 'すべてのグループに反映する',
      onClick: () => store.syncMyProfile({ name: true }).then(() => toast('すべてのグループに反映しました'), showError),
    },
  ]);
}

function accountMenu() {
  const guest = auth.isGuest();
  const unread = unreadNewsCount('app');
  actionSheet(`${auth.displayName()}${guest ? '（ゲスト）' : ''}`, [
    { label: `📢 アプリからのお知らせ${unread ? `（未読${unread}）` : ''}`, onClick: () => (location.hash = '#/news') },
    { label: '🔔 通知の設定', onClick: pushSettingsSheet },
    isAdmin && { label: '管理者ダッシュボード', onClick: () => (location.hash = '#/admin') },
    { label: '名前を変更', onClick: renameAccount },
    guest && { label: '復旧IDを確認', onClick: myRecoverySheet },
    guest && {
      label: 'Google アカウントに引き継ぐ',
      onClick: () =>
        runAuth(async () => {
          await auth.upgradeGuestToGoogle();
          await store.syncMyProfile().catch(() => {});
          await store.deleteMyRecoveryCodes().catch(() => {});
          store.touchPresence(null).catch(() => {});
          toast('Google アカウントに引き継ぎました');
        }),
    },
    {
      label: 'ユーザーIDをコピー',
      onClick: async () => {
        await navigator.clipboard.writeText(auth.currentUser().uid).catch(() => {});
        toast('コピーしました');
      },
    },
    {
      label: 'ログアウト',
      danger: true,
      onClick: async () => {
        if (guest && !(await confirmSheet('ゲストのままログアウトすると、参加中のグループに戻れなくなります（招待リンクから再参加は可能）。ログアウトしますか？', 'ログアウト'))) return;
        await auth.signOut();
        location.hash = '#/';
      },
    },
  ].filter(Boolean));
}

// ---- 画面：読み込み中 ----

function loadingView(root) {
  root.append(h('div', { class: 'center-screen' }, h('div', { class: 'spinner', 'aria-label': '読み込み中' })));
}

// ---- 画面：名前の入力（名前が未設定のとき） ----

function nameSetupView(root) {
  const input = h('input', { class: 'text-input', placeholder: '例：たろう', maxlength: 40, 'aria-label': '名前' });
  root.append(
    h(
      'div',
      { class: 'center-screen' },
      h('img', { class: 'welcome-icon', src: 'icons/icon.svg', alt: '' }),
      h('h1', { class: 'welcome-title' }, 'はじめまして'),
      h('p', { class: 'welcome-text' }, 'アプリ内で表示するあなたの名前を入力してください。あとから変更できます。'),
      h(
        'form',
        {
          class: 'join-form',
          onSubmit: async (e) => {
            e.preventDefault();
            const name = input.value.trim();
            if (!name) {
              input.focus();
              toast('名前を入力してください');
              return;
            }
            try {
              await auth.setDisplayName(name);
            } catch (err) {
              return showError(err);
            }
            route();
            heartbeat(true);
            checkNews();
          },
        },
        input,
        h('button', { type: 'submit', class: 'btn primary wide' }, '決定'),
      ),
    ),
  );
  input.focus();
}

// ---- 復旧ID ----

function recoveryCodeSheet(title, code, note) {
  const url = store.recoveryUrl(code);
  openSheet((close) => [
    h('div', { class: 'sheet-title' }, title),
    h(
      'div',
      { class: 'qr-sheet' },
      h('div', { class: 'recovery-code' }, store.formatRecoveryCode(code)),
      qrCode(url, 180),
      h('p', {}, note),
    ),
    h(
      'button',
      {
        class: 'sheet-action',
        onClick: async () => {
          await navigator.clipboard.writeText(store.formatRecoveryCode(code)).catch(() => {});
          toast('復旧IDをコピーしました');
        },
      },
      '復旧IDをコピー',
    ),
    h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, '閉じる'),
  ]);
}

async function myRecoverySheet() {
  let codes;
  try {
    codes = await store.myRecoveryCodes();
  } catch (e) {
    return showError(e);
  }
  if (codes.length === 0) return toast('復旧IDはまだありません（グループを開くと作られます）');
  if (codes.length === 1) {
    return recoveryCodeSheet('あなたの復旧ID', codes[0].code, 'スマホをなくしたときは、新しいスマホでこのIDを入力するとグループに戻れます。スクリーンショットで控えておくと安心です。');
  }
  // 複数グループに参加している場合はグループを選んでもらう
  const names = Object.fromEntries((await store.listMyGroups().catch(() => [])).map((g) => [g.id, g.name]));
  actionSheet(
    '復旧IDを見るグループ',
    codes.map((c) => ({
      label: names[c.groupId] ?? 'グループ',
      onClick: () => recoveryCodeSheet(`「${names[c.groupId] ?? 'グループ'}」の復旧ID`, c.code, 'スマホをなくしたときは、新しいスマホでこのIDを入力するとグループに戻れます。'),
    })),
  );
}

function recoverView(root, { code = '' }) {
  const input = h('input', {
    class: 'text-input recovery-input',
    value: code ? store.formatRecoveryCode(code) : '',
    placeholder: 'XXXX-XXXX-XXXX',
    maxlength: 20,
    autocapitalize: 'characters',
    autocomplete: 'off',
    'aria-label': '復旧ID',
  });
  const submit = h('button', { type: 'submit', class: 'btn primary wide' }, 'グループに戻る');
  root.append(
    h(
      'div',
      { class: 'center-screen' },
      h('img', { class: 'welcome-icon', src: 'icons/icon.svg', alt: '' }),
      h('h1', { class: 'welcome-title' }, '復旧IDで戻る'),
      h('p', { class: 'welcome-text' }, 'グループのオーナーから教えてもらった復旧IDを入力してください。前のスマホはグループから外れます。'),
      h(
        'form',
        {
          class: 'join-form',
          onSubmit: async (e) => {
            e.preventDefault();
            const value = store.normalizeRecoveryCode(input.value);
            if (value.length !== 12) {
              input.focus();
              toast('復旧IDは12文字です');
              return;
            }
            submit.disabled = true;
            authBusy = true;
            let createdGuest = false;
            try {
              if (!auth.currentUser()) {
                await auth.signInAsGuest();
                createdGuest = true;
              }
              const rec = await store.lookupRecoveryCode(value);
              if (!rec) throw new Error('invalid-recovery-code');
              if (auth.needsName()) await auth.setDisplayName(rec.name || 'ゲスト');
              const groupId = await store.recoverWithCode(value);
              toast(`「${auth.displayName()}」として戻りました`);
              location.replace(`#/g/${groupId}`);
            } catch (err) {
              console.error(err);
              // 復旧に失敗したら、この操作で作った空のゲストは使わないのでログアウトしておく
              if (createdGuest) await auth.signOut().catch(() => {});
              toast(err?.message === 'invalid-recovery-code' ? '復旧IDが見つかりません' : '復旧できませんでした。オーナーに新しい復旧IDを確認してください');
              submit.disabled = false;
            } finally {
              authBusy = false;
              route();
            }
          },
        },
        input,
        submit,
      ),
      h('a', { class: 'welcome-note', href: '#/' }, '戻る'),
    ),
  );
}

// ---- 画面：ようこそ（未ログイン） ----

function welcomeView(root) {
  root.append(
    h(
      'div',
      { class: 'center-screen' },
      h('img', { class: 'welcome-icon', src: 'icons/icon.svg', alt: '' }),
      h('h1', { class: 'welcome-title' }, 'ouchi-share'),
      h('p', { class: 'welcome-text' }, '家族や友人と、予定・持ち物・日用品の在庫を共有できます。'),
      h('button', { class: 'btn primary wide', onClick: () => runAuth(auth.signInWithGoogle) }, 'Google でログイン'),
      h('p', { class: 'welcome-note' }, '招待リンクを受け取った方は、そのリンクから開いてください。'),
      h('a', { class: 'btn wide', href: '#/recover' }, 'スマホを替えた方（復旧IDで戻る）'),
    ),
  );
}

// ---- 画面：招待リンクから参加 ----

function joinView(root, { groupId, code }) {
  const status = h('p', { class: 'welcome-text' });
  const box = h('div', { class: 'center-screen' }, h('img', { class: 'welcome-icon', src: 'icons/icon.svg', alt: '' }), status);
  root.append(box);

  if (user) {
    status.textContent = 'グループに参加しています…';
    store
      .joinGroup(groupId, code)
      .then(() => location.replace(`#/g/${groupId}`))
      .catch((e) => {
        console.error(e);
        status.textContent = '招待リンクが無効です。リンクが作り直された可能性があるので、招待してくれた人に新しいリンクをもらってください。';
        box.append(h('a', { class: 'btn wide', href: '#/' }, 'ホームへ'));
      });
    return;
  }

  status.textContent = 'グループに招待されています。';
  const nameInput = h('input', { class: 'text-input', placeholder: 'ニックネーム（例：たろう）', maxlength: 40, 'aria-label': 'ニックネーム' });
  box.append(
    h(
      'form',
      {
        class: 'join-form',
        onSubmit: (e) => {
          e.preventDefault();
          const name = nameInput.value.trim();
          if (!name) {
            nameInput.focus();
            toast('ニックネームを入力してください');
            return;
          }
          runAuth(() => auth.signInAsGuest(name));
        },
      },
      nameInput,
      h('button', { type: 'submit', class: 'btn primary wide' }, 'ゲストとして参加'),
    ),
    h('div', { class: 'divider' }, 'または'),
    h('button', { class: 'btn wide', onClick: () => runAuth(auth.signInWithGoogle) }, 'Google でログインして参加'),
  );
}

// ---- 画面：グループ一覧 ----

function homeView(root) {
  const body = h('main', { class: 'content' });
  root.append(header({ title: 'ouchi-share', onMenu: accountMenu }), body);
  const appUrl = `${location.origin}${location.pathname}`;
  const qrCard = h(
    'div',
    { class: 'qr-card' },
    qrCode(appUrl, 150),
    h('div', { class: 'qr-card-text' }, h('strong', {}, '📱 スマホで開く'), h('span', {}, 'カメラで読み取ると、このページを開けます'), h('span', { class: 'qr-url' }, appUrl)),
  );

  return store.watchGroups((groups) => {
    setChildren(
      body,
      h(
        'button',
        { class: 'greeting', onClick: renameAccount, 'aria-label': '名前を変更' },
        h('span', {}, `👋 ${auth.displayName()} さん`),
        auth.isGuest() && h('span', { class: 'badge muted' }, 'ゲスト'),
        h('span', { class: 'edit-hint' }, '変更'),
      ),
      h('p', { class: 'section-label' }, 'グループ'),
      groups.length === 0 && h('p', { class: 'empty' }, isAdmin ? 'グループを作ってみましょう' : '参加中のグループはありません'),
      h(
        'div',
        { class: 'card-list' },
        groups.map((g) =>
          h(
            'a',
            { class: 'card', href: `#/g/${g.id}` },
            h('span', { class: 'card-icon' }, '🏠'),
            h('span', { class: 'card-main' }, h('span', { class: 'card-title' }, g.name), h('span', { class: 'card-sub' }, `メンバー ${g.memberIds.length} 人`)),
            h('span', { class: 'chevron' }, '›'),
          ),
        ),
      ),
      isAdmin
        ? h(
            'button',
            {
              class: 'add-card',
              onClick: async () => {
                const name = await askText({ title: '新しいグループ', placeholder: '例：わが家、旅行メンバー', okLabel: '作成' });
                if (name) store.createGroup(name).then((id) => (location.hash = `#/g/${id}`), showError);
              },
            },
            '＋ グループを作成',
          )
        : !auth.isGuest() &&
          h(
            'div',
            { class: 'notice' },
            h('p', {}, 'グループを作るには、管理者に許可リストへ追加してもらう必要があります。下のユーザーIDを伝えてください。'),
            h('code', { class: 'uid' }, user.uid),
          ),
      qrCard,
    );
  }, showError);
}

// ---- 画面：グループ内のリスト一覧 ----

// ---- 日付 ----
// 日付は "YYYY-MM-DD" の文字列で扱う（端末のタイムゾーンでの今日と比べる）

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

function fmtDate(str) {
  const d = new Date(`${str}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
}

function fmtRange(ev) {
  return ev.startDate === ev.endDate ? fmtDate(ev.startDate) : `${fmtDate(ev.startDate)} 〜 ${fmtDate(ev.endDate)}`;
}

function eventStatus(ev, today = todayStr()) {
  if (today < ev.startDate) {
    const days = daysBetween(today, ev.startDate);
    return { kind: 'upcoming', label: days === 1 ? '明日から' : `あと${days}日` };
  }
  if (today <= ev.endDate) return { kind: 'ongoing', label: '開催中' };
  return { kind: 'past', label: '終了' };
}

// これから・開催中は日付の近い順、終わったものは新しい順
function sortEvents(events) {
  const today = todayStr();
  const active = events.filter((e) => e.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = events.filter((e) => e.endDate < today).sort((a, b) => b.startDate.localeCompare(a.startDate));
  return { active, past };
}

// ---- イベントの作成・編集シート ----

function eventSheet({ title = '', emoji = EVENT_EMOJIS[0], startDate = todayStr(), endDate, participants = [] } = {}, okLabel = '作成', members = null) {
  let chosen = emoji;
  return openSheet((close) => {
    const people = members ? participantPicker(members, participants) : null;
    const titleInput = h('input', { class: 'text-input', value: title, placeholder: '例：沖縄旅行', maxlength: 60, 'aria-label': 'イベント名' });
    const startInput = h('input', { class: 'text-input', type: 'date', value: startDate, 'aria-label': '開始日' });
    const endInput = h('input', { class: 'text-input', type: 'date', value: endDate ?? startDate, 'aria-label': '終了日' });
    // 開始日を後ろにずらしたら、終了日も追いつかせる
    startInput.addEventListener('change', () => {
      if (!endInput.value || endInput.value < startInput.value) endInput.value = startInput.value;
    });
    const emojis = [emoji, ...EVENT_EMOJIS.filter((e) => e !== emoji)];
    const picker = h(
      'div',
      { class: 'emoji-picker' },
      emojis.map((em, i) => {
        const btn = h(
          'button',
          {
            type: 'button',
            class: `emoji-btn${i === 0 ? ' selected' : ''}`,
            onClick: () => {
              chosen = em;
              picker.querySelectorAll('.emoji-btn').forEach((b) => b.classList.remove('selected'));
              btn.classList.add('selected');
            },
          },
          em,
        );
        return btn;
      }),
    );
    return [
      h('div', { class: 'sheet-title' }, okLabel === '作成' ? '新しいイベント' : 'イベントを編集'),
      h(
        'form',
        {
          class: 'sheet-form',
          onSubmit: (e) => {
            e.preventDefault();
            const t = titleInput.value.trim();
            if (!t) return titleInput.focus();
            if (!startInput.value || !endInput.value) return toast('日付を入れてください');
            if (endInput.value < startInput.value) return toast('終了日が開始日より前になっています');
            close({ title: t, emoji: chosen, startDate: startInput.value, endDate: endInput.value, participants: people ? people.value() : participants });
          },
        },
        picker,
        titleInput,
        h('div', { class: 'date-row' }, h('label', {}, '開始', startInput), h('label', {}, '終了', endInput)),
        people?.el,
        h(
          'div',
          { class: 'sheet-buttons' },
          h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn primary' }, okLabel),
        ),
      ),
    ];
  });
}

// ---- 旅程（イベントのスケジュール） ----
// 時刻は「0:00 からの分」で計算し、表示と保存は "HH:MM"

const DEFAULT_START = '09:00';
const DEFAULT_DURATION = 60; // 予定を入れると 1 時間枠を取る
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480];

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// 表示用：24 時を超えたら「翌」を付ける
function fmtTime(min) {
  return min >= 1440 ? `翌${toHHMM(min - 1440)}` : toHHMM(min);
}

function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h && `${h}時間`, m && `${m}分`].filter(Boolean).join('') || '0分';
}

function eventDays(ev) {
  const days = [];
  for (let d = new Date(`${ev.startDate}T00:00:00`); days.length < 31; d.setDate(d.getDate() + 1)) {
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (str > ev.endDate) break;
    days.push(str);
  }
  return days;
}

// 並び順：order（並べ替えで保存する番号）順。order のない古いデータは開始時刻順
// 時刻のない予定（start: null ＝「時間未定」）も order で並ぶ
function seqKey(i) {
  return i.order ?? (i.start ? toMin(i.start) : 100000);
}

function bySeq(a, b) {
  return seqKey(a) - seqKey(b) || (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

function dayItems(items, date) {
  return items.filter((i) => i.date === date).sort(bySeq);
}

function candidateItems(items) {
  return items.filter((i) => !i.date).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

function timedOf(list) {
  return list.filter((i) => i.start);
}

function endOf(item) {
  return toMin(item.start) + (item.duration ?? DEFAULT_DURATION);
}

// その日の最後の「時刻のある予定」が終わる時刻（なければ 9:00）
function nextStart(items, date) {
  const timed = timedOf(dayItems(items, date));
  if (!timed.length) return DEFAULT_START;
  return toHHMM(Math.min(endOf(timed[timed.length - 1]), 23 * 60 + 59));
}

// 並べ替え後の順番で、最初の開始時刻はそのまま、各予定の長さを保って詰め直す
// 時刻のない予定は時間を使わない（飛ばす）
function reflow(ordered, firstStart) {
  let t = toMin(firstStart);
  const starts = {};
  for (const it of ordered) {
    if (!it.start) continue;
    starts[it.id] = toHHMM(Math.min(t, 47 * 60 + 59));
    t += it.duration ?? DEFAULT_DURATION;
  }
  return starts;
}

// 見た目の並びどおりに order を振り直す
function orderPatch(ordered) {
  return Object.fromEntries(ordered.map((it, i) => [it.id, { order: i }]));
}

// 時刻のない予定の目安：直前の「時刻のある予定」の終わり
function untimedHint(day, item) {
  const before = timedOf(day.slice(0, day.indexOf(item)));
  return before.length ? fmtTime(endOf(before[before.length - 1])) : null;
}

// ---- 予定のリンク ----
// items の 1 件に links: [{ type, url }] を持つ。種類は見た目（ラベルとアイコン）を変えるだけ

const LINK_TYPES = [
  { id: 'none', label: '未設定', icon: '🔗' },
  { id: 'official', label: '公式サイト', icon: '🌐' },
  { id: 'booking', label: '予約サイト', icon: '📅' },
  { id: 'video', label: '紹介動画', icon: '▶️' },
  { id: 'map', label: '地図', icon: '🗺️' },
  { id: 'menu', label: 'メニュー', icon: '🍽️' },
  { id: 'other', label: 'その他', icon: '🔗' },
];

function linkType(id) {
  return LINK_TYPES.find((t) => t.id === id) ?? LINK_TYPES[0];
}

// 入力された URL を整える。http / https 以外（javascript: など）は受け付けない（null を返す）
function normalizeUrl(input) {
  let text = input.trim();
  if (!text) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// 種類が「未設定」のとき、URL から種類を推測する
function guessLinkType(url) {
  const host = (() => {
    try {
      return new URL(normalizeUrl(url) || 'https://x').hostname;
    } catch {
      return '';
    }
  })();
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/.test(host)) return 'video';
  if (/(^|\.)maps\.google\.|(^|\.)maps\.app\.goo\.gl$|^goo\.gl$/.test(host) || /google\.[a-z.]+\/maps/.test(url)) return 'map';
  return 'none';
}

// ボタンに出す文字：種類が未設定・その他ならドメイン名
function linkLabel(link) {
  const t = linkType(link.type);
  if (t.id !== 'none' && t.id !== 'other') return `${t.icon} ${t.label}`;
  try {
    return `${t.icon} ${new URL(link.url).hostname.replace(/^www\./, '')}`;
  } catch {
    return `${t.icon} リンク`;
  }
}

// リンクの入力欄：種類 ＋ URL の行をいくつでも（旅程の予定・普段の予定で共通）
// value() は入力が正しければ [{ type, url }]、http / https 以外があれば注意を出して null
function linksEditor(initialLinks = []) {
  const rows = h('div', { class: 'link-rows' });
  const addRow = (link = { type: 'none', url: '' }) => {
    const type = h('select', { class: 'text-input link-type', 'aria-label': 'リンクの種類' }, LINK_TYPES.map((t) => h('option', { value: t.id }, `${t.icon} ${t.label}`)));
    type.value = linkType(link.type).id;
    const url = h('input', { class: 'text-input link-url', type: 'text', inputmode: 'url', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', value: link.url, placeholder: 'https://…', maxlength: 2000, 'aria-label': 'URL' });
    url.addEventListener('change', () => {
      if (type.value === 'none') type.value = guessLinkType(url.value);
    });
    const row = h('div', { class: 'link-row' }, type, url, h('button', { type: 'button', class: 'link-remove', 'aria-label': 'このリンクを削除', onClick: () => row.remove() }, '×'));
    rows.append(row);
    return url;
  };
  (initialLinks ?? []).forEach((l) => addRow(l));
  const el = h(
    'div',
    { class: 'links-editor' },
    h('span', { class: 'links-label' }, 'リンク（いくつでも）'),
    rows,
    h('button', { type: 'button', class: 'link-add', onClick: () => addRow().focus() }, '＋ リンクを追加'),
  );
  const value = () => {
    const links = [];
    for (const row of rows.querySelectorAll('.link-row')) {
      const raw = row.querySelector('.link-url').value;
      if (!raw.trim()) continue;
      const url = normalizeUrl(raw);
      if (!url) {
        row.querySelector('.link-url').focus();
        toast('http:// か https:// で始まるリンクを入れてください');
        return null;
      }
      links.push({ type: row.querySelector('.link-type').value, url });
    }
    if (links.length > 20) {
      toast('リンクは 20 件までです');
      return null;
    }
    return links;
  };
  return { el, value };
}

// 保存済みのリンクを、http / https のものだけにしてボタンで並べる
function linkChips(links) {
  const safe = (links ?? []).map((l) => ({ ...l, url: normalizeUrl(l.url ?? '') })).filter((l) => l.url);
  return (
    safe.length > 0 &&
    h(
      'span',
      { class: 'sch-links' },
      safe.map((l) => h('a', { class: `sch-link ${linkType(l.type).id}`, href: l.url, target: '_blank', rel: 'noopener noreferrer', onClick: (e) => e.stopPropagation() }, linkLabel(l))),
    )
  );
}

function mapsUrl(place) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}

// 予定の追加・編集シート
function scheduleItemSheet(ev, items, initial = {}, { editing = false } = {}) {
  const days = eventDays(ev);
  return openSheet((close) => {
    const title = h('input', { class: 'text-input', value: initial.title ?? '', placeholder: '例：浅草観光', maxlength: 60, 'aria-label': 'タイトル' });
    const dateSel = h(
      'select',
      { class: 'text-input', 'aria-label': '日にち' },
      days.map((d, i) => h('option', { value: d }, `${i + 1}日目 ${fmtDate(d)}`)),
      initial.date && !days.includes(initial.date) && h('option', { value: initial.date }, `期間外 ${fmtDate(initial.date)}`),
      h('option', { value: '' }, '💡 行きたい候補（日時未定）'),
    );
    dateSel.value = initial.date === undefined ? days[0] : initial.date ?? '';
    const start = h('input', { class: 'text-input', type: 'time', step: 300, value: initial.start ?? nextStart(items, dateSel.value), 'aria-label': '開始時刻' });
    const durationSel = h(
      'select',
      { class: 'text-input', 'aria-label': '長さ' },
      [...new Set([...DURATIONS, initial.duration ?? DEFAULT_DURATION])].sort((a, b) => a - b).map((m) => h('option', { value: m }, fmtDuration(m))),
    );
    durationSel.value = String(initial.duration ?? DEFAULT_DURATION);
    const place = h('input', { class: 'text-input', value: initial.place ?? '', placeholder: '場所（例：浅草寺）', maxlength: 100, 'aria-label': '場所' });
    const memo = h('textarea', { class: 'text-input memo-input', placeholder: 'メモ（例：予約済み、雨なら中止）', maxlength: 500, rows: 2, 'aria-label': 'メモ' }, initial.memo ?? '');

    const linksEdit = linksEditor(initial.links);
    const timeRow = h('div', { class: 'date-row' }, h('label', {}, '開始', start), h('label', {}, '長さ', durationSel));
    // 「時間を決めない」：日は決まっているけど時刻は未定（順番だけ持つ）
    const untimed = h('input', { type: 'checkbox', checked: editing && !!initial.date && !initial.start });
    const untimedRow = h('label', { class: 'check-row' }, untimed, h('span', {}, '時間を決めない（順番だけ）'));
    const syncTimeRow = () => {
      untimedRow.style.display = dateSel.value ? '' : 'none';
      timeRow.style.display = dateSel.value && !untimed.checked ? '' : 'none';
    };
    untimed.addEventListener('change', syncTimeRow);
    // 日にちを変えたら、新しく入れる予定はその日の最後に続ける
    dateSel.addEventListener('change', () => {
      syncTimeRow();
      if (dateSel.value && (!editing || dateSel.value !== initial.date)) start.value = nextStart(items.filter((i) => i.id !== initial.id), dateSel.value);
    });
    syncTimeRow();
    return [
      h('div', { class: 'sheet-title' }, editing ? '予定を編集' : '予定を追加'),
      h(
        'form',
        {
          class: 'sheet-form',
          onSubmit: (e) => {
            e.preventDefault();
            const t = title.value.trim();
            if (!t) return title.focus();
            const date = dateSel.value || null;
            const timed = date && !untimed.checked;
            if (timed && !start.value) return toast('開始時刻を入れてください');
            const links = linksEdit.value();
            if (!links) return;
            close({
              links,
              title: t,
              date,
              start: timed ? start.value : null,
              duration: Number(durationSel.value),
              place: place.value.trim(),
              memo: memo.value.trim(),
            });
          },
        },
        title,
        dateSel,
        untimedRow,
        timeRow,
        place,
        memo,
        linksEdit.el,
        h(
          'div',
          { class: 'sheet-buttons' },
          h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn primary' }, editing ? '保存' : '追加'),
        ),
      ),
    ];
  });
}

// ---- 旅程のドラッグ＆ドロップ ----
// つまみ（⠿）を押して動かす。つまみ以外ではふつうにスクロールできるように、つまみだけ touch-action: none にしている。
// ドラッグ中に他の人の編集で画面が描き直されると掴んでいる要素が消えるので、描き直しはドロップ後まで待つ。
// iPhone の Safari は touch-action だけではスクロールを止めきれず、スクロールが始まるとドラッグが中断される
// （pointercancel が来る）ので、タッチのイベントでもスクロールを止める。
// 動かしている途中で行を別の位置に差し込み直すと、ブラウザはその行（つまみ）への pointer capture を外してしまう。
// つまみで pointermove / pointerup を待っていると「離した」が届かずドラッグが終わらなくなるので、window で受け取る。

const scheduleDrag = { active: false, pendingRender: null };
// カレンダーの日付を長押しして指でなぞっている間（スクロールを止める）と、離した直後のタップを無視する時刻
const calPick = { active: false, ignoreTapUntil: 0 };

// ドラッグ中は画面の指スクロールを止める（自動スクロールは scrollBy で動かすので影響しない）
function blockTouchScroll(e) {
  if (scheduleDrag.active || moneyDrag.active || calPick.active) e.preventDefault();
}
document.addEventListener('touchmove', blockTouchScroll, { passive: false });

function enableScheduleDrag(container, onDrop) {
  // つまみに触れた時点でスクロールを始めさせない
  container.addEventListener(
    'touchstart',
    (e) => {
      if (e.target.closest('.sch-handle')) e.preventDefault();
    },
    { passive: false },
  );

  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.sch-handle');
    if (!handle || e.button > 0 || scheduleDrag.active) return;
    const li = handle.closest('li');
    e.preventDefault();

    const rect = li.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const offsetY = e.clientY - rect.top;
    const ghost = li.cloneNode(true);
    ghost.classList.add('sch-ghost');
    Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px` });
    document.body.append(ghost);
    li.classList.add('sch-placeholder');
    container.classList.add('dragging');
    scheduleDrag.active = true;
    navigator.vibrate?.(10);

    let y = e.clientY;
    let overList = null;

    // 指の位置にあるリストの、指より下にある最初の行の前へ移動する（見た目上の仮の位置）
    const place = () => {
      ghost.style.top = `${y - offsetY}px`;
      ghost.style.visibility = 'hidden';
      const el = document.elementFromPoint(centerX, y);
      ghost.style.visibility = '';
      const list = el?.closest('.sch-day, .sch-day-card')?.querySelector('.sch-list[data-drop]');
      if (!list) return;
      if (overList !== list) {
        overList?.closest('.sch-day, .sch-day-card').classList.remove('drag-over');
        list.closest('.sch-day, .sch-day-card').classList.add('drag-over');
        overList = list;
      }
      const rows = [...list.children].filter((r) => r !== li);
      const before = rows.find((r) => {
        const b = r.getBoundingClientRect();
        return y < b.top + b.height / 2;
      });
      if (before) {
        if (li.nextElementSibling !== before || li.parentElement !== list) list.insertBefore(li, before);
      } else if (list.lastElementChild !== li) {
        list.append(li);
      }
    };

    // 画面の上下の端に近づいたら自動でスクロールする
    let raf = 0;
    const tick = () => {
      const edge = 70;
      const speed = y < edge ? -(edge - y) / 4 : y > innerHeight - edge ? (y - (innerHeight - edge)) / 4 : 0;
      if (speed) {
        scrollBy(0, speed);
        place();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const pointerId = e.pointerId;
    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      y = ev.clientY;
      place();
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      ghost.remove();
      li.classList.remove('sch-placeholder');
      container.classList.remove('dragging');
      overList?.closest('.sch-day, .sch-day-card').classList.remove('drag-over');
      const list = li.parentElement;
      scheduleDrag.active = false;
      onDrop(li.dataset.id, list.dataset.drop, [...list.children].map((r) => r.dataset.id));
      // 仮に動かした DOM を正しい状態に戻すため、必ず描き直す
      const render = scheduleDrag.pendingRender;
      scheduleDrag.pendingRender = null;
      render?.();
    };
    const onUp = (ev) => ev.pointerId === pointerId && finish();
    // それでもブラウザに中断されたら、元に戻さずその時点の位置に置く
    const onCancel = (ev) => ev.pointerId === pointerId && finish();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });
}

// focusDate を渡すとその 1 日だけの画面（全体の画面ではカードから 1 日を選ぶ）。1 日だけのイベントは常に 1 日の画面
function scheduleSection(groupId, ev, schedule, { focusDate = null } = {}) {
  const items = schedule?.items ?? [];
  const days = eventDays(ev);
  const candidates = candidateItems(items);
  const outside = items.filter((i) => i.date && !days.includes(i.date)).sort((a, b) => a.date.localeCompare(b.date) || bySeq(a, b));
  const listOf = (date) => (date ? dayItems(items, date) : candidates);
  const firstStart = (list) => timedOf(list)[0]?.start ?? DEFAULT_START;

  // 末尾に足すとき、order のない古いデータが混ざっていたら並び順を固定しておく
  const fixOrders = (list) => (list.some((i) => i.order === undefined) ? orderPatch(list) : {});
  const save = (changes) => Object.keys(changes).length && store.patchScheduleItems(groupId, ev.id, changes).catch(showError);
  const merge = (...patches) => {
    const out = {};
    for (const p of patches) for (const [id, v] of Object.entries(p)) out[id] = { ...out[id], ...v };
    return out;
  };

  const add = async (initial) => {
    const res = await scheduleItemSheet(ev, items, initial);
    if (!res) return;
    const target = listOf(res.date);
    store
      .addScheduleItem(groupId, ev.id, { ...res, order: target.length })
      .then(() => save(fixOrders(target)))
      .catch(showError);
  };

  // 元の日から抜けたとき、残りを詰め直す（時間未定の予定は時間を使っていないので何もしない）
  const reflowSource = (item) =>
    item.date && item.start ? reflow(dayItems(items, item.date).filter((i) => i.id !== item.id), firstStart(dayItems(items, item.date))) : {};
  const asStarts = (starts) => Object.fromEntries(Object.entries(starts).map(([id, start]) => [id, { start }]));

  // ほかの場所（別の日・候補）の末尾へ移す。移動先の時刻は詰め直さない（決まっている時刻を動かさない）
  //   日へ：時刻のある予定と候補は、その日の最後の予定の後に 1 時間枠で入る。時間未定の予定は時間未定のまま
  const appendTo = (item, date) => {
    const target = listOf(date).filter((i) => i.id !== item.id);
    const patch = { date: date || null, order: target.length };
    if (!date) patch.start = null;
    else if (item.start || !item.date) Object.assign(patch, { start: nextStart(items, date), duration: item.duration ?? DEFAULT_DURATION });
    save(merge(fixOrders(target), asStarts(reflowSource(item)), { [item.id]: patch }));
  };

  // 上へ・下へ：入れ替えてから、その日の最初の開始時刻を基準に詰め直す（順番も保存）
  // 時刻のある予定どうしの入れ替えでなければ（どちらかが時間未定なら）順番だけ変える
  const move = (item, delta) => {
    const day = dayItems(items, item.date);
    const i = day.findIndex((x) => x.id === item.id);
    const j = i + delta;
    if (j < 0 || j >= day.length) return;
    const ordered = [...day];
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    const bothTimed = day[i].start && day[j].start;
    save(merge(orderPatch(ordered), bothTimed ? asStarts(reflow(ordered, firstStart(day))) : {}));
  };

  // ドロップ：移動先の日を並びどおりに詰め直す。別の日・候補から来た／へ行った場合は、元の日も詰め直す
  //   target: "YYYY-MM-DD"（日）または ""（行きたい候補）、orderedIds: 移動先リストの見た目の並び
  const onDrop = (id, target, orderedIds) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const from = item.date ?? '';
    const before = listOf(target);
    if (from === target && before.map((i) => i.id).join() === orderedIds.join()) return; // 動いていない

    // 候補から日へ入れたら時刻のある予定（1 時間枠）にする。時間未定の予定は時間未定のまま
    const moved = target && !item.date ? { ...item, start: DEFAULT_START, duration: item.duration ?? DEFAULT_DURATION } : item;
    const ordered = orderedIds.map((x) => (x === id ? moved : items.find((i) => i.id === x))).filter(Boolean);
    const changes = [orderPatch(ordered)];
    if (target) {
      // 時間未定の予定を動かしたときは順番だけ変える（ほかの予定の時刻は動かさない）
      if (moved.start) changes.push(asStarts(reflow(ordered, firstStart(from === target ? before : before.filter((i) => i.id !== id)))));
      if (from !== target) changes.push({ [id]: { date: target, duration: moved.duration ?? DEFAULT_DURATION } });
    } else if (from) {
      changes.push({ [id]: { date: null, start: null } });
    }
    if (from && from !== target) changes.push(asStarts(reflowSource(item)));
    save(merge(...changes));
  };

  const scheduleInto = async (item) => {
    const date = await openSheet((close) => [
      h('div', { class: 'sheet-title' }, `「${item.title}」をいつにする？`),
      ...days.map((d, i) => h('button', { class: 'sheet-action', onClick: () => close(d) }, `${i + 1}日目 ${fmtDate(d)}`)),
      h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, 'キャンセル'),
    ]);
    if (date) appendTo(item, date);
  };

  // 別の日へ移動：移動先の日の最後に入れて、移動先と元の日を詰め直す（ドロップと同じ処理）
  const moveToDay = async (item) => {
    const date = await openSheet((close) => [
      h('div', { class: 'sheet-title' }, `「${item.title}」をどの日に移す？`),
      ...days.filter((d) => d !== item.date).map((d) => h('button', { class: 'sheet-action', onClick: () => close(d) }, `${days.indexOf(d) + 1}日目 ${fmtDate(d)}`)),
      h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, 'キャンセル'),
    ]);
    if (date) appendTo(item, date);
  };

  const itemMenu = (item, day) => {
    const i = day ? day.findIndex((x) => x.id === item.id) : -1;
    actionSheet(item.title, [
      {
        label: '編集',
        onClick: async () => {
          const res = await scheduleItemSheet(ev, items, item, { editing: true });
          if (!res) return;
          // 日（または候補）を変えたら、移動先の最後に並べる
          if ((res.date ?? '') !== (item.date ?? '')) {
            const target = listOf(res.date).filter((i) => i.id !== item.id);
            save(merge(fixOrders(target), asStarts(reflowSource(item)), { [item.id]: { ...res, order: target.length } }));
          } else {
            store.updateScheduleItem(groupId, ev.id, item.id, res).catch(showError);
          }
        },
      },
      day && i > 0 && { label: '↑ 上へ（時刻を詰め直す）', onClick: () => move(item, -1) },
      day && i < day.length - 1 && { label: '↓ 下へ（時刻を詰め直す）', onClick: () => move(item, 1) },
      item.date && days.length > 1 && { label: '📅 別の日へ移動', onClick: () => moveToDay(item) },
      item.date
        ? { label: '💡 行きたい候補に戻す', onClick: () => appendTo(item, null) }
        : { label: '📅 日程に入れる', onClick: () => scheduleInto(item) },
      {
        label: '削除',
        danger: true,
        onClick: async () => {
          if (await confirmSheet(`「${item.title}」を削除しますか？`)) store.deleteScheduleItem(groupId, ev.id, item.id).catch(showError);
        },
      },
    ].filter(Boolean));
  };

  const details = (item) =>
    (item.place || item.memo || item.links?.length > 0) &&
    h(
      'span',
      { class: 'sch-details' },
      item.place && h('a', { class: 'sch-place', href: mapsUrl(item.place), target: '_blank', rel: 'noopener', onClick: (e) => e.stopPropagation() }, `📍${item.place}`),
      item.memo && h('span', { class: 'sch-memo' }, item.memo),
      linkChips(item.links),
    );

  const timedRow = (item, day, { scaled = false, compact = false } = {}) => {
    const dur = item.duration ?? DEFAULT_DURATION;
    // 1 日の画面では、カレンダーのように長さに比例した高さにする（1 時間 ≒ 64px）。時間未定の予定は高さ固定
    const height = scaled && item.start ? Math.min(Math.max(Math.round((dur / 60) * 64), 52), 280) : null;
    const hint = !item.start && day ? untimedHint(day, item) : null;
    return h(
      'li',
      { class: `sch-item${scaled && item.start ? ' scaled' : ''}${item.start ? '' : ' untimed'}${compact ? ' compact' : ''}`, 'data-id': item.id, style: height ? `min-height:${height}px` : null },
      day && h('span', { class: 'sch-handle', 'aria-label': `${item.title} をドラッグして移動`, title: 'ドラッグして移動' }, '⠿'),
      item.start
        ? h('span', { class: 'sch-time' }, h('span', {}, fmtTime(toMin(item.start))), h('span', { class: 'sch-end' }, `–${fmtTime(endOf(item))}`))
        : h('span', { class: 'sch-time untimed' }, h('span', {}, '時間未定'), hint && h('span', { class: 'sch-end' }, `${hint}以降`)),
      h('span', { class: 'sch-main' }, h('span', { class: 'sch-title' }, item.title), !compact && details(item)),
      h('button', { class: 'sch-more', 'aria-label': `${item.title} のメニュー`, onClick: () => itemMenu(item, day) }, '⋮'),
    );
  };

  const candidateRow = (item) =>
    h(
      'li',
      { class: 'sch-item candidate', 'data-id': item.id },
      h('span', { class: 'sch-handle', 'aria-label': `${item.title} をドラッグして移動`, title: 'ドラッグして移動' }, '⠿'),
      h('span', { class: 'sch-main' }, h('span', { class: 'sch-title' }, item.title), details(item)),
      h('button', { class: 'sch-plan', onClick: () => scheduleInto(item) }, '日程に入れる'),
      h('button', { class: 'sch-more', 'aria-label': `${item.title} のメニュー`, onClick: () => itemMenu(item, null) }, '⋮'),
    );

  const today = todayStr();
  const focus = focusDate ?? (days.length === 1 ? days[0] : null);

  // 1 日の画面：その日の予定（長さに比例した高さ）
  const focusBlock = (d) => {
    const day = dayItems(items, d);
    const timed = timedOf(day);
    return h(
      'div',
      { class: 'sch-day focus' },
      day.length > 0 &&
        h(
          'div',
          { class: 'sch-day-head' },
          h('span', { class: 'sch-day-date' }, `${day.length}件`, timed.length > 0 && ` ・ ${fmtTime(toMin(timed[0].start))}〜${fmtTime(endOf(timed[timed.length - 1]))}`),
        ),
      h('ul', { class: 'sch-list', 'data-drop': d }, day.map((it) => timedRow(it, day, { scaled: true }))),
      day.length === 0 && h('p', { class: 'empty small sch-empty' }, 'まだ予定がありません。下の「行きたい候補」から ⠿ で持ってくることもできます。'),
      h('button', { class: 'sch-add', onClick: () => add({ date: d }) }, '＋ 予定を追加'),
    );
  };

  // 全体の画面：日ごとのカード。日付の行をタップでその日の画面へ。
  // 予定は全部 ⠿ 付きの小さな行で並べ、別の日のカードへドラッグして移せる
  const dayCard = (d, n) => {
    const day = dayItems(items, d);
    const timed = timedOf(day);
    return h(
      'div',
      { class: `sch-day-card${d === today ? ' today' : ''}` },
      h(
        'a',
        { class: 'sch-card-head', href: `#/g/${groupId}/e/${ev.id}/d/${d}` },
        h('span', { class: 'sch-card-day' }, `${n + 1}日目`),
        h('span', { class: 'sch-day-date' }, fmtDate(d)),
        d === today && h('span', { class: 'event-badge ongoing' }, '今日'),
        h(
          'span',
          { class: 'sch-card-count' },
          day.length ? `${day.length}件` : 'まだ予定なし',
          timed.length > 0 && ` ・ ${fmtTime(toMin(timed[0].start))}〜${fmtTime(endOf(timed[timed.length - 1]))}`,
          ' ›',
        ),
      ),
      h('ul', { class: 'sch-list', 'data-drop': d }, day.map((it) => timedRow(it, day, { compact: true }))),
    );
  };

  // 行きたい候補：一番上に置き、見出しのタップで折りたためる（この端末で覚えておく）
  const candidatesBlock = (() => {
    const block = h(
      'div',
      { class: `sch-day candidates${prefs.get('candidatesCollapsed', false) ? ' collapsed' : ''}` },
      h(
        'button',
        {
          class: 'sch-day-head sch-collapse',
          'aria-expanded': String(!prefs.get('candidatesCollapsed', false)),
          onClick: (e) => {
            const collapsed = block.classList.toggle('collapsed');
            e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
            prefs.set('candidatesCollapsed', collapsed);
          },
        },
        h('span', {}, `💡 行きたい候補（日時未定）${candidates.length ? ` ${candidates.length}件` : ''}`),
        h('span', { class: 'sch-caret', 'aria-hidden': 'true' }, '▾'),
      ),
      h('ul', { class: 'sch-list', 'data-drop': '' }, candidates.map(candidateRow)),
      h('button', { class: 'sch-add', onClick: () => add({ date: null }) }, '＋ 候補を追加'),
    );
    return block;
  })();

  const section = h(
    'div',
    { class: `schedule${focus ? ' focus-mode' : ' overview'}` },
    candidatesBlock,
    focus ? focusBlock(focus) : h('div', { class: 'sch-day-cards' }, days.map(dayCard)),
    !focus &&
      outside.length > 0 &&
      h(
        'div',
        { class: 'sch-day' },
        h('div', { class: 'sch-day-head' }, h('span', {}, '⚠️ イベント期間外の予定')),
        h('ul', { class: 'sch-list' }, outside.map((it) => timedRow(it, null))),
      ),
    focus &&
      (items.some((i) => i.date === focus) || candidates.length > 0) &&
      h('p', { class: 'sch-hint' }, `⠿ を押したまま動かすと、順番の入れ替えや候補との行き来ができます（時刻は自動で詰め直します）。${days.length > 1 ? '別の日へは ⋮ →「別の日へ移動」から。' : ''}`),
    !focus && h('p', { class: 'sch-hint' }, '⠿ を押したまま別の日へ動かすと、予定をその日へ移せます。日付の行をタップすると、その日の予定を時間の長さどおりに表示して、細かい並べ替えや追加ができます。'),
  );
  enableScheduleDrag(section, onDrop);
  return section;
}

// ---- 取り込み元のリストを選ぶシート ----
// 日常のリストと、イベント（新しい順）のリストから選ぶ

async function pickSourceList(groupId, { excludeListId, title }) {
  let lists, events;
  try {
    [lists, events] = await Promise.all([store.fetchLists(groupId), store.fetchEvents(groupId)]);
  } catch (e) {
    showError(e);
    return null;
  }
  lists = lists.filter((l) => l.id !== excludeListId && l.total > 0 && (l.type ?? 'checklist') === 'checklist');
  if (lists.length === 0) {
    toast('取り込めるリストがありません（アイテムのあるリストがまだありません）');
    return null;
  }
  const daily = lists.filter((l) => !l.eventId);
  const byEvent = [...events]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((ev) => ({ ev, lists: lists.filter((l) => l.eventId === ev.id) }))
    .filter((x) => x.lists.length);

  return openSheet((close) => {
    const row = (l) =>
      h(
        'button',
        { class: 'source-row', onClick: () => close(l) },
        h('span', { class: 'source-emoji' }, l.emoji),
        h('span', { class: 'source-title' }, l.title),
        h('span', { class: 'source-count' }, `${l.total}件`),
      );
    return [
      h('div', { class: 'sheet-title' }, title),
      h(
        'div',
        { class: 'source-list' },
        daily.length > 0 && h('p', { class: 'source-group' }, '🏡 日常'),
        daily.map(row),
        byEvent.map(({ ev, lists: ls }) => [h('p', { class: 'source-group' }, `${ev.emoji} ${ev.title}（${fmtRange(ev)}）`), ls.map(row)]),
      ),
      h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, 'キャンセル'),
    ];
  });
}

// ---- 取り込むアイテムを選ぶシート ----
// すでに同じ名前のアイテムがあるものは、最初はチェックを外しておく

function pickItems(source, existingTexts = []) {
  const existing = new Set(existingTexts.map((t) => t.trim()));
  const state = source.items.map((i) => ({ text: i.text, selected: !existing.has(i.text.trim()), dup: existing.has(i.text.trim()) }));
  return openSheet((close) => {
    const okBtn = h('button', { type: 'button', class: 'btn primary' });
    const refresh = () => {
      const n = state.filter((x) => x.selected).length;
      okBtn.textContent = `${n}件を追加`;
      okBtn.disabled = n === 0;
    };
    refresh();
    okBtn.addEventListener('click', () => close(state.filter((x) => x.selected).map((x) => x.text)));
    return [
      h('div', { class: 'sheet-title' }, `「${source.title}」から追加`),
      h(
        'ul',
        { class: 'items pick-items' },
        state.map((x) =>
          h(
            'li',
            { class: 'item' },
            h(
              'label',
              { class: 'item-label' },
              h('input', {
                type: 'checkbox',
                class: 'item-check',
                checked: x.selected,
                onChange: (e) => {
                  x.selected = e.target.checked;
                  refresh();
                },
              }),
              h('span', { class: 'item-text' }, x.text),
              x.dup && h('span', { class: 'badge muted' }, '追加済み'),
            ),
          ),
        ),
      ),
      h('div', { class: 'sheet-buttons' }, h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'キャンセル'), okBtn),
    ];
  });
}

// ---- リストを追加（新規 or 取り込み） ----

function addListMenu(groupId, eventId = null) {
  actionSheet('リストを追加', [
    {
      label: '新しいチェックリストを作る',
      onClick: async () => {
        const res = await askText({ title: '新しいチェックリスト', placeholder: eventId ? '例：持ち物' : '例：日用品の在庫', okLabel: '作成', emojis: LIST_EMOJIS });
        if (res) store.createList(groupId, { title: res.text, emoji: res.emoji, eventId }).then((id) => (location.hash = `#/g/${groupId}/l/${id}`), showError);
      },
    },
    ...WISH_TEMPLATES.map((t) => ({
      label: `${t.emoji} ${t.title}リストを作る`,
      onClick: async () => {
        const res = await askText({ title: `新しい${t.title}リスト`, value: t.title, placeholder: `例：${t.title}`, okLabel: '作成' });
        if (res) store.createList(groupId, { title: res, emoji: t.emoji, type: 'wish', variant: t.variant, eventId }).then((id) => (location.hash = `#/g/${groupId}/l/${id}`), showError);
      },
    })),
    {
      label: '💰 貸し借りリストを作る',
      onClick: async () => {
        const res = await askText({ title: '新しい貸し借りリスト', value: eventId ? '旅行の立て替え' : 'お金・ものの貸し借り', placeholder: '例：旅行の立て替え', okLabel: '作成' });
        if (res) store.createList(groupId, { title: res, emoji: '💰', type: 'money', eventId }).then((id) => (location.hash = `#/g/${groupId}/l/${id}`), showError);
      },
    },
    {
      label: 'ほかのリストを丸ごと取り込む',
      onClick: async () => {
        const source = await pickSourceList(groupId, { title: '取り込むリストを選ぶ' });
        if (!source) return;
        store
          .copyListAsNew(groupId, source, { eventId })
          .then((id) => {
            toast(`「${source.title}」を取り込みました（チェックは外してあります）`);
            location.hash = `#/g/${groupId}/l/${id}`;
          }, showError);
      },
    },
  ]);
}

async function renameInGroup(group) {
  const current = group.members?.[user.uid]?.name ?? auth.displayName();
  const name = await askText({ title: `「${group.name}」での名前`, value: current, placeholder: '例：パパ、たろう', okLabel: '保存' });
  if (name && name !== current) store.renameMeInGroup(group.id, name).then(() => toast('名前を変更しました'), showError);
}

// オーナーがメンバーの行をタップしたときのメニュー
function memberMenu(group, memberUid, m) {
  actionSheet(m.name, [
    {
      label: 'このグループから外す',
      danger: true,
      onClick: async () => {
        const ok = await confirmSheet(
          `${m.name} さんを「${group.name}」から外しますか？ 外された人は、このグループを見られなくなります。（招待リンクがあれば再参加できるので、参加させたくない場合は「招待リンクを作り直す」もしてください）`,
          '外す',
        );
        if (ok) store.removeMember(group.id, memberUid).then(() => toast(`${m.name} さんを外しました`), showError);
      },
    },
  ]);
}

// 自分からグループを抜ける（オーナー以外）
async function leaveGroup(group) {
  const ok = await confirmSheet(`「${group.name}」から退出しますか？ 退出すると、このグループを見られなくなります。（招待リンクがあれば再参加できます）`, '退出する');
  if (!ok) return;
  try {
    await store.removeMember(group.id, user.uid);
  } catch (e) {
    return showError(e);
  }
  toast(`「${group.name}」から退出しました`);
  location.hash = '#/';
}

function membersSheet(group, recoveryCodes = {}) {
  const isOwner = group.members?.[user.uid]?.role === 'owner';
  const members = Object.entries(group.members ?? {}).sort(
    (a, b) => store.millis(b[1].lastSeen) - store.millis(a[1].lastSeen) || (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0),
  );
  openSheet((close) => [
    h('div', { class: 'sheet-title' }, `メンバー（${members.length} 人）`),
    h(
      'ul',
      { class: 'member-list' },
      members.map(([id, m]) =>
        h(
          'li',
          id === user.uid
            ? { class: 'is-me', onClick: () => (close(null), renameInGroup(group)) }
            : isOwner && m.role !== 'owner'
              ? { class: 'is-tappable', onClick: () => (close(null), memberMenu(group, id, m)) }
              : {},
          onlineDot(store.isOnline(m.lastSeen)),
          h(
            'span',
            { class: 'member-name' },
            h('span', {}, m.name, id === user.uid && '（自分）'),
            h('span', { class: 'member-seen' }, store.isOnline(m.lastSeen) ? 'オンライン' : timeAgo(store.millis(m.lastSeen))),
          ),
          m.role === 'owner' && h('span', { class: 'badge' }, 'オーナー'),
          m.guest && h('span', { class: 'badge muted' }, 'ゲスト'),
          id === user.uid && h('span', { class: 'edit-hint' }, '変更'),
          isOwner && id !== user.uid && m.role !== 'owner' && h('span', { class: 'chevron' }, '›'),
          // オーナーはゲストの復旧ID を確認・発行できる
          isOwner &&
            id !== user.uid &&
            m.guest &&
            h(
              'button',
              {
                class: 'recovery-btn',
                onClick: async (e) => {
                  e.stopPropagation();
                  close(null);
                  let code = recoveryCodes[id];
                  if (!code) {
                    try {
                      code = await store.issueRecoveryCode(group.id, id, m.name);
                    } catch (err) {
                      return showError(err);
                    }
                  }
                  recoveryCodeSheet(`${m.name} さんの復旧ID`, code, `${m.name} さんがスマホをなくしたら、新しいスマホでこのQRを読み取るか、IDを入力してもらってください。`);
                },
              },
              recoveryCodes[id] ? '復旧ID' : '復旧IDを発行',
            ),
        ),
      ),
    ),
    h('button', { class: 'sheet-action', onClick: () => (close(null), inviteQrSheet(group)) }, '＋ メンバーを招待（QRコード）'),
    h('button', { class: 'sheet-action', onClick: () => (close(null), renameInGroup(group)) }, 'このグループでの自分の名前を変更'),
    h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, '閉じる'),
  ]);
}

function inviteQrSheet(group) {
  const url = store.inviteUrl(group);
  openSheet((close) => [
    h('div', { class: 'sheet-title' }, `「${group.name}」への招待`),
    h('div', { class: 'qr-sheet' }, qrCode(url, 220), h('p', {}, 'カメラで読み取ると、このグループに参加できます')),
    h(
      'button',
      {
        class: 'sheet-action',
        onClick: async () => {
          await navigator.clipboard.writeText(url).catch(() => {});
          toast('招待リンクをコピーしました');
        },
      },
      'リンクをコピー',
    ),
    h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, '閉じる'),
  ]);
}

async function shareInvite(group) {
  const url = store.inviteUrl(group);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'ouchi-share', text: `「${group.name}」に招待されました`, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  await navigator.clipboard.writeText(url).catch(() => {});
  toast('招待リンクをコピーしました');
}

function groupView(root, { groupId }) {
  const top = h('div', { class: 'topbar-wrap' });
  const body = h('main', { class: 'content' });
  root.append(top, body);
  let group;

  // ヘッダーの「⋯」のとなりのメンバーボタン（人数とオンライン人数）。オンライン表示は時間で変わるので定期的に描き直す
  const memberPill = h('button', { class: 'member-pill', onClick: () => group && membersSheet(group, recoveryCodes) });
  function renderMembers() {
    if (!group) return;
    const all = Object.values(group.members ?? {});
    const online = all.filter((m) => store.isOnline(m.lastSeen));
    memberPill.setAttribute('aria-label', `メンバー ${all.length} 人、${online.length} 人がオンライン`);
    setChildren(memberPill, h('span', {}, `👥${all.length}`), online.length > 0 && h('span', { class: 'pill-online' }, onlineDot(true), online.length));
  }
  const ticker = setInterval(renderMembers, 30 * 1000);

  // オーナーはゲストの復旧ID を見られる。ゲストは自分の復旧ID がなければ作る
  let recoveryCodes = {};
  let unwatchRecovery = null;
  if (auth.isGuest()) store.ensureRecoveryCode(groupId).catch(() => {});

  const onGone = (e) => {
    if (e?.code !== 'permission-denied' && e?.message !== 'not-found') return showError(e);
    toast('グループが見つかりません');
    location.hash = '#/';
  };

  const unwatchGroup = store.watchGroup(
    groupId,
    (g) => {
      group = g;
      groupMembers[groupId] = memberList(g);
      const owner = g.members?.[user.uid]?.role === 'owner';
      if (owner && !unwatchRecovery) {
        unwatchRecovery = store.watchRecoveryCodes(groupId, (codes) => (recoveryCodes = codes), () => {});
      }
      setChildren(
        top,
        header({
          title: g.name,
          back: '#/',
          extra: memberPill,
          // コピーしたリンクの登録は、どのタブからでもすぐ使えるようにヘッダーに置く
          extraLeft: h(
            'button',
            { class: 'register-link', 'aria-label': 'コピーしたリンクを登録', title: 'コピーしたリンクを登録', onClick: () => lists && registerLink(groupId, lists, events ?? []) },
            '📋 登録',
          ),
          onMenu: () =>
            actionSheet(g.name, [
              {
                label: `📢 お知らせ${unreadNewsCount(`g:${groupId}`) ? `（未読${unreadNewsCount(`g:${groupId}`)}）` : ''}`,
                onClick: () => (location.hash = `#/g/${groupId}/news`),
              },
              { label: '招待QRコードを表示', onClick: () => inviteQrSheet(group) },
              { label: '招待リンクを送る', onClick: () => shareInvite(group) },
              { label: 'メンバーを見る', onClick: () => membersSheet(group, recoveryCodes) },
              { label: 'このグループでの自分の名前を変更', onClick: () => renameInGroup(group) },
              {
                label: 'グループ名を変更',
                onClick: async () => {
                  const name = await askText({ title: 'グループ名を変更', value: group.name, okLabel: '保存' });
                  if (name) store.renameGroup(groupId, name).catch(showError);
                },
              },
              owner && {
                label: '招待リンクを作り直す',
                onClick: async () => {
                  if (await confirmSheet('今までの招待リンクは使えなくなります（参加済みのメンバーはそのまま）。作り直しますか？', '作り直す')) {
                    store.regenerateInvite(groupId).then(() => toast('招待リンクを作り直しました'), showError);
                  }
                },
              },
              !owner && { label: 'グループから退出', danger: true, onClick: () => leaveGroup(group) },
              owner && {
                label: 'グループを削除',
                danger: true,
                onClick: async () => {
                  if (await confirmSheet(`「${group.name}」と中のリストをすべて削除します。メンバー全員が見られなくなります。削除しますか？`)) {
                    store.deleteGroup(groupId).then(() => (location.hash = '#/'), showError);
                  }
                },
              },
            ].filter(Boolean)),
        }),
      );
      renderMembers();
      renderBody();
    },
    onGone,
  );

  let lists = null;
  let events = null;
  let plans = null;
  let showPast = false;

  function renderBody() {
    if (!group || !lists || !events || !plans) return;
    const checklists = lists.filter((l) => isShownList(l));
    const daily = checklists.filter((l) => !l.eventId);
    const { active, past } = sortEvents(events);
    const eventCard = (ev) => {
      const st = eventStatus(ev);
      const evLists = checklists.filter((l) => l.eventId === ev.id);
      // 進み具合はチェックリストだけで数える
      const progressLists = evLists.filter((l) => (l.type ?? 'checklist') === 'checklist');
      const total = progressLists.reduce((n, l) => n + l.total, 0);
      const done = progressLists.reduce((n, l) => n + l.done, 0);
      const plans = lists.find((l) => l.id === store.scheduleId(ev.id))?.items.filter((i) => i.date).length ?? 0;
      return h(
        'a',
        { class: `card event-card ${st.kind}`, href: `#/g/${groupId}/e/${ev.id}` },
        h('span', { class: 'card-icon' }, ev.emoji),
        h(
          'span',
          { class: 'card-main' },
          h('span', { class: 'card-title' }, ev.title),
          h('span', { class: 'card-sub' }, fmtRange(ev), plans > 0 && ` ・ 予定${plans}件`, evLists.length > 0 && ` ・ リスト${evLists.length}個`),
          total > 0 && progressBar(done, total),
        ),
        h('span', { class: `event-badge ${st.kind}` }, st.label),
      );
    };
    // カレンダー・イベント・リストはタブで切り替える（最後に開いたタブを端末に保存）
    const tabKey = `groupTab:${groupId}`;
    const tab = ['calendar', 'events', 'lists'].includes(prefs.get(tabKey)) ? prefs.get(tabKey) : 'calendar';
    const tabBtn = (id, label, count = 0) =>
      h(
        'button',
        {
          class: `tab${tab === id ? ' active' : ''}`,
          role: 'tab',
          'aria-selected': String(tab === id),
          onClick: () => {
            if (tab === id) return;
            prefs.set(tabKey, id);
            renderBody();
          },
        },
        label,
        count > 0 && h('span', { class: 'tab-count' }, count),
      );
    const tabs = h(
      'div',
      { class: 'tabs', role: 'tablist' },
      tabBtn('calendar', '📅 カレンダー'),
      tabBtn('events', '✈️ イベント', active.length),
      tabBtn('lists', '📝 リスト', daily.length),
    );
    if (tab === 'calendar') {
      setChildren(body, tabs, calendarSection({ groupId, group, events, lists, plans, rerender: renderBody }));
      return;
    }
    if (tab === 'lists') {
      setChildren(
        body,
        tabs,
        daily.length === 0 && h('p', { class: 'empty small' }, '日用品の在庫や、やることリストなど、イベントに関係ないリストを置けます。'),
        h('div', { class: 'card-list' }, daily.map((l) => listCard(groupId, l))),
        h('button', { class: 'add-card', onClick: () => addListMenu(groupId) }, '＋ リストを追加'),
      );
      return;
    }
    setChildren(
      body,
      tabs,
      active.length === 0 && h('p', { class: 'empty small' }, '予定しているイベントはありません'),
      h('div', { class: 'card-list' }, active.map(eventCard)),
      past.length > 0 &&
        h(
          'button',
          {
            class: 'past-toggle',
            onClick: () => {
              showPast = !showPast;
              renderBody();
            },
          },
          `${showPast ? '▾' : '▸'} 過去のイベント（${past.length}）`,
        ),
      showPast && h('div', { class: 'card-list' }, past.map(eventCard)),
      h(
        'button',
        {
          class: 'add-card',
          onClick: async () => {
            const res = await eventSheet({}, '作成', memberList(group));
            if (!res) return;
            store.createEvent(groupId, res).then((id) => {
              requestNotify({
                groupId,
                kind: 'plan',
                title: `📅 ${group.name}`,
                body: `${auth.displayName()}さんがイベント「${res.emoji} ${res.title}」（${fmtRange(res)}）を追加しました`,
                url: `#/g/${groupId}/e/${id}`,
                participants: res.participants ?? [],
              });
              location.hash = `#/g/${groupId}/e/${id}`;
            }, showError);
          },
        },
        '＋ イベントを作成',
      ),
    );
  }

  const unwatchLists = store.watchLists(
    groupId,
    (ls) => {
      lists = ls;
      renderBody();
    },
    onGone,
  );
  // イベントが読めなくても（ルール未反映など）日常のリストは使えるように、エラー時は空として扱う
  const unwatchEvents = store.watchEvents(
    groupId,
    (evs) => {
      events = evs;
      renderBody();
    },
    (e) => {
      console.warn('イベントを読み込めませんでした', e);
      events = [];
      renderBody();
    },
  );

  // 普段の予定（カレンダー）。読めなくてもほかは使えるように、エラー時は空として扱う
  // グループのお知らせ：グループを開いたときに未読があればポップアップ（checkNews が順に出す）
  const newsSourceId = `g:${groupId}`;
  const unwatchNews = store.watchGroupNews(
    groupId,
    (list) =>
      setNewsSource(
        newsSourceId,
        list.map((n) => ({ ...n, key: `g:${groupId}:${n.id}`, sourceId: newsSourceId, sourceName: group?.name ?? 'グループ' })),
      ),
    () => {},
  );

  const unwatchPlans = store.watchPlans(
    groupId,
    (ps) => {
      plans = ps;
      renderBody();
    },
    (e) => {
      console.warn('予定を読み込めませんでした', e);
      plans = [];
      renderBody();
    },
  );

  return () => {
    clearInterval(ticker);
    unwatchRecovery?.();
    unwatchGroup();
    unwatchLists();
    unwatchEvents();
    unwatchPlans();
    unwatchNews();
    clearNewsSource(newsSourceId);
  };
}

// ---- 参加者 ----
// イベントと普段の予定は participants（uid の配列）を持つ。空なら「全員」

function memberList(group) {
  return Object.entries(group?.members ?? {})
    .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0))
    .map(([uid, m]) => ({ uid, name: m.name }));
}

function participantsLabel(members, participants) {
  if (!participants?.length) return '全員';
  return participants.map((u) => members.find((m) => m.uid === u)?.name ?? '（退出したメンバー）').join('、');
}

function participantPicker(members, selected = []) {
  const chosen = new Set(selected.filter((u) => members.some((m) => m.uid === u)));
  const box = h('div', { class: 'people-picker' });
  const render = () =>
    setChildren(
      box,
      h('span', { class: 'links-label' }, '参加者（選ばなければ全員）'),
      h(
        'div',
        { class: 'people-chips' },
        h(
          'button',
          {
            type: 'button',
            class: `chip${chosen.size === 0 ? ' on' : ''}`,
            onClick: () => {
              chosen.clear();
              render();
            },
          },
          '👥 全員',
        ),
        members.map((m) =>
          h(
            'button',
            {
              type: 'button',
              class: `chip${chosen.has(m.uid) ? ' on' : ''}`,
              onClick: () => {
                if (chosen.has(m.uid)) chosen.delete(m.uid);
                else chosen.add(m.uid);
                render();
              },
            },
            m.uid === user.uid ? `${m.name}（自分）` : m.name,
          ),
        ),
      ),
    );
  render();
  return { el: box, value: () => [...chosen] };
}

// ---- 普段の予定（歯医者など）の追加・編集シート ----

// initial.dates（2 日以上）を渡すと、その日すべてに同じ予定を入れる（結果の dates）。
// 連続した日なら「1 つの予定（開始日〜終わりの日）にする」も選べる。
// 何日か続く予定は endDate（終わりの日）を持ち、終日扱い（start は null）。カレンダーでは帯で表示する
function planSheet(members, initial = {}, { editing = false } = {}) {
  const multiDates = !editing && initial.dates?.length > 1 ? [...initial.dates].sort() : null;
  const consecutive = !!multiDates && multiDates.every((d, i) => i === 0 || addDays(multiDates[i - 1], 1) === d);
  return openSheet((close) => {
    const title = h('input', { class: 'text-input', value: initial.title ?? '', placeholder: '例：歯医者', maxlength: 100, 'aria-label': 'タイトル' });
    const date = h('input', { class: 'text-input', type: 'date', value: initial.date ?? todayStr(), 'aria-label': '日にち' });
    // 日付を決めない（「📌 日付未定の予定」に入る）。編集のときは今の状態から
    const noDate = h('input', { type: 'checkbox', checked: editing && !initial.date });
    const allDay = h('input', { type: 'checkbox', checked: editing && !initial.start });
    const start = h('input', { class: 'text-input', type: 'time', step: 300, value: initial.start ?? '10:00', 'aria-label': '開始時刻' });
    const duration = h(
      'select',
      { class: 'text-input', 'aria-label': '長さ' },
      [...new Set([...DURATIONS, initial.duration ?? DEFAULT_DURATION])].sort((a, b) => a - b).map((m) => h('option', { value: m }, fmtDuration(m))),
    );
    duration.value = String(initial.duration ?? DEFAULT_DURATION);
    const timeRow = h('div', { class: 'date-row' }, h('label', {}, '開始', start), h('label', {}, '長さ', duration));
    const allDayRow = h('label', { class: 'check-row' }, allDay, h('span', {}, '終日（時刻を決めない）'));
    const noDateRow = h('label', { class: 'check-row' }, noDate, h('span', {}, '日付を決めない（あとで決める）'));
    // 何日か続く（終わりの日）
    const hasEnd = !!initial.endDate && initial.endDate > (initial.date ?? '');
    const multiDay = h('input', { type: 'checkbox', checked: editing && hasEnd });
    const endDate = h('input', { class: 'text-input', type: 'date', value: hasEnd ? initial.endDate : addDays(initial.date ?? todayStr(), 1), 'aria-label': '終わりの日' });
    const multiDayRow = h('label', { class: 'check-row' }, multiDay, h('span', {}, '何日か続く（終わりの日を入れる）'));
    const endRow = h('label', { class: 'end-date-row' }, h('span', {}, '〜 終わりの日'), endDate);
    // 複数選択した日：連続していれば「1 つの予定にする」が初期値
    let spanMode = consecutive;
    const modeChips = consecutive && h('div', { class: 'people-chips' });
    const datesBox = multiDates && h('div', { class: 'multi-dates' }, h('b', {}), h('span', {}), modeChips);
    const sync = () => {
      if (multiDates) {
        const span = spanMode;
        datesBox.children[0].textContent = span ? `📅 ${fmtDate(multiDates[0])} 〜 ${fmtDate(multiDates.at(-1))}（${multiDates.length}日間）` : `📅 ${multiDates.length}日に追加`;
        datesBox.children[1].textContent = span ? '1 つの予定として、カレンダーに帯で表示します' : multiDates.map(fmtDate).join('・');
        if (modeChips) {
          setChildren(
            modeChips,
            [
              [true, '1 つの予定にする'],
              [false, 'それぞれの日に入れる'],
            ].map(([v, label]) =>
              h(
                'button',
                {
                  type: 'button',
                  class: `chip${spanMode === v ? ' on' : ''}`,
                  onClick: () => {
                    spanMode = v;
                    sync();
                  },
                },
                label,
              ),
            ),
          );
        }
      }
      const span = multiDates ? spanMode : !noDate.checked && multiDay.checked;
      noDateRow.style.display = multiDates ? 'none' : '';
      date.style.display = noDate.checked || multiDates ? 'none' : '';
      multiDayRow.style.display = noDate.checked || multiDates ? 'none' : '';
      endRow.style.display = !multiDates && !noDate.checked && multiDay.checked ? '' : 'none';
      allDayRow.style.display = noDate.checked || span ? 'none' : '';
      timeRow.style.display = noDate.checked || allDay.checked || span ? 'none' : '';
    };
    noDate.addEventListener('change', sync);
    allDay.addEventListener('change', sync);
    multiDay.addEventListener('change', () => {
      if (multiDay.checked && date.value && endDate.value <= date.value) endDate.value = addDays(date.value, 1);
      sync();
    });
    sync();
    const place = h('input', { class: 'text-input', value: initial.place ?? '', placeholder: '場所（例：〇〇歯科）', maxlength: 100, 'aria-label': '場所' });
    const memo = h('textarea', { class: 'text-input memo-input', placeholder: 'メモ', maxlength: 500, rows: 2, 'aria-label': 'メモ' }, initial.memo ?? '');
    const linksEdit = linksEditor(initial.links);
    const people = participantPicker(members, initial.participants ?? []);
    return [
      h('div', { class: 'sheet-title' }, editing ? '予定を編集' : '予定を追加'),
      h(
        'form',
        {
          class: 'sheet-form',
          onSubmit: (e) => {
            e.preventDefault();
            const t = title.value.trim();
            if (!t) return title.focus();
            const dated = !noDate.checked || !!multiDates;
            if (dated && !multiDates && !date.value) return toast('日にちを入れてください（決めない場合は「日付を決めない」）');
            const span = multiDates ? spanMode : dated && multiDay.checked;
            const end = multiDates ? multiDates.at(-1) : endDate.value;
            if (span && !multiDates && !(end > date.value)) return toast('終わりの日は、始まりの日より後にしてください');
            if (dated && !span && !allDay.checked && !start.value) return toast('開始時刻を入れてください');
            const links = linksEdit.value();
            if (!links) return;
            close({
              title: t,
              ...(multiDates && !span ? { dates: multiDates } : {}),
              date: multiDates ? multiDates[0] : dated ? date.value : null,
              endDate: span ? end : null,
              start: dated && !span && !allDay.checked ? start.value : null,
              duration: Number(duration.value),
              place: place.value.trim(),
              memo: memo.value.trim(),
              links,
              participants: people.value(),
            });
          },
        },
        title,
        datesBox,
        noDateRow,
        date,
        multiDayRow,
        endRow,
        allDayRow,
        timeRow,
        place,
        memo,
        linksEdit.el,
        people.el,
        h(
          'div',
          { class: 'sheet-buttons' },
          h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn primary' }, editing ? '保存' : '追加'),
        ),
      ),
    ];
  });
}

// ---- カレンダー ----
// 月の表示：イベントは期間の帯、旅程の予定と普段の予定は日ごとの点。日をタップすると下にその日の一覧。
// 表示している範囲・選んでいる日は画面を描き直しても保つ（グループごと）。人の絞り込みは端末に保存。
// 表示範囲は「先頭の週の日曜日」と「週の数」で持つ。‹ › は月単位（その月の 1 日を含む週から）、−2週 / +2週 は 2 週ずつずらす。

const calState = {};

// 月ごとの季節の色と絵文字（見出し・曜日の帯・枠に付けて、何月を見ているか分かりやすくする）
const SEASONS = [
  ['#d0453c', '🎍'], // 1 月：お正月
  ['#d9608a', '🌺'], // 2 月：梅
  ['#d4a800', '🌼'], // 3 月：菜の花
  ['#e57fa3', '🌸'], // 4 月：桜
  ['#43a047', '🌿'], // 5 月：新緑
  ['#7e66c9', '☔'], // 6 月：紫陽花
  ['#1e96d2', '🌊'], // 7 月：海
  ['#f29a0c', '🌻'], // 8 月：ひまわり
  ['#a8873a', '🎑'], // 9 月：すすき・お月見
  ['#ec7424', '🎃'], // 10 月：柿・ハロウィン
  ['#c2412d', '🍁'], // 11 月：紅葉
  ['#2e8a5c', '🎄'], // 12 月：クリスマス
];

// その月の 1 日を含む週の日曜日から、月末を含む週の土曜日までを表示する範囲
function monthView(month) {
  const first = new Date(`${month}-01T00:00:00`);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  return { start: dateStr(start), weeks };
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(str, n) {
  const d = new Date(`${str}T00:00:00`);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

function calendarSection({ groupId, group, events, lists, plans, rerender }) {
  const today = todayStr();
  const state = (calState[groupId] ??= { ...monthView(today.slice(0, 7)), selected: today });
  const members = memberList(group);
  let filter = prefs.get(`calFilter:${groupId}`, 'all');
  if (filter !== 'all' && !members.some((m) => m.uid === filter)) filter = 'all';
  const visible = (participants) => filter === 'all' || !participants?.length || participants.includes(filter);

  const evs = events.filter((e) => visible(e.participants));
  const schedItems = evs.flatMap((ev) =>
    (lists.find((l) => l.id === store.scheduleId(ev.id))?.items ?? []).filter((i) => i.date).map((item) => ({ ev, item })),
  );
  const ps = plans.filter((p) => visible(p.participants));
  // 何日か続く普段の予定は、イベントと同じく帯で表示する（点は付けない）
  const isSpan = (p) => !!p.date && !!p.endDate && p.endDate > p.date;
  const spanPlans = ps.filter(isSpan);
  const dotsOn = (d) => schedItems.filter((x) => x.item.date === d).length + ps.filter((p) => p.date === d && !isSpan(p)).length;

  // 表示範囲の真ん中の日がある月を「表示中の月」とする（見出しと、薄く表示する日の基準）
  const mid = addDays(state.start, Math.floor((state.weeks * 7) / 2));
  const viewMonth = mid.slice(0, 7);
  const weeks = Array.from({ length: state.weeks }, (_, i) => addDays(state.start, i * 7));
  const viewEnd = addDays(state.start, state.weeks * 7 - 1);

  // 日をタップしても表示範囲は動かさない（2 週ずらした表示のまま選べるように）
  const select = (d) => {
    state.selected = d;
    rerender();
  };
  // 日付の複数選択（長押しで始める）。選んでいる間は state.multi に日付の配列
  const toggleMulti = (d) => {
    state.multi = state.multi?.includes(d) ? state.multi.filter((x) => x !== d) : [...(state.multi ?? []), d];
    rerender();
  };
  const endMulti = () => {
    state.multi = null;
    rerender();
  };
  // 選んだ日は、つながった 1 本の帯に見せる。左右（同じ週）のとなりも選ばれていれば pick-l / pick-r（その側は丸めない）
  const pickClasses = (d, picked = state.multi) => {
    if (!picked?.includes(d)) return [];
    const dow = new Date(`${d}T00:00:00`).getDay();
    return ['picked', dow > 0 && picked.includes(addDays(d, -1)) && 'pick-l', dow < 6 && picked.includes(addDays(d, 1)) && 'pick-r'].filter(Boolean);
  };
  // タップ：選んでいる日をもう一度タップすると、その日の予定の追加へ。複数選択中は選ぶ・外す
  const tapDay = (d) => {
    if (Date.now() < calPick.ignoreTapUntil) return;
    if (state.multi) return toggleMulti(d);
    if (d === state.selected) return addPlan();
    select(d);
  };
  const monthOf = (n) => {
    const d = new Date(`${viewMonth}-01T00:00:00`);
    d.setMonth(d.getMonth() + n);
    return dateStr(d).slice(0, 7);
  };
  const shiftMonth = (n) => {
    Object.assign(state, monthView(monthOf(n)));
    rerender();
  };
  const shiftWeeks = (n) => {
    state.start = addDays(state.start, n * 7);
    rerender();
  };
  const goToday = () => {
    Object.assign(state, monthView(today.slice(0, 7)), { selected: today });
    rerender();
  };

  const MAX_LANES = 3;
  // vm：その表の月（ほかの月の日を薄くする基準）。となりの月の表にも使う
  const weekRow = (ws, vm = viewMonth) => {
    const we = addDays(ws, 6);
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    // 帯：週と重なるイベントを、空いている段に順に置く
    const bars = [...evs.map((e) => ({ ...e, kind: 'event' })), ...spanPlans.map((p) => ({ startDate: p.date, endDate: p.endDate, emoji: '📅', title: p.title, kind: 'plan' }))];
    const segs = bars
      .filter((e) => e.startDate <= we && e.endDate >= ws)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || b.endDate.localeCompare(a.endDate))
      .map((e) => ({ e, s: daysBetween(ws, e.startDate > ws ? e.startDate : ws), t: daysBetween(ws, e.endDate < we ? e.endDate : we) }));
    const laneEnds = [];
    const hidden = Array(7).fill(0);
    for (const seg of segs) {
      let lane = laneEnds.findIndex((end) => end < seg.s);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = seg.t;
      seg.lane = lane;
      if (lane >= MAX_LANES) for (let i = seg.s; i <= seg.t; i++) hidden[i]++;
    }
    const lanes = Math.min(laneEnds.length, MAX_LANES);
    return h(
      'div',
      { class: 'cal-week', style: `grid-template-rows: 26px repeat(${lanes}, 18px) 14px` },
      days.map((d, i) =>
        h(
          'button',
          {
            class: `cal-day${d.slice(0, 7) !== vm ? ' other' : ''}${d === today ? ' today' : ''}${d === state.selected && !state.multi ? ' selected' : ''}${pickClasses(d).map((c) => ` ${c}`).join('')}${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`,
            style: `grid-column: ${i + 1}; grid-row: 1 / -1`,
            'aria-label': fmtDate(d),
            'data-date': d,
            onClick: () => tapDay(d),
          },
          h('span', { class: 'cal-num' }, Number(d.slice(8))),
        ),
      ),
      segs
        .filter((seg) => seg.lane < MAX_LANES)
        .map((seg) =>
          h(
            'span',
            {
              class: `cal-bar${seg.e.kind === 'plan' ? ' plan' : ''}${seg.e.startDate >= ws ? ' head' : ''}${seg.e.endDate <= we ? ' tail' : ''}`,
              style: `grid-column: ${seg.s + 1} / ${seg.t + 2}; grid-row: ${seg.lane + 2}`,
            },
            `${seg.e.emoji} ${seg.e.title}`,
          ),
        ),
      days.map((d, i) => {
        const n = dotsOn(d);
        return (
          (n > 0 || hidden[i] > 0) &&
          h(
            'span',
            { class: 'cal-dots', style: `grid-column: ${i + 1}; grid-row: ${lanes + 2}` },
            Array.from({ length: Math.min(n, 3) }, () => h('i', {})),
            (n > 3 || hidden[i] > 0) && h('b', {}, '+'),
          )
        );
      }),
    );
  };

  // 選んだ日の一覧
  const sel = state.selected;
  const dayEvents = evs.filter((e) => e.startDate <= sel && e.endDate >= sel).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const daySched = schedItems.filter((x) => x.item.date === sel).sort((a, b) => a.ev.startDate.localeCompare(b.ev.startDate) || bySeq(a.item, b.item));
  const dayPlans = ps.filter((p) => p.date === sel || (isSpan(p) && p.date <= sel && p.endDate >= sel)).sort((a, b) => (a.start ?? '') .localeCompare(b.start ?? '') || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const eventHref = (ev, d) => (ev.startDate === ev.endDate || !d ? `#/g/${groupId}/e/${ev.id}` : `#/g/${groupId}/e/${ev.id}/d/${d}`);
  const timeText = (x) => (x.start ? `${fmtTime(toMin(x.start))}–${fmtTime(endOf(x))}` : '終日');

  const planMenu = (plan) =>
    actionSheet(plan.title, [
      {
        label: '編集',
        onClick: async () => {
          const res = await planSheet(members, plan, { editing: true });
          if (res) store.updatePlan(groupId, plan.id, res).catch(showError);
        },
      },
      {
        label: '削除',
        danger: true,
        onClick: async () => {
          if (await confirmSheet(`「${plan.title}」を削除しますか？`)) store.deletePlan(groupId, plan.id).catch(showError);
        },
      },
    ]);

  const empty = !dayEvents.length && !daySched.length && !dayPlans.length;
  const undated = ps.filter((p) => !p.date).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  // 予定を追加（右下の ＋、その日の一覧の「＋ この日に予定を追加」、日付の 2 回タップ、複数選択で共通。日付は選んでいる日が初期値）
  // dates（複数選択した日）を渡すと、その日すべてに同じ予定を入れる
  const addPlan = async (dates = null) => {
    const many = dates?.length > 1;
    const res = await planSheet(members, { date: dates?.[0] ?? sel, ...(many ? { dates } : {}), participants: filter === 'all' ? [] : [filter] });
    if (!res) return;
    const { dates: days = [res.date], ...plan } = res;
    if (dates) state.multi = null;
    Promise.all(days.map((date) => store.createPlan(groupId, { ...plan, date }))).then(() => {
      const when = !plan.date
        ? '日付未定'
        : days.length > 1
          ? `${fmtDate(days[0])}ほか${days.length - 1}日`
          : plan.endDate
            ? `${fmtDate(plan.date)}〜${fmtDate(plan.endDate)}`
            : `${fmtDate(plan.date)}${plan.start ? ` ${plan.start}` : ''}`;
      requestNotify({
        groupId,
        kind: 'plan',
        title: `📅 ${group.name}`,
        body: `${auth.displayName()}さんが予定を追加しました：${when} ${plan.title}`,
        url: `#/g/${groupId}`,
        participants: plan.participants ?? [],
      });
    }, showError);
    if (days.length > 1) toast(`${days.length}日に「${plan.title}」を入れました`);
    if (plan.date) {
      if (days[0] !== sel || dates) select(days[0]);
    } else {
      toast('「📌 日付未定の予定」に入れました');
    }
  };

  // 左右のスワイプで月を変える。今の月の表の左右に、となりの月の表（中身も本物）を並べておき、
  // 指に付いて全体が動く。離すと、となりの月の位置までするっと動いてから、その月で描き直す（少しだけなら元に戻る）。
  // 縦のスクロールはブラウザに任せる（.cal-pager は touch-action: pan-y）
  const PAGER_GAP = 12;
  let track = null;
  // ‹ › ボタンも同じように横に流してから月を変える
  const slideMonth = (dir) => {
    if (!track?.isConnected) return shiftMonth(dir);
    track.classList.add('snap');
    track.style.transform = `translateX(${-dir * (track.offsetWidth + PAGER_GAP)}px)`;
    setTimeout(() => shiftMonth(dir), 220);
  };
  const enableSwipe = (pager) => {
    pager.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const id = e.pointerId;
      const sx = e.clientX;
      const sy = e.clientY;
      let swiping = false;
      let dx = 0;
      const move = (ev) => {
        if (ev.pointerId !== id || calPick.active) return;
        dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (!swiping) {
          if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.2) {
            if (Math.abs(dy) > 12) cleanup();
            return;
          }
          swiping = true;
          track.classList.remove('snap');
        }
        track.style.transform = `translateX(${dx}px)`;
      };
      const up = (ev) => {
        if (ev.pointerId !== id) return;
        cleanup();
        if (!swiping) return;
        calPick.ignoreTapUntil = Date.now() + 400;
        const dir = dx < 0 ? 1 : -1; // 左へ払うと来月
        if (Math.abs(dx) > Math.min(80, track.offsetWidth * 0.2)) {
          slideMonth(dir);
        } else {
          track.classList.add('snap');
          track.style.transform = '';
        }
      };
      function cleanup() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    return pager;
  };
  // 月の表（曜日の行 ＋ 週の行）。となりの月の表は見せるだけ（操作はしない）
  const dowRow = () => h('div', { class: 'cal-dow' }, '日月火水木金土'.split('').map((w, i) => h('span', { class: i === 0 ? 'sun' : i === 6 ? 'sat' : '' }, w)));
  const ghostGrid = (n) => {
    const vm = monthOf(n);
    const v = monthView(vm);
    const [color] = SEASONS[Number(vm.slice(5)) - 1];
    return h(
      'div',
      { class: `cal-grid cal-ghost ${n < 0 ? 'prev' : 'next'}`, style: `--season: ${color}`, 'aria-hidden': 'true', inert: '' },
      dowRow(),
      Array.from({ length: v.weeks }, (_, i) => weekRow(addDays(v.start, i * 7), vm)),
    );
  };
  const pagerEl = () => {
    track = h('div', { class: 'cal-track' }, ghostGrid(-1), enableDayPick(h('div', { class: 'cal-grid' }, dowRow(), weeks.map((ws) => weekRow(ws)))), ghostGrid(1));
    return enableSwipe(h('div', { class: 'cal-pager' }, track));
  };

  // 長押しで複数選択を始め、そのまま指を動かすと、長押しした日から指のある日までを続けて選ぶ（戻せば縮む）。
  // 長押しした日が選ばれていなければ「選ぶ」、選ばれていれば「外す」。
  // なぞっている間は描き直さず、日付のマスの見た目だけ変える（掴んでいる要素が消えないように）。離したら描き直す
  const enableDayPick = (grid) => {
    grid.addEventListener('contextmenu', (e) => e.preventDefault());
    grid.addEventListener('pointerdown', (e) => {
      const first = e.target.closest?.('.cal-day')?.dataset.date;
      if (!first || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const id = e.pointerId;
      const sx = e.clientX;
      const sy = e.clientY;
      let picking = false;
      let add = true;
      let base = [];
      let last = null;
      // 長押しした日から d までの日を、長押しする前の選択に足す（外す）
      const apply = (d) => {
        if (d === last) return;
        last = d;
        const [from, to] = first <= d ? [first, d] : [d, first];
        const range = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i));
        state.multi = add ? [...new Set([...base, ...range])] : base.filter((x) => !range.includes(x));
        // 新しく選ばれた日は、長押しした日の側から「うにょーん」と伸びる（grow-r：左から右へ、grow-l：右から左へ）
        for (const el of grid.querySelectorAll('.cal-day')) {
          const day = el.dataset.date;
          const was = el.classList.contains('picked');
          el.classList.remove('picked', 'pick-l', 'pick-r', 'tip');
          el.classList.add(...pickClasses(day));
          if (!was && el.classList.contains('picked') && day !== first) {
            el.classList.remove('grow-l', 'grow-r');
            void el.offsetWidth; // アニメーションをやり直す
            el.classList.add(day > first ? 'grow-r' : 'grow-l');
          }
          if (day === d && el.classList.contains('picked')) el.classList.add('tip');
        }
      };
      const start = () => {
        picking = true;
        calPick.active = true;
        base = state.multi ?? [];
        add = !base.includes(first);
        grid.querySelectorAll('.cal-day.selected').forEach((el) => el.classList.remove('selected'));
        apply(first);
        navigator.vibrate?.(15);
      };
      const timer = setTimeout(start, 450);
      const move = (ev) => {
        if (ev.pointerId !== id) return;
        if (!picking) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cleanup();
          return;
        }
        const d = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.cal-day')?.dataset.date;
        if (d) apply(d);
      };
      const up = (ev) => {
        if (ev.pointerId !== id) return;
        const was = picking;
        cleanup();
        if (!was) return;
        // 離した直後に届くタップ（click）で選択が戻らないように
        calPick.ignoreTapUntil = Date.now() + 500;
        if (!state.multi.length) state.multi = null;
        rerender();
      };
      function cleanup() {
        clearTimeout(timer);
        calPick.active = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    return grid;
  };

  // リンク（<a>）を中に置くので <button> ではなく role=button の div
  const planRow = (plan) =>
    h(
      'div',
      {
        class: 'cal-row plan',
        role: 'button',
        tabindex: 0,
        onClick: () => planMenu(plan),
        onKeydown: (e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            planMenu(plan);
          }
        },
      },
      h('span', { class: 'cal-row-time' }, !plan.date ? '未定' : isSpan(plan) ? `${daysBetween(plan.date, sel) + 1}日目` : timeText(plan)),
      h(
        'span',
        { class: 'cal-row-main' },
        h('span', { class: 'cal-row-title' }, plan.title),
        h(
          'span',
          { class: 'cal-row-sub' },
          [isSpan(plan) && `${fmtDate(plan.date)} 〜 ${fmtDate(plan.endDate)}`, plan.place && `📍${plan.place}`, `👥 ${participantsLabel(members, plan.participants)}`].filter(Boolean).join(' ・ '),
        ),
        plan.memo && h('span', { class: 'cal-row-sub' }, plan.memo),
        linkChips(plan.links),
      ),
      h('span', { class: 'sch-more' }, '⋮'),
    );

  const [seasonColor, seasonEmoji] = SEASONS[Number(viewMonth.slice(5)) - 1];
  return h(
    'div',
    { class: 'calendar', style: `--season: ${seasonColor}` },
    h(
      'div',
      { class: 'cal-filter people-chips' },
      [{ uid: 'all', name: '👥 全員' }, ...members].map((m) =>
        h(
          'button',
          {
            class: `chip${filter === m.uid ? ' on' : ''}`,
            onClick: () => {
              prefs.set(`calFilter:${groupId}`, m.uid);
              rerender();
            },
          },
          m.uid === user.uid ? `${m.name}（自分）` : m.name,
        ),
      ),
    ),
    h(
      'div',
      { class: 'cal-head' },
      // 先月 / −2週 / （見出し） / +2週 / 来月
      h('button', { class: 'day-nav-btn', 'aria-label': '先月', title: '先月', onClick: () => slideMonth(-1) }, '‹'),
      h('button', { class: 'cal-mini', 'aria-label': '2週間前へ', onClick: () => shiftWeeks(-2) }, '−2週'),
      h('span', { class: 'cal-title' }, `${seasonEmoji} ${Number(viewMonth.slice(0, 4))}年${Number(viewMonth.slice(5))}月`),
      h('button', { class: 'cal-mini', 'aria-label': '2週間後へ', onClick: () => shiftWeeks(2) }, '+2週'),
      h('button', { class: 'day-nav-btn', 'aria-label': '来月', title: '来月', onClick: () => slideMonth(1) }, '›'),
      (today < state.start || today > viewEnd || state.selected !== today) && h('button', { class: 'cal-today', onClick: goToday }, '今日'),
    ),
    pagerEl(),
    !state.multi && h('p', { class: 'cal-hint' }, '日付をもう一度タップで予定を追加 ・ 長押しで何日も選べます'),
    h(
      'div',
      { class: 'cal-panel' },
      h('div', { class: 'cal-panel-head' }, h('span', {}, fmtDate(sel)), sel === today && h('span', { class: 'event-badge ongoing' }, '今日')),
      empty && h('p', { class: 'empty small' }, filter === 'all' ? 'この日の予定はありません' : 'この人の予定はありません'),
      dayEvents.map((ev) =>
        h(
          'a',
          { class: 'cal-row event', href: eventHref(ev, sel) },
          h('span', { class: 'cal-row-time' }, ev.startDate === ev.endDate ? '終日' : `${daysBetween(ev.startDate, sel) + 1}日目`),
          h('span', { class: 'cal-row-main' }, h('span', { class: 'cal-row-title' }, `${ev.emoji} ${ev.title}`), h('span', { class: 'cal-row-sub' }, `${fmtRange(ev)} ・ ${participantsLabel(members, ev.participants)}`)),
          h('span', { class: 'chevron' }, '›'),
        ),
      ),
      daySched.map(({ ev, item }) =>
        h(
          'a',
          { class: 'cal-row', href: eventHref(ev, sel) },
          h('span', { class: 'cal-row-time' }, item.start ? fmtTime(toMin(item.start)) : '時間未定'),
          h('span', { class: 'cal-row-main' }, h('span', { class: 'cal-row-title' }, item.title), h('span', { class: 'cal-row-sub' }, `${ev.emoji} ${ev.title}の旅程`)),
          h('span', { class: 'chevron' }, '›'),
        ),
      ),
      dayPlans.map(planRow),
      h('button', { class: 'sch-add', onClick: () => addPlan() }, '＋ この日に予定を追加'),
    ),
    undated.length > 0 &&
      h(
        'div',
        { class: 'cal-panel undated' },
        h('div', { class: 'cal-panel-head' }, h('span', {}, `📌 日付未定の予定（${undated.length}件）`)),
        undated.map(planRow),
        h('p', { class: 'cal-undated-hint' }, '日付が決まったら ⋮ →「編集」で日付を入れると、カレンダーに移ります'),
      ),
    // 日付を選ばなくても追加できる ＋ ボタン（画面の右下に固定）。複数選択中は代わりに選んだ日数と「追加」のバー
    state.multi
      ? h(
          'div',
          { class: 'cal-multi-bar' },
          h('span', { class: 'cal-multi-count' }, h('b', {}, `${state.multi.length}日`), '選択中', h('small', {}, 'タップで選ぶ・外す')),
          h('button', { class: 'btn', onClick: endMulti }, 'やめる'),
          h('button', { class: 'btn primary', disabled: !state.multi.length, onClick: () => addPlan([...state.multi].sort()) }, '予定を追加'),
        )
      : h('button', { class: 'cal-fab', 'aria-label': '予定を追加', title: '予定を追加', onClick: () => addPlan() }, '＋'),
  );
}

// 一覧に出すリスト（旅程は旅程タブに出すので除く）
function isShownList(l) {
  return ['checklist', 'money', 'wish'].includes(l.type ?? 'checklist');
}

// リストのカード：1 回目のタップでその場に中身を開き（もう一度で閉じる）、「開く ›」でリストの画面へ。
// やることリストは開いた中でチェックできる。開けるのは 1 枚だけ（開くと、ほかのカードは閉じる）。開いているカードは描き直しても保つ。
let openCard = null; // 'groupId/listId'
const groupMembers = {}; // groupId → メンバー（貸し借りの名前の表示用。グループ画面で覚える）
const PREVIEW_MAX = 8;

function listCard(groupId, l) {
  const money = l.type === 'money';
  const wish = l.type === 'wish';
  const open = money ? l.items.filter((i) => !i.settled) : [];
  const yen = open.filter((i) => i.kind !== 'item').reduce((n, i) => n + (i.amount ?? 0), 0);
  const key = `${groupId}/${l.id}`;
  const href = `#/g/${groupId}/l/${l.id}`;
  const wrap = h('div', { class: 'card-wrap' });
  const head = h(
    'button',
    { type: 'button', class: 'card', 'aria-expanded': 'false', onClick: () => toggle() },
    h('span', { class: 'card-icon' }, l.emoji),
    h(
      'span',
      { class: 'card-main' },
      h('span', { class: 'card-title' }, l.title),
      money
        ? h('span', { class: 'card-sub' }, open.length ? `未精算 ${open.length}件${yen ? ` ・ ${fmtYen(yen)}` : ''}` : l.total ? 'すべて精算済み' : 'まだ登録なし')
        : wish
          ? h('span', { class: 'card-sub' }, (() => {
              const wishOpen = l.items.filter((i) => (i.status ?? 'open') === 'open').length;
              return l.total ? `${wishOpen}件${l.total - wishOpen ? ` ・ 完了 ${l.total - wishOpen}件` : ''}` : 'まだ登録なし';
            })())
          : h('span', { class: 'card-sub' }, l.total ? `${l.done} / ${l.total} 完了` : '空のリスト'),
      !money && !wish && l.total > 0 && progressBar(l.done, l.total),
    ),
    h('span', { class: 'chevron' }, '›'),
  );
  wrap.append(head);

  const more = (n) => n > 0 && h('li', { class: 'preview-more' }, `ほか ${n}件`);
  const preview = () => {
    let content;
    if (money) {
      const members = groupMembers[groupId] ?? [];
      const nameOf = (u) => members.find((m) => m.uid === u)?.name ?? '？';
      const balance = {};
      for (const e of open) {
        if (e.kind === 'item') continue;
        balance[e.from] = (balance[e.from] ?? 0) + (e.amount ?? 0);
        balance[e.to] = (balance[e.to] ?? 0) - (e.amount ?? 0);
      }
      const balances = Object.entries(balance).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
      const things = open.filter((e) => e.kind === 'item');
      content =
        open.length === 0
          ? h('p', { class: 'preview-empty' }, '未精算の貸し借りはありません')
          : [
              balances.length > 0 &&
                h(
                  'div',
                  { class: 'money-balances' },
                  balances.map(([u, v]) =>
                    h('span', { class: `money-balance ${v > 0 ? 'plus' : 'minus'}` }, nameOf(u), h('b', {}, `${v > 0 ? '+' : '−'}${fmtYen(Math.abs(v))}`), v > 0 ? '貸している' : '借りている'),
                  ),
                ),
              things.length > 0 &&
                h(
                  'ul',
                  { class: 'preview-items' },
                  things.slice(0, PREVIEW_MAX).map((e) => h('li', { class: 'preview-item' }, `📦 ${e.item || e.memo || 'もの'}（${nameOf(e.from)} → ${nameOf(e.to)}）`)),
                  more(things.length - PREVIEW_MAX),
                ),
            ];
    } else if (wish) {
      const items = l.items.filter((i) => (i.status ?? 'open') === 'open');
      content =
        items.length === 0
          ? h('p', { class: 'preview-empty' }, '欲しいものはありません')
          : h('ul', { class: 'preview-items' }, items.slice(0, PREVIEW_MAX).map((w) => h('li', { class: 'preview-item' }, `・${wishTitle(w)}`)), more(items.length - PREVIEW_MAX));
    } else {
      // 未完了 → 完了の順。チェックしても数が多くなければその場に残るので、押し間違えてもすぐ戻せる
      const items = [...l.items.filter((i) => !i.checked), ...l.items.filter((i) => i.checked)];
      content =
        items.length === 0
          ? h('p', { class: 'preview-empty' }, 'アイテムはまだありません')
          : h(
              'ul',
              { class: 'preview-items' },
              items.slice(0, PREVIEW_MAX).map((item) =>
                h(
                  'li',
                  { class: `preview-item check${item.checked ? ' checked' : ''}` },
                  h(
                    'label',
                    { class: 'item-label' },
                    h('input', {
                      type: 'checkbox',
                      class: 'item-check',
                      checked: item.checked,
                      onChange: (e) => store.setItemChecked(groupId, l.id, item.id, e.target.checked).catch(showError),
                    }),
                    h('span', { class: 'item-text' }, item.text),
                  ),
                ),
              ),
              more(items.length - PREVIEW_MAX),
            );
    }
    return h('div', { class: 'card-preview' }, content, h('a', { class: 'card-open', href }, '開く ›'));
  };

  const show = (on) => {
    wrap.classList.toggle('open', on);
    head.setAttribute('aria-expanded', String(on));
    wrap.querySelector('.card-preview')?.remove();
    if (on) wrap.append(preview());
  };
  wrap.closeCard = () => show(false);
  const toggle = () => {
    const on = openCard !== key;
    openCard = on ? key : null;
    if (on) document.querySelectorAll('.card-wrap.open').forEach((w) => w !== wrap && w.closeCard?.());
    show(on);
  };
  if (openCard === key) show(true);
  return wrap;
}

function fmtYen(n) {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

// ---- 画面：イベント ----

function eventView(root, { groupId, eventId, date = null }) {
  const top = h('div', { class: 'topbar-wrap' });
  const body = h('main', { class: 'content' });
  root.append(top, body);
  let ev = null;
  let lists = null;

  function render() {
    if (!ev || !lists) return;
    // ドラッグ中は描き直さない（ドロップ後に描き直す）
    if (scheduleDrag.active) {
      scheduleDrag.pendingRender = render;
      return;
    }
    scheduleDrag.pendingRender = render;
    const st = eventStatus(ev);
    const mine = lists.filter((l) => l.eventId === eventId && isShownList(l));
    const schedule = lists.find((l) => l.id === store.scheduleId(eventId));
    const days = eventDays(ev);
    // 1 日の画面：期間外の日付（イベントの日付を変えた後など）や 1 日だけのイベントは、イベントの画面へ
    if (date && (!days.includes(date) || days.length === 1)) {
      location.replace(`#/g/${groupId}/e/${eventId}`);
      return;
    }
    if (date) {
      const n = days.indexOf(date);
      const dayHref = (d) => `#/g/${groupId}/e/${eventId}/d/${d}`;
      setChildren(top, header({ title: `${ev.emoji} ${ev.title}`, back: `#/g/${groupId}/e/${eventId}` }));
      setChildren(
        body,
        h(
          'div',
          { class: 'day-nav' },
          n > 0 ? h('a', { class: 'day-nav-btn', href: dayHref(days[n - 1]), 'aria-label': '前の日' }, '‹') : h('span', { class: 'day-nav-btn' }),
          h(
            'div',
            { class: 'day-nav-title' },
            h('span', { class: 'day-nav-day' }, `${n + 1}日目`, date === todayStr() && h('span', { class: 'event-badge ongoing' }, '今日')),
            h('span', { class: 'day-nav-date' }, `${fmtDate(date)} ・ ${n + 1} / ${days.length}日`),
          ),
          n < days.length - 1 ? h('a', { class: 'day-nav-btn', href: dayHref(days[n + 1]), 'aria-label': '次の日' }, '›') : h('span', { class: 'day-nav-btn' }),
        ),
        scheduleSection(groupId, ev, schedule, { focusDate: date }),
      );
      return;
    }
    setChildren(
      top,
      header({
        title: `${ev.emoji} ${ev.title}`,
        back: `#/g/${groupId}`,
        onMenu: () =>
          actionSheet(ev.title, [
            {
              label: 'イベントを編集',
              onClick: async () => {
                const g = await store.fetchGroup(groupId).catch(() => null);
                const res = await eventSheet(ev, '保存', g ? memberList(g) : null);
                if (res) store.updateEvent(groupId, eventId, res).catch(showError);
              },
            },
            {
              label: 'イベントを削除',
              danger: true,
              onClick: async () => {
                if (await confirmSheet(`「${ev.title}」と中の旅程（${schedule?.items.length ?? 0}件）・リスト（${mine.length}個）を削除しますか？`)) {
                  store.deleteEvent(groupId, eventId).then(() => (location.hash = `#/g/${groupId}`), showError);
                }
              },
            },
          ]),
      }),
    );
    // 旅程とリストはタブで切り替える（最後に開いたタブをイベントごとに覚えておく）
    const tabKey = `eventTab:${eventId}`;
    const tab = prefs.get(tabKey, 'schedule');
    const planned = schedule?.items.filter((i) => i.date).length ?? 0;
    const tabBtn = (id, label, count) =>
      h(
        'button',
        {
          class: `tab${tab === id ? ' active' : ''}`,
          role: 'tab',
          'aria-selected': String(tab === id),
          onClick: () => {
            if (tab === id) return;
            prefs.set(tabKey, id);
            render();
          },
        },
        label,
        count > 0 && h('span', { class: 'tab-count' }, count),
      );
    setChildren(
      body,
      h(
        'div',
        { class: 'event-hero' },
        h('span', { class: 'event-dates' }, fmtRange(ev)),
        h('span', { class: `event-badge ${st.kind}` }, st.label),
      ),
      h('div', { class: 'tabs', role: 'tablist' }, tabBtn('schedule', '🗓 旅程', planned), tabBtn('lists', '📝 リスト', mine.length)),
      tab === 'schedule'
        ? scheduleSection(groupId, ev, schedule)
        : [
            mine.length === 0 && h('p', { class: 'empty small' }, '持ち物リストなどを追加しましょう。日常のリストや過去のイベントから取り込むこともできます。'),
            h('div', { class: 'card-list' }, mine.map((l) => listCard(groupId, l))),
            h('button', { class: 'add-card', onClick: () => addListMenu(groupId, eventId) }, '＋ リストを追加'),
          ],
    );
  }

  const onGone = (e) => {
    if (e?.code !== 'permission-denied' && e?.message !== 'not-found') return showError(e);
    toast('イベントが見つかりません');
    location.hash = `#/g/${groupId}`;
  };
  const unwatchEvent = store.watchEvent(
    groupId,
    eventId,
    (x) => {
      ev = x;
      render();
    },
    onGone,
  );
  const unwatchLists = store.watchLists(
    groupId,
    (ls) => {
      lists = ls;
      render();
    },
    onGone,
  );
  return () => {
    unwatchEvent();
    unwatchLists();
  };
}

// ---- 画面：管理者ダッシュボード ----

function adminView(root) {
  const body = h('main', { class: 'content' });
  root.append(header({ title: '管理者ダッシュボード', back: '#/' }), body);
  let users = null;

  function render() {
    if (!users) return;
    const now = Date.now();
    const online = users.filter((u) => store.isOnline(u.lastSeen, now));
    const today = users.filter((u) => now - store.millis(u.lastSeen) < 24 * 60 * 60 * 1000);
    const guests = users.filter((u) => u.guest).length;
    const sorted = [...users].sort((a, b) => store.millis(b.lastSeen) - store.millis(a.lastSeen));
    const stat = (label, value, sub) =>
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value), sub && h('span', { class: 'stat-sub' }, sub));

    setChildren(
      body,
      h(
        'div',
        { class: 'stats' },
        stat('オンライン', `${online.length}人`, '直近2〜3分'),
        stat('24時間以内', `${today.length}人`),
        stat('これまで', `${users.length}人`, `ゲスト ${guests} / Google ${users.length - guests}`),
      ),
      h('p', { class: 'section-label' }, 'ユーザー（最終アクセス順）'),
      h(
        'ul',
        { class: 'member-list' },
        sorted.map((u) =>
          h(
            'li',
            {},
            onlineDot(store.isOnline(u.lastSeen, now)),
            h(
              'span',
              { class: 'member-name' },
              h('span', {}, u.name || '（名前なし）', u.id === user.uid && '（自分）'),
              h('span', { class: 'member-seen' }, store.isOnline(u.lastSeen, now) ? 'オンライン' : timeAgo(store.millis(u.lastSeen))),
            ),
            u.guest && h('span', { class: 'badge muted' }, 'ゲスト'),
          ),
        ),
      ),
      h('p', { class: 'welcome-note' }, 'この機能を追加した後にアプリを開いた人が対象です。'),
    );
  }

  const ticker = setInterval(render, 15 * 1000);
  const unwatch = store.watchPresence(
    (list) => {
      users = list;
      render();
    },
    (e) => {
      showError(e);
      location.hash = '#/';
    },
  );
  return () => {
    clearInterval(ticker);
    unwatch();
  };
}

// ---- 画面：チェックリスト ----

// ---- リストの画面：リストの種類（チェックリスト / 貸し借り）で画面を切り替える ----

function listView(root, params) {
  let kind = null;
  let inner = null;
  const mount = (k) => {
    if (k === kind) return;
    kind = k;
    inner?.();
    root.replaceChildren();
    inner = ({ money: moneyView, wish: wishView }[k] ?? checklistView)(root, params);
  };
  const unwatch = store.watchList(
    params.groupId,
    params.listId,
    (list) => mount(['money', 'wish'].includes(list.type) ? list.type : 'checklist'),
    // 読めないときはチェックリストの画面に任せる（そちらで「見つかりません」を出す）
    () => mount('checklist'),
  );
  return () => {
    unwatch();
    inner?.();
  };
}

// ---- 画面：欲しいもの系リスト（欲しいもの・行きたいところ・食べに行きたい・食べたいもの） ----
// 基本はメモ（例：玉ねぎ）。URL や写真も付けられる。買った・行った・食べた／あきらめたら結果を書いてクローズする。
// リストの variant で、場所（行きたいところ）や 作る・買う（食べたいもの）、★ の評価が増える。

// 写真を縮小して JPEG の data URL にする（長い辺 1024px。大きすぎたら 800px・画質を下げてやり直す）
async function resizeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('画像を読み込めませんでした'));
      el.src = url;
    });
    for (const [max, quality] of [[1024, 0.72], [800, 0.6], [640, 0.5]]) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= 850000) return data;
    }
    throw new Error('写真が大きすぎます');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 写真を選ぶ（スマホならその場で撮影も選べる）。選ばなければ null
function pickImageFile() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

// お店・サービスがわかるリンクのラベル
function shopLabel(url) {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '🔗 リンク';
  }
  const known = [
    [/(^|\.)tiktok\.com$/, '🎵 TikTok'],
    [/(^|\.)(youtube\.com|youtu\.be)$/, '▶️ YouTube'],
    [/(^|\.)instagram\.com$/, '📷 Instagram'],
    [/(^|\.)(x\.com|twitter\.com)$/, '𝕏 X'],
    [/(^|\.)(amazon\.co\.jp|amazon\.com|amzn\.to|amzn\.asia)$/, '📦 Amazon'],
    [/(^|\.)rakuten\.co\.jp$/, '🛍 楽天'],
    [/(^|\.)(shopping\.yahoo\.co\.jp|paypaymall\.yahoo\.co\.jp)$/, '🛍 Yahoo!ショッピング'],
    [/(^|\.)mercari\.com$|(^|\.)jp\.mercari\.com$/, '🛍 メルカリ'],
  ];
  return known.find(([re]) => re.test(host))?.[1] ?? `🔗 ${host}`;
}

// メモの中の最初の URL を取り出す
function splitUrl(text) {
  const m = text.match(/https?:\/\/\S+/) ?? text.match(/^(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*$/i);
  if (!m) return { text: text.trim(), url: '' };
  const url = normalizeUrl(m[0]);
  return { text: text.replace(m[0], '').trim(), url: url || '' };
}

function photoThumb(groupId, photoId, onOpen) {
  const img = h('img', { class: 'wish-thumb', alt: '写真', loading: 'lazy' });
  store.getPhoto(groupId, photoId).then((data) => (data ? (img.src = data) : img.classList.add('missing')));
  return h('button', { class: 'wish-thumb-btn', 'aria-label': '写真を大きく見る', onClick: () => onOpen?.() }, img);
}

function photoViewer(groupId, photoId, title) {
  const img = h('img', { class: 'wish-photo', alt: title });
  store.getPhoto(groupId, photoId).then((data) => data && (img.src = data));
  openSheet((close) => [h('div', { class: 'sheet-title' }, title), img, h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, '閉じる')]);
}

function wishTitle(w) {
  if (w.text) return w.text;
  if (w.url) return shopLabel(w.url).replace(/^\S+\s/, '');
  return w.photoId ? '（写真）' : '（なし）';
}

// 欲しいもの系リストの種類（list.variant）。中身の仕組みは同じで、入力する項目と言葉だけ変える
const WISH_KINDS = {
  buy: {
    placeholder: '欲しいもの（例：玉ねぎ）',
    addPlaceholder: '欲しいもの・URL を追加',
    empty: '下の欄に書くとメモとして追加できます。URL を貼るとリンクに、📷 で写真付きにできます。',
    statuses: [['bought', '🛒 買った', '結果（例：Amazonで1,980円）'], ['gaveup', '🙅 あきらめた', '結果（例：売り切れだった）']],
  },
  place: {
    placeholder: '店名・場所の名前（例：〇〇食堂）',
    addPlaceholder: '店名・URL を追加',
    empty: '行きたいお店や場所を追加しましょう。TikTok などの URL を貼ると、タイトルと画像が自動で入ります。',
    place: true,
    rating: true,
    statuses: [['visited', '✅ 行った', '感想（例：また行きたい！）'], ['gaveup', '🙅 やめた', 'ひとこと（例：閉店していた）']],
  },
  food: {
    placeholder: '食べたいもの（例：麻婆豆腐）',
    addPlaceholder: '食べたいもの・URL を追加',
    empty: '食べたいものを追加しましょう。レシピ動画などの URL を貼ると、タイトルと画像が自動で入ります。',
    how: true,
    rating: true,
    statuses: [['ate', '😋 食べた', '感想（例：また作りたい）'], ['gaveup', '🙅 やめた', 'ひとこと']],
  },
};
const FOOD_HOW = [['cook', '🍳 作る'], ['buy', '🛒 買う'], ['eatout', '🍴 食べに行く']];
const WISH_STATUS = Object.fromEntries(Object.values(WISH_KINDS).flatMap((k) => k.statuses.map(([id, label]) => [id, label])));
const wishKind = (list) => WISH_KINDS[list?.variant] ?? WISH_KINDS.buy;
// 「＋ リストを追加」のひな形
const WISH_TEMPLATES = [
  { variant: 'place', emoji: '📍', title: '行きたいところ' },
  { variant: 'place', emoji: '🍴', title: '食べに行きたい' },
  { variant: 'food', emoji: '🍳', title: '食べたいもの' },
  { variant: 'buy', emoji: '🛍️', title: '欲しいもの' },
];
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

// TikTok などのタイトルは長い・ハッシュタグだらけなので、名前として使いやすく整える
// （TikTok は説明文がまるごと来るので、最初のひと区切りだけにする）
function cleanLinkTitle(title) {
  const t = title.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim() || title;
  const first = t.split(' ')[0];
  return (first.length >= 8 ? first : t).slice(0, 60);
}

// リンクのタイトルと画像を取ってくる（画像は縮小した data URL にする）。取れなければ null
async function fetchLinkInfo(groupId, url) {
  const res = await loadPush()
    .then((push) => push.linkPreview(groupId, url))
    .catch(() => null);
  if (!res) return null;
  let image = null;
  if (res.image) {
    try {
      image = await resizeImage(await (await fetch(res.image)).blob());
    } catch {
      // 画像なし
    }
  }
  return { title: res.title ? cleanLinkTitle(res.title) : '', image };
}

// 追加・編集シート。photo の結果は { action: 'keep' | 'remove' | 'new', data }
// targets を渡すと、登録先のリストを選べる（「📋 リンクを登録」）。結果の listId が選んだリスト
function wishSheet(groupId, initial = {}, { editing = false, list = null, targets = null } = {}) {
  return openSheet((close) => {
    let target = targets ? (targets.find((l) => l.id === initial.listId) ?? targets[0]) : list;
    const text = h('input', { class: 'text-input', value: initial.text ?? '', maxlength: 200, 'aria-label': '名前・メモ' });
    const url = h('input', { class: 'text-input', type: 'text', inputmode: 'url', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', value: initial.url ?? '', placeholder: 'URL（例：TikTok やお店のリンク）', maxlength: 2000, 'aria-label': 'URL' });
    const place = h('input', { class: 'text-input', value: initial.place ?? '', placeholder: '場所・住所（例：大阪 難波）', maxlength: 200, 'aria-label': '場所' });
    let how = initial.how ?? '';
    const howChips = h('div', { class: 'people-chips' });
    const syncHow = () =>
      setChildren(
        howChips,
        FOOD_HOW.map(([k, label]) =>
          h(
            'button',
            {
              type: 'button',
              class: `chip${how === k ? ' on' : ''}`,
              onClick: () => {
                how = how === k ? '' : k;
                syncHow();
              },
            },
            label,
          ),
        ),
      );
    syncHow();

    let photo = { action: 'keep', data: null };
    const hasPhoto = () => photo.action === 'new' || (photo.action === 'keep' && initial.photoId);
    const photoBox = h('div', { class: 'wish-photo-edit' });
    const renderPhoto = () => {
      const has = hasPhoto();
      const preview = h('img', { class: 'wish-thumb', alt: '写真' });
      if (photo.action === 'new') preview.src = photo.data;
      else if (has) store.getPhoto(groupId, initial.photoId).then((d) => d && (preview.src = d));
      setChildren(
        photoBox,
        has && preview,
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: async () => {
              const file = await pickImageFile();
              if (!file) return;
              try {
                photo = { action: 'new', data: await resizeImage(file) };
              } catch (e) {
                return toast(e.message);
              }
              renderPhoto();
            },
          },
          has ? '📷 写真を変える' : '📷 写真を付ける',
        ),
        has &&
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onClick: () => {
                photo = { action: 'remove', data: null };
                renderPhoto();
              },
            },
            '外す',
          ),
      );
    };
    renderPhoto();

    // URL を貼ったら、タイトルと画像を自動で入れる（入力済みの名前・写真は上書きしない）
    const status = h('p', { class: 'link-preview-status' });
    let fetched = '';
    const fillFromLink = async () => {
      const u = url.value.trim() ? normalizeUrl(url.value) : '';
      if (!u || u === fetched) return;
      fetched = u;
      status.textContent = '🔎 リンクのタイトルと画像を読み込み中…';
      const info = await fetchLinkInfo(groupId, u);
      if (fetched !== u || !status.isConnected) return;
      let filled = false;
      if (info?.title && !text.value.trim()) {
        text.value = info.title;
        filled = true;
      }
      if (info?.image && !hasPhoto()) {
        photo = { action: 'new', data: info.image };
        renderPhoto();
        filled = true;
      }
      status.textContent = filled ? '✨ リンクから入れました（書き換えられます）' : info?.title || info?.image ? '' : 'リンクのタイトル・画像は取れませんでした';
    };
    url.addEventListener('change', fillFromLink);
    url.addEventListener('paste', () => setTimeout(fillFromLink, 0));
    if (initial.url && !editing) setTimeout(fillFromLink, 0);

    const title = h('div', { class: 'sheet-title' });
    const targetChips = targets && h('div', { class: 'people-chips' });
    const syncTarget = () => {
      const kind = wishKind(target);
      text.placeholder = kind.placeholder;
      place.style.display = kind.place ? '' : 'none';
      howChips.style.display = kind.how ? '' : 'none';
      title.textContent = editing ? `「${wishTitle(initial)}」を編集` : targets ? '📋 リンクを登録' : `${target.emoji} ${target.title}に追加`;
      if (targets) {
        setChildren(
          targetChips,
          targets.map((l) =>
            h(
              'button',
              {
                type: 'button',
                class: `chip${l.id === target.id ? ' on' : ''}`,
                onClick: () => {
                  target = l;
                  syncTarget();
                },
              },
              `${l.emoji} ${l.title}${l.eventTitle ? `（${l.eventTitle}）` : ''}`,
            ),
          ),
        );
      }
    };
    syncTarget();

    return [
      title,
      h(
        'form',
        {
          class: 'sheet-form',
          onSubmit: (e) => {
            e.preventDefault();
            const u = url.value.trim() ? normalizeUrl(url.value) : '';
            if (u === null) return toast('http:// か https:// で始まるリンクを入れてください');
            if (!text.value.trim() && !u && !hasPhoto()) return toast('名前・URL・写真のどれかを入れてください');
            const kind = wishKind(target);
            close({
              listId: target?.id ?? null,
              text: text.value.trim(),
              url: u,
              photo,
              place: kind.place ? place.value.trim() : (initial.place ?? ''),
              how: kind.how ? how : (initial.how ?? ''),
            });
          },
        },
        targets && h('span', { class: 'links-label' }, '登録先'),
        targetChips,
        url,
        status,
        text,
        place,
        howChips,
        photoBox,
        h(
          'div',
          { class: 'sheet-buttons' },
          h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn primary' }, editing ? '保存' : '追加'),
        ),
      ),
    ];
  });
}

// 新しく追加する（写真があれば保存してから）
async function saveNewWish(groupId, listId, res) {
  const photoId = res.photo.action === 'new' ? await store.savePhoto(groupId, res.photo.data) : null;
  return store.addWish(groupId, listId, { text: res.text, url: res.url, photoId, place: res.place ?? '', how: res.how ?? '' });
}

// クローズ：買った・行った・食べた／あきらめた ＋ 結果・感想（行きたいところ・食べたいものは ★ も）
function closeWishSheet(w, kind) {
  return openSheet((close) => {
    let status = kind.statuses[0][0];
    let rating = 0;
    const result = h('input', { class: 'text-input', placeholder: kind.statuses[0][2], maxlength: 200, 'aria-label': '結果' });
    const chips = h('div', { class: 'people-chips' });
    const syncChips = () =>
      setChildren(
        chips,
        kind.statuses.map(([k, label, placeholder]) =>
          h(
            'button',
            {
              type: 'button',
              class: `chip${status === k ? ' on' : ''}`,
              onClick: () => {
                status = k;
                result.placeholder = placeholder;
                syncChips();
                syncStars();
              },
            },
            label,
          ),
        ),
      );
    const starBox = h('div', { class: 'star-input', role: 'group', 'aria-label': '評価' });
    const syncStars = () => {
      starBox.style.display = kind.rating && status !== 'gaveup' ? '' : 'none';
      setChildren(
        starBox,
        [1, 2, 3, 4, 5].map((n) =>
          h(
            'button',
            {
              type: 'button',
              class: `star${n <= rating ? ' on' : ''}`,
              'aria-label': `${n}`,
              onClick: () => {
                rating = rating === n ? 0 : n;
                syncStars();
              },
            },
            n <= rating ? '★' : '☆',
          ),
        ),
      );
    };
    syncChips();
    syncStars();
    return [
      h('div', { class: 'sheet-title' }, `「${wishTitle(w)}」をクローズ`),
      h(
        'form',
        {
          class: 'sheet-form',
          onSubmit: (e) => {
            e.preventDefault();
            close({ status, result: result.value.trim(), rating: kind.rating && status !== 'gaveup' ? rating : 0 });
          },
        },
        chips,
        starBox,
        result,
        h(
          'div',
          { class: 'sheet-buttons' },
          h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn primary' }, 'クローズ'),
        ),
      ),
    ];
  });
}

// 「📋 リンクを登録」：コピーしたリンクを読み、登録先を選んで追加する。
// ブラウザ版はボタンを押したときだけクリップボードを読める（iPhone では「ペースト」の確認が出る）
async function registerLink(groupId, lists, events = []) {
  const targets = lists
    .filter((l) => l.type === 'wish')
    .map((l) => ({ ...l, eventTitle: l.eventId ? events.find((e) => e.id === l.eventId)?.title ?? '' : '' }))
    .sort((a, b) => Number(!!a.eventId) - Number(!!b.eventId));
  if (!targets.length) {
    toast('先に「行きたいところ」などのリストを作りましょう');
    return addListMenu(groupId);
  }
  // リンク以外の文字（「TikTok でこの動画を見て」など）は使わず、名前はリンクのタイトルから入れる
  let url = '';
  try {
    url = splitUrl((await navigator.clipboard.readText()) ?? '').url;
  } catch {
    // 読めなければ登録画面で貼ってもらう
  }
  if (!url) toast('コピーしたリンクが見つかりませんでした。URL の欄に貼ってください');
  const lastKey = `linkTarget:${groupId}`;
  const res = await wishSheet(groupId, { url, listId: prefs.get(lastKey) }, { targets });
  if (!res) return;
  prefs.set(lastKey, res.listId);
  const dest = targets.find((l) => l.id === res.listId);
  try {
    await saveNewWish(groupId, res.listId, res);
    toast(`「${dest.title}」に登録しました`);
  } catch (e) {
    showError(e);
  }
}

function wishView(root, { groupId, listId }) {
  const top = h('div', { class: 'topbar-wrap' });
  const body = h('main', { class: 'content with-footer' });
  const input = h('input', { class: 'text-input', placeholder: '欲しいもの・URL を追加', maxlength: 300, enterkeyhint: 'enter', 'aria-label': '追加' });
  let list = null;
  let showClosed = false;

  // 写真を付けて追加（入力欄に書いてあればそれをメモにする）
  const addWithPhoto = async () => {
    const file = await pickImageFile();
    if (!file) return;
    let data;
    try {
      data = await resizeImage(file);
    } catch (e) {
      return toast(e.message);
    }
    const parts = splitUrl(input.value);
    input.value = '';
    try {
      const photoId = await store.savePhoto(groupId, data);
      await store.addWish(groupId, listId, { ...parts, photoId });
    } catch (e) {
      showError(e);
    }
  };

  // URL だけで追加したら、あとからタイトルと画像を入れる
  const fillLater = async (itemId, url) => {
    const info = await fetchLinkInfo(groupId, url);
    if (!info || (!info.title && !info.image)) return;
    const item = list?.items.find((i) => i.id === itemId);
    if (!item) return;
    const patch = {};
    if (info.title && !item.text) patch.text = info.title;
    if (info.image && !item.photoId) patch.photoId = await store.savePhoto(groupId, info.image);
    if (Object.keys(patch).length) store.patchListItem(groupId, listId, itemId, patch).catch(showError);
  };

  // 入力欄は再描画しない（連続入力中にフォーカスが外れないように）
  const footer = h(
    'form',
    {
      class: 'add-bar',
      onSubmit: async (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        const parts = splitUrl(input.value);
        input.value = '';
        input.focus();
        try {
          const id = await store.addWish(groupId, listId, { ...parts, photoId: null });
          if (parts.url && !parts.text) fillLater(id, parts.url);
        } catch (err) {
          showError(err);
        }
      },
    },
    h('button', { type: 'button', class: 'btn wish-photo-btn', 'aria-label': '写真を付けて追加', onClick: addWithPhoto }, '📷'),
    input,
    h('button', { type: 'submit', class: 'btn primary' }, '追加'),
  );
  root.append(top, body, footer);

  const applyPhoto = async (w, photo) => {
    if (photo.action === 'keep') return w.photoId ?? null;
    if (w.photoId) store.deletePhoto(groupId, w.photoId);
    return photo.action === 'new' ? store.savePhoto(groupId, photo.data) : null;
  };

  // 行きたいところ → カレンダーの予定（場所とリンク付き）
  const makePlan = async (w) => {
    const safeUrl = w.url ? normalizeUrl(w.url) : '';
    const res = await planSheet(groupMembers[groupId] ?? [], {
      title: wishTitle(w),
      date: todayStr(),
      place: w.place || '',
      links: safeUrl ? [{ type: guessLinkType(safeUrl), url: safeUrl }] : [],
    });
    if (!res) return;
    store.createPlan(groupId, res).then(() => toast(res.date ? `${fmtDate(res.date)} の予定に入れました` : '「📌 日付未定の予定」に入れました'), showError);
  };

  // ほかの欲しいもの系リストへ移す
  const moveTo = async (w) => {
    let others;
    try {
      others = (await store.fetchLists(groupId)).filter((l) => l.type === 'wish' && l.id !== listId);
    } catch (e) {
      return showError(e);
    }
    if (!others.length) return toast('移せるリストがありません');
    actionSheet(
      `「${wishTitle(w)}」をどこへ移す？`,
      others.map((l) => ({
        label: `${l.emoji} ${l.title}`,
        onClick: () => store.moveWish(groupId, listId, l.id, w).then(() => toast(`「${l.title}」へ移しました`), showError),
      })),
    );
  };

  function render() {
    if (!list) return;
    const kind = wishKind(list);
    input.placeholder = kind.addPlaceholder;
    const items = [...list.items];
    const open = items.filter((w) => (w.status ?? 'open') === 'open').sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const closed = items.filter((w) => (w.status ?? 'open') !== 'open').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
    const back = list.eventId ? `#/g/${groupId}/e/${list.eventId}` : `#/g/${groupId}`;

    const row = (w) => {
      const isOpen = (w.status ?? 'open') === 'open';
      const safeUrl = w.url ? normalizeUrl(w.url) : '';
      const howLabel = FOOD_HOW.find(([k]) => k === w.how)?.[1];
      return h(
        'li',
        { class: `wish-row${isOpen ? '' : ' closed'}` },
        w.photoId && photoThumb(groupId, w.photoId, () => photoViewer(groupId, w.photoId, wishTitle(w))),
        h(
          'span',
          { class: 'wish-main' },
          h('span', { class: 'wish-text' }, wishTitle(w)),
          (w.place || safeUrl || howLabel) &&
            h(
              'span',
              { class: 'sch-links' },
              howLabel && h('span', { class: 'wish-how' }, howLabel),
              w.place && h('a', { class: 'sch-place', href: mapsUrl(w.place), target: '_blank', rel: 'noopener' }, `📍${w.place}`),
              safeUrl && h('a', { class: 'sch-link', href: safeUrl, target: '_blank', rel: 'noopener noreferrer' }, shopLabel(safeUrl)),
            ),
          !isOpen &&
            h(
              'span',
              { class: 'wish-result' },
              h('b', {}, WISH_STATUS[w.status] ?? 'クローズ'),
              w.rating > 0 && h('span', { class: 'wish-stars', 'aria-label': `評価 ${w.rating}` }, ` ${stars(w.rating)}`),
              w.result && ` ${w.result}`,
              w.closedAt && ` ・ ${fmtDateTime(w.closedAt)}`,
            ),
        ),
        isOpen &&
          h(
            'button',
            {
              class: 'wish-close',
              onClick: async () => {
                const res = await closeWishSheet(w, kind);
                if (res) store.patchListItem(groupId, listId, w.id, { ...res, closedAt: Date.now() }).catch(showError);
              },
            },
            '完了',
          ),
        h(
          'button',
          {
            class: 'sch-more',
            'aria-label': 'メニュー',
            onClick: () =>
              actionSheet(wishTitle(w), [
                {
                  label: '編集',
                  onClick: async () => {
                    const res = await wishSheet(groupId, w, { editing: true, list });
                    if (!res) return;
                    try {
                      const photoId = await applyPhoto(w, res.photo);
                      await store.patchListItem(groupId, listId, w.id, { text: res.text, url: res.url, photoId, place: res.place, how: res.how });
                    } catch (e) {
                      showError(e);
                    }
                  },
                },
                kind.place && isOpen && { label: '📅 予定にする', onClick: () => makePlan(w) },
                { label: 'ほかのリストへ移す', onClick: () => moveTo(w) },
                !isOpen && { label: '未完了に戻す', onClick: () => store.patchListItem(groupId, listId, w.id, { status: 'open', result: '', rating: 0, closedAt: null }).catch(showError) },
                {
                  label: '削除',
                  danger: true,
                  onClick: async () => {
                    if (!(await confirmSheet(`「${wishTitle(w)}」を削除しますか？`))) return;
                    if (w.photoId) store.deletePhoto(groupId, w.photoId);
                    store.deleteItem(groupId, listId, w.id).catch(showError);
                  },
                },
              ].filter(Boolean)),
          },
          '⋮',
        ),
      );
    };

    setChildren(
      top,
      header({
        title: `${list.emoji} ${list.title}`,
        back,
        onMenu: () =>
          actionSheet(list.title, [
            {
              label: '詳しく追加（URL・写真など）',
              onClick: async () => {
                const res = await wishSheet(groupId, {}, { list });
                if (res) saveNewWish(groupId, listId, res).catch(showError);
              },
            },
            {
              label: 'リスト名を変更',
              onClick: async () => {
                const name = await askText({ title: 'リスト名を変更', value: list.title, okLabel: '保存' });
                if (name) store.updateList(groupId, listId, { title: name }).catch(showError);
              },
            },
            {
              label: 'リストを削除',
              danger: true,
              onClick: async () => {
                if (!(await confirmSheet(`「${list.title}」を削除しますか？（写真も消えます）`))) return;
                for (const w of list.items) if (w.photoId) store.deletePhoto(groupId, w.photoId);
                store.deleteList(groupId, listId).then(() => (location.hash = back), showError);
              },
            },
          ]),
      }),
    );

    setChildren(
      body,
      open.length === 0 && closed.length === 0 && h('p', { class: 'empty small' }, kind.empty),
      open.length > 0 && h('ul', { class: 'wish-list' }, open.map(row)),
      closed.length > 0 &&
        h(
          'button',
          {
            class: 'past-toggle',
            onClick: () => {
              showClosed = !showClosed;
              render();
            },
          },
          `${showClosed ? '▾' : '▸'} 完了済み（${closed.length}）`,
        ),
      showClosed && closed.length > 0 && h('ul', { class: 'wish-list' }, closed.map(row)),
    );
  }

  const onGone = (e) => {
    if (e?.code !== 'permission-denied' && e?.message !== 'not-found') return showError(e);
    toast('リストが見つかりません');
    location.hash = `#/g/${groupId}`;
  };
  return store.watchList(groupId, listId, (l) => ((list = l), render()), onGone);
}

// ---- 画面：貸し借りリスト ----
// 円形に並べたメンバーの図で、人から人へドラッグすると「その人がその人に貸した」を登録できる。
// 未精算の貸し借りは「貸した人 → 借りた人」の矢印で表示（同じ向きはまとめる）。

const moneyDrag = { active: false, pendingRender: null };
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function moneySheet(members, initial = {}, { editing = false } = {}) {
  return openSheet((close) => {
    const personSelect = (label, value) => {
      const sel = h(
        'select',
        { class: 'text-input', 'aria-label': label },
        h('option', { value: '' }, `${label}を選ぶ`),
        members.map((m) => h('option', { value: m.uid }, m.uid === user.uid ? `${m.name}（自分）` : m.name)),
      );
      sel.value = value ?? '';
      return sel;
    };
    const from = personSelect('貸した人', initial.from);
    const to = personSelect('借りた人', initial.to);
    let kind = initial.kind ?? 'money';
    const amount = h('input', { class: 'text-input', type: 'number', inputmode: 'numeric', min: 1, step: 1, value: initial.amount ?? '', placeholder: '金額（円）', 'aria-label': '金額' });
    const item = h('input', { class: 'text-input', value: initial.item ?? '', placeholder: '貸したもの（例：本、傘）', maxlength: 60, 'aria-label': '貸したもの' });
    const kindBtns = h('div', { class: 'people-chips' });
    const syncKind = () => {
      setChildren(
        kindBtns,
        [['money', '💴 お金'], ['item', '📦 もの']].map(([k, label]) =>
          h(
            'button',
            {
              type: 'button',
              class: `chip${kind === k ? ' on' : ''}`,
              onClick: () => {
                kind = k;
                syncKind();
              },
            },
            label,
          ),
        ),
      );
      amount.style.display = kind === 'money' ? '' : 'none';
      item.style.display = kind === 'item' ? '' : 'none';
    };
    syncKind();
    const memo = h('input', { class: 'text-input', value: initial.memo ?? '', placeholder: 'メモ（例：ランチ代）', maxlength: 100, 'aria-label': 'メモ' });
    const date = h('input', { class: 'text-input', type: 'date', value: initial.date ?? todayStr(), 'aria-label': '日付' });
    return [
      h('div', { class: 'sheet-title' }, editing ? '貸し借りを編集' : '貸し借りを登録'),
      h(
        'form',
        {
          class: 'sheet-form',
          onSubmit: (e) => {
            e.preventDefault();
            if (!from.value || !to.value) return toast('貸した人と借りた人を選んでください');
            if (from.value === to.value) return toast('貸した人と借りた人が同じです');
            const yen = Math.round(Number(amount.value));
            if (kind === 'money' && !(yen > 0)) return toast('金額を入れてください');
            if (kind === 'item' && !item.value.trim()) return toast('貸したものを入れてください');
            close({
              from: from.value,
              to: to.value,
              kind,
              amount: kind === 'money' ? yen : null,
              item: kind === 'item' ? item.value.trim() : '',
              memo: memo.value.trim(),
              date: date.value || todayStr(),
            });
          },
        },
        h('div', { class: 'money-who' }, from, h('span', { class: 'money-arrow' }, '→ 貸した →'), to),
        kindBtns,
        amount,
        item,
        memo,
        date,
        h(
          'div',
          { class: 'sheet-buttons' },
          h('button', { type: 'button', class: 'btn', onClick: () => close(null) }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn primary' }, editing ? '保存' : '登録'),
        ),
      ),
    ];
  });
}

// 円形の図。onLink(from, to) はドラッグで人から人へ線を引いたときに呼ぶ
function moneyDiagram(members, entries, onLink) {
  const size = 320;
  const c = size / 2;
  const R = members.length <= 2 ? 90 : 116;
  const nodeR = 24;
  const pos = Object.fromEntries(
    members.map((m, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(members.length, 1);
      return [m.uid, { x: c + R * Math.cos(a), y: c + R * Math.sin(a) }];
    }),
  );

  // 同じ向き（貸した人 → 借りた人）の未精算をまとめる
  const pairs = new Map();
  for (const e of entries) {
    if (e.settled || !pos[e.from] || !pos[e.to]) continue;
    const key = `${e.from}>${e.to}`;
    const p = pairs.get(key) ?? { from: e.from, to: e.to, yen: 0, items: 0 };
    if (e.kind === 'item') p.items++;
    else p.yen += e.amount ?? 0;
    pairs.set(key, p);
  }

  const arrows = [...pairs.values()].map((p) => {
    const a = pos[p.from];
    const b = pos[p.to];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // 逆向きの矢印と重ならないよう、進む向きの右側にふくらませる（逆向きもあるときは大きめに）
    const bend = pairs.has(`${p.to}>${p.from}`) ? 32 : 14;
    const cx = (a.x + b.x) / 2 - uy * bend;
    const cy = (a.y + b.y) / 2 + ux * bend;
    const sx = a.x + ux * (nodeR + 4);
    const sy = a.y + uy * (nodeR + 4);
    const ex = b.x - ux * (nodeR + 8);
    const ey = b.y - uy * (nodeR + 8);
    const lx = 0.25 * sx + 0.5 * cx + 0.25 * ex;
    const ly = 0.25 * sy + 0.5 * cy + 0.25 * ey;
    const label = [p.yen ? fmtYen(p.yen) : '', p.items ? `📦${p.items}` : ''].filter(Boolean).join('＋');
    return svg(
      'g',
      { class: 'money-edge' },
      svg('path', { d: `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`, 'marker-end': 'url(#money-head)' }),
      svg('text', { x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, label),
    );
  });

  const nodes = members.map((m) =>
    svg(
      'g',
      { class: `money-node${m.uid === user.uid ? ' me' : ''}`, 'data-uid': m.uid, transform: `translate(${pos[m.uid].x},${pos[m.uid].y})` },
      svg('circle', { r: nodeR }),
      svg('text', { class: 'money-initial', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, [...m.name][0] ?? '?'),
      svg('text', { class: 'money-name', y: nodeR + 14, 'text-anchor': 'middle' }, m.name.length > 7 ? `${m.name.slice(0, 6)}…` : m.name),
    ),
  );

  const dragLine = svg('line', { class: 'money-drag', 'marker-end': 'url(#money-head-drag)', visibility: 'hidden' });
  const root = svg(
    'svg',
    { class: 'money-diagram', viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': '貸し借りの図' },
    svg(
      'defs',
      {},
      svg('marker', { id: 'money-head', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'money-head' })),
      svg('marker', { id: 'money-head-drag', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'money-head drag' })),
    ),
    arrows,
    dragLine,
    nodes,
  );

  // ドラッグ：人を押して、ほかの人のところで離す
  const toSvg = (ev) => {
    const pt = root.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    return pt.matrixTransform(root.getScreenCTM().inverse());
  };
  const nodeAt = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.money-node');
  root.addEventListener('touchstart', (e) => e.target.closest?.('.money-node') && e.preventDefault(), { passive: false });
  root.addEventListener('pointerdown', (e) => {
    const node = e.target.closest?.('.money-node');
    if (!node || e.button > 0 || moneyDrag.active) return;
    e.preventDefault();
    const fromUid = node.dataset.uid;
    const start = pos[fromUid];
    const pointerId = e.pointerId;
    moneyDrag.active = true;
    node.classList.add('dragging');
    let over = null;
    dragLine.setAttribute('x1', start.x);
    dragLine.setAttribute('y1', start.y);
    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      const p = toSvg(ev);
      dragLine.setAttribute('x2', p.x);
      dragLine.setAttribute('y2', p.y);
      dragLine.setAttribute('visibility', 'visible');
      const target = nodeAt(ev);
      const next = target && target !== node ? target : null;
      if (next !== over) {
        over?.classList.remove('target');
        next?.classList.add('target');
        over = next;
      }
    };
    const finish = (ev) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      dragLine.setAttribute('visibility', 'hidden');
      node.classList.remove('dragging');
      over?.classList.remove('target');
      moneyDrag.active = false;
      const toUid = over?.dataset.uid;
      if (toUid) onLink(fromUid, toUid);
      else if (ev.type === 'pointerup' && !dragLine.getAttribute('x2')) toast('貸した人から、借りた人までドラッグしてください');
      dragLine.removeAttribute('x2');
      dragLine.removeAttribute('y2');
      const render = moneyDrag.pendingRender;
      moneyDrag.pendingRender = null;
      render?.();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });
  return root;
}

function moneyView(root, { groupId, listId }) {
  const top = h('div', { class: 'topbar-wrap' });
  const body = h('main', { class: 'content' });
  root.append(top, body);
  let group = null;
  let list = null;
  let showSettled = false;

  function render() {
    if (!group || !list) return;
    // ドラッグ中は描き直さない（掴んでいる線が消えないように）
    if (moneyDrag.active) {
      moneyDrag.pendingRender = render;
      return;
    }
    const members = memberList(group);
    const nameOf = (u) => members.find((m) => m.uid === u)?.name ?? '（退出したメンバー）';
    const entries = [...list.items].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const open = entries.filter((e) => !e.settled);
    const settled = entries.filter((e) => e.settled);
    const back = list.eventId ? `#/g/${groupId}/e/${list.eventId}` : `#/g/${groupId}`;

    const add = async (initial) => {
      const res = await moneySheet(members, initial);
      if (res) store.addMoneyEntry(groupId, listId, res).then(() => toast('登録しました'), showError);
    };

    // 一人ずつの差し引き（お金だけ）
    const balance = {};
    for (const e of open) {
      if (e.kind === 'item') continue;
      balance[e.from] = (balance[e.from] ?? 0) + (e.amount ?? 0);
      balance[e.to] = (balance[e.to] ?? 0) - (e.amount ?? 0);
    }
    const balances = Object.entries(balance).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);

    const entryRow = (e) =>
      h(
        'li',
        { class: `money-row${e.settled ? ' settled' : ''}` },
        h(
          'label',
          { class: 'money-check', title: e.settled ? '未精算に戻す' : '精算済みにする' },
          h('input', {
            type: 'checkbox',
            class: 'item-check',
            checked: !!e.settled,
            'aria-label': '精算済み',
            onChange: async (ev) => {
              const box = ev.target;
              // 精算済みにするときだけ確認する（未精算に戻すときはそのまま）
              if (box.checked) {
                const what = e.kind === 'item' ? `「${e.item}」` : fmtYen(e.amount ?? 0);
                const ok = await confirmSheet(`${nameOf(e.from)} → ${nameOf(e.to)} の ${what} を精算済みにしますか？`, '精算済みにする');
                if (!ok) {
                  box.checked = false;
                  return;
                }
              }
              store.updateMoneyEntry(groupId, listId, e.id, { settled: box.checked }).catch(showError);
            },
          }),
        ),
        h(
          'span',
          { class: 'money-main' },
          h('span', { class: 'money-line' }, h('b', {}, nameOf(e.from)), ' → ', h('b', {}, nameOf(e.to))),
          h('span', { class: 'money-sub' }, [e.memo, fmtDate(e.date ?? todayStr())].filter(Boolean).join(' ・ ')),
        ),
        h('span', { class: 'money-value' }, e.kind === 'item' ? `📦 ${e.item}` : fmtYen(e.amount ?? 0)),
        h(
          'button',
          {
            class: 'sch-more',
            'aria-label': 'メニュー',
            onClick: () =>
              actionSheet(`${nameOf(e.from)} → ${nameOf(e.to)}`, [
                {
                  label: '編集',
                  onClick: async () => {
                    const res = await moneySheet(members, e, { editing: true });
                    if (res) store.updateMoneyEntry(groupId, listId, e.id, res).catch(showError);
                  },
                },
                {
                  label: '削除',
                  danger: true,
                  onClick: async () => {
                    if (await confirmSheet('この貸し借りを削除しますか？')) store.deleteItem(groupId, listId, e.id).catch(showError);
                  },
                },
              ]),
          },
          '⋮',
        ),
      );

    setChildren(
      top,
      header({
        title: `${list.emoji} ${list.title}`,
        back,
        onMenu: () =>
          actionSheet(list.title, [
            {
              label: 'リスト名を変更',
              onClick: async () => {
                const name = await askText({ title: 'リスト名を変更', value: list.title, okLabel: '保存' });
                if (name) store.updateList(groupId, listId, { title: name }).catch(showError);
              },
            },
            {
              label: 'リストを削除',
              danger: true,
              onClick: async () => {
                if (await confirmSheet(`「${list.title}」を削除しますか？`)) store.deleteList(groupId, listId).then(() => (location.hash = back), showError);
              },
            },
          ]),
      }),
    );

    setChildren(
      body,
      h(
        'div',
        { class: 'money-board' },
        members.length < 2
          ? h('p', { class: 'empty small' }, 'メンバーが 2 人以上になると、図から登録できます。')
          : moneyDiagram(members, open, (from, to) => add({ from, to })),
        members.length >= 2 && h('p', { class: 'sch-hint money-hint' }, '貸した人を押したまま、借りた人まで指を動かすと登録できます'),
      ),
      balances.length > 0 &&
        h(
          'div',
          { class: 'money-balances' },
          balances.map(([u, v]) =>
            h('span', { class: `money-balance ${v > 0 ? 'plus' : 'minus'}` }, nameOf(u), h('b', {}, `${v > 0 ? '+' : '−'}${fmtYen(Math.abs(v))}`), v > 0 ? '貸している' : '借りている'),
          ),
        ),
      h('p', { class: 'section-label' }, `未精算${open.length ? `（${open.length}件）` : ''}`),
      open.length === 0 && h('p', { class: 'empty small' }, '未精算の貸し借りはありません'),
      open.length > 0 && h('ul', { class: 'money-list' }, open.map(entryRow)),
      h('button', { class: 'add-card', onClick: () => add({ from: user.uid }) }, '＋ 貸し借りを登録'),
      settled.length > 0 &&
        h(
          'button',
          {
            class: 'past-toggle',
            onClick: () => {
              showSettled = !showSettled;
              render();
            },
          },
          `${showSettled ? '▾' : '▸'} 精算済み（${settled.length}）`,
        ),
      showSettled && settled.length > 0 && h('ul', { class: 'money-list' }, settled.map(entryRow)),
    );
  }

  const back = () => (location.hash = list?.eventId ? `#/g/${groupId}/e/${list.eventId}` : `#/g/${groupId}`);
  const onGone = (e) => {
    if (e?.code !== 'permission-denied' && e?.message !== 'not-found') return showError(e);
    toast('リストが見つかりません');
    back();
  };
  const unwatchGroup = store.watchGroup(groupId, (g) => ((group = g), render()), onGone);
  const unwatchList = store.watchList(groupId, listId, (l) => ((list = l), render()), onGone);
  return () => {
    unwatchGroup();
    unwatchList();
  };
}

function checklistView(root, { groupId, listId }) {
  const top = h('div', { class: 'topbar-wrap' });
  const body = h('main', { class: 'content with-footer' });
  const input = h('input', { class: 'text-input', placeholder: 'アイテムを追加', maxlength: 100, enterkeyhint: 'enter', 'aria-label': 'アイテムを追加' });
  // 入力欄は再描画しない（連続入力中にフォーカスが外れないように）
  const footer = h(
    'form',
    {
      class: 'add-bar',
      onSubmit: (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        input.focus();
        // オフラインでも手元にはすぐ反映されるので、完了を待たない
        store.addItem(groupId, listId, text).catch(showError);
      },
    },
    input,
    h('button', { type: 'submit', class: 'btn primary' }, '追加'),
  );
  root.append(top, body, footer);

  return store.watchList(
    groupId,
    listId,
    (list) => {
      const { items, done } = list;
      const sorted = [...items.filter((i) => !i.checked), ...items.filter((i) => i.checked)];

      const back = list.eventId ? `#/g/${groupId}/e/${list.eventId}` : `#/g/${groupId}`;
      setChildren(
        top,
        header({
          title: `${list.emoji} ${list.title}`,
          back,
          onMenu: () =>
            actionSheet(list.title, [
              {
                label: 'ほかのリストからアイテムを追加',
                onClick: async () => {
                  const source = await pickSourceList(groupId, { excludeListId: listId, title: '追加元のリストを選ぶ' });
                  if (!source) return;
                  const texts = await pickItems(source, items.map((i) => i.text));
                  if (texts?.length) store.addItems(groupId, listId, texts).then(() => toast(`${texts.length}件を追加しました`), showError);
                },
              },
              {
                label: 'リスト名を変更',
                onClick: async () => {
                  const res = await askText({ title: 'リスト名を変更', value: list.title, okLabel: '保存', emojis: [list.emoji, ...LIST_EMOJIS.filter((e) => e !== list.emoji)] });
                  if (res) store.updateList(groupId, listId, { title: res.text, emoji: res.emoji }).catch(showError);
                },
              },
              { label: 'チェックをすべて外す', onClick: () => store.uncheckAll(groupId, list).catch(showError) },
              {
                label: 'チェック済みを削除',
                danger: true,
                onClick: async () => {
                  if (done && (await confirmSheet(`チェック済みの ${done} 件を削除しますか？`))) store.deleteChecked(groupId, list).catch(showError);
                },
              },
              {
                label: 'リストを削除',
                danger: true,
                onClick: async () => {
                  if (await confirmSheet(`「${list.title}」を削除しますか？`)) {
                    store.deleteList(groupId, listId).then(() => (location.hash = back), showError);
                  }
                },
              },
            ]),
        }),
      );

      setChildren(
        body,
        h(
          'div',
          { class: 'summary' },
          h('span', {}, items.length ? `${done} / ${items.length} 完了` : 'アイテムを追加しましょう（右上の ⋯ からほかのリストの取り込みもできます）'),
          items.length > 0 && done === items.length && h('span', { class: 'summary-done' }, '🎉 ぜんぶ完了！'),
        ),
        items.length > 0 && progressBar(done, items.length),
        h(
          'ul',
          { class: 'items' },
          sorted.map((item) =>
            h(
              'li',
              { class: `item${item.checked ? ' checked' : ''}` },
              h(
                'label',
                { class: 'item-label' },
                h('input', {
                  type: 'checkbox',
                  class: 'item-check',
                  checked: item.checked,
                  onChange: (e) => store.setItemChecked(groupId, listId, item.id, e.target.checked).catch(showError),
                }),
                h('span', { class: 'item-text' }, item.text),
              ),
              h(
                'button',
                { class: 'item-delete', 'aria-label': `${item.text} を削除`, onClick: () => store.deleteItem(groupId, listId, item.id).catch(showError) },
                '×',
              ),
            ),
          ),
        ),
      );
    },
    (e) => {
      if (e?.code !== 'permission-denied' && e?.message !== 'not-found') return showError(e);
      toast('リストが見つかりません');
      location.hash = `#/g/${groupId}`;
    },
  );
}

// ---- 画面：お知らせ一覧（groupId があればグループのお知らせ、なければアプリからのお知らせ） ----

function newsListView(root, { groupId = null }) {
  const top = h('div', { class: 'topbar-wrap' });
  const body = h('main', { class: 'content' });
  root.append(top, body);
  let group = null;
  let items = null;

  const canWrite = () => (groupId ? true : isAdmin);
  const canDelete = (n) => (groupId ? n.createdBy === user.uid || group?.members?.[user.uid]?.role === 'owner' : isAdmin);

  const notifyNews = (title, again = false) =>
    requestNotify(
      groupId
        ? { groupId, kind: 'news', title: `📢 ${group.name}${again ? '（再アナウンス）' : ''}`, body: `${title}（${auth.displayName()}さん）`, url: `#/g/${groupId}/news` }
        : { kind: 'appnews', title: `📢 ouchi-share からのお知らせ${again ? '（再アナウンス）' : ''}`, body: title, url: '#/news' },
    );

  const write = async () => {
    const res = await newsSheet();
    if (!res) return;
    (groupId ? store.createGroupNews(groupId, res) : store.createAppNews(res)).then(() => {
      toast('お知らせを送りました');
      notifyNews(res.title);
    }, showError);
  };

  // 再アナウンス：みんなの未読に戻して、通知もあらためて送る
  const reannounce = async (n) => {
    if (!(await confirmSheet(`「${n.title}」をもう一度みんなに知らせますか？（みんなの未読に戻り、通知も届きます）`, '再アナウンスする'))) return;
    store.reannounceNews(groupId, n.id).then(() => {
      toast('もう一度お知らせしました');
      notifyNews(n.title, true);
    }, showError);
  };

  function render() {
    if (!items || (groupId && !group)) return;
    setChildren(top, header({ title: groupId ? `${group.name}のお知らせ` : 'アプリからのお知らせ', back: groupId ? `#/g/${groupId}` : '#/' }));
    const sorted = [...items].sort((a, b) => newsTime(b) - newsTime(a));
    setChildren(
      body,
      canWrite() && h('button', { class: 'add-card news-add', onClick: write }, '＋ お知らせを書く'),
      sorted.length === 0 && h('p', { class: 'empty' }, 'お知らせはまだありません'),
      h(
        'div',
        { class: 'news-list' },
        sorted.map((n) =>
          h(
            'div',
            { class: `news-row${isNewsRead(n) ? '' : ' unread'}` },
            h(
              'button',
              {
                class: 'news-row-main',
                onClick: async () => {
                  if ((await newsPopup(n)) === 'read') store.markRead(n.key).catch(showError);
                },
              },
              h('span', { class: 'news-row-title' }, !isNewsRead(n) && h('i', { class: 'news-dot', 'aria-label': '未読' }), n.title),
              h('span', { class: 'news-row-meta' }, `${n.createdByName ?? ''} ・ ${fmtDateTime(n.createdAt)}${n.announcedAt ? ` ・ 🔁 ${fmtDateTime(n.announcedAt)}` : ''}`),
            ),
            canDelete(n) &&
              h('button', { class: 'news-delete', 'aria-label': `${n.title} を再アナウンス`, title: 'もう一度みんなに知らせる', onClick: () => reannounce(n) }, '🔁'),
            canDelete(n) &&
              h(
                'button',
                {
                  class: 'news-delete',
                  'aria-label': `${n.title} を削除`,
                  onClick: async () => {
                    if (await confirmSheet(`「${n.title}」を削除しますか？`)) (groupId ? store.deleteGroupNews(groupId, n.id) : store.deleteAppNews(n.id)).catch(showError);
                  },
                },
                '🗑',
              ),
          ),
        ),
      ),
    );
  }

  const sourceName = () => (groupId ? group?.name ?? 'グループ' : 'アプリ');
  const toItems = (list) => list.map((n) => ({ ...n, key: groupId ? `g:${groupId}:${n.id}` : `app:${n.id}`, sourceId: groupId ? `g:${groupId}` : 'app', sourceName: sourceName() }));
  const onError = (e) => {
    showError(e);
    location.hash = groupId ? `#/g/${groupId}` : '#/';
  };
  const unwatchItems = groupId
    ? store.watchGroupNews(groupId, (list) => ((items = toItems(list)), render()), onError)
    : store.watchAppNews((list) => ((items = toItems(list)), render()), onError);
  const unwatchGroup = groupId ? store.watchGroup(groupId, (g) => ((group = g), items && (items = items.map((n) => ({ ...n, sourceName: g.name }))), render()), onError) : null;
  newsListeners.add(render);
  return () => {
    unwatchItems();
    unwatchGroup?.();
    newsListeners.delete(render);
  };
}

// ---- ルーター（URL の # 以降で画面を切り替える） ----

const routes = [
  [/^#\/g\/([\w-]+)\/l\/([\w-]+)$/, (m) => [listView, { groupId: m[1], listId: m[2] }]],
  [/^#\/g\/([\w-]+)\/e\/([\w-]+)$/, (m) => [eventView, { groupId: m[1], eventId: m[2] }]],
  [/^#\/g\/([\w-]+)\/e\/([\w-]+)\/d\/(\d{4}-\d{2}-\d{2})$/, (m) => [eventView, { groupId: m[1], eventId: m[2], date: m[3] }]],
  [/^#\/g\/([\w-]+)$/, (m) => [groupView, { groupId: m[1] }]],
  [/^#\/admin$/, () => [adminView, {}]],
  [/^#\/news$/, () => [newsListView, {}]],
  [/^#\/g\/([\w-]+)\/news$/, (m) => [newsListView, { groupId: m[1] }]],
];

let unmount = null;

function route() {
  unmount?.();
  unmount = null;
  app.replaceChildren();
  const hash = location.hash;

  if (user === undefined) return loadingView(app);

  const join = hash.match(/^#\/join\/([\w-]+)\/([\w-]+)$/);
  if (join) return joinView(app, { groupId: join[1], code: join[2] });

  const recover = hash.match(/^#\/recover(?:\/([0-9A-Za-z]+))?$/);
  if (recover) return recoverView(app, { code: recover[1] ?? '' });

  if (!user) return welcomeView(app);
  if (auth.needsName()) return nameSetupView(app);

  for (const [re, make] of routes) {
    const m = hash.match(re);
    if (m) {
      const [view, params] = make(m);
      unmount = view(app, params);
      return;
    }
  }
  unmount = homeView(app);
}

window.addEventListener('hashchange', () => {
  route();
  heartbeat();
});

// ---- オンライン表示のための「今開いてるよ」の記録 ----
// 画面が表示されている間だけ 1 分ごとに記録する（見ているグループがあればそのグループにも）

let lastBeat = { at: 0, groupId: null };

function heartbeat(force = false) {
  // ログイン処理中や名前が未設定のうちは記録しない（「ゲスト」などの仮の名前で残らないように）
  if (!user || authBusy || auth.needsName() || document.visibilityState !== 'visible') return;
  const groupId = location.hash.match(/^#\/g\/([\w-]+)/)?.[1] ?? null;
  const now = Date.now();
  // グループを移動した直後はすぐ記録、それ以外は 1 分に 1 回まで
  if (!force && groupId === lastBeat.groupId && now - lastBeat.at < 55 * 1000) return;
  lastBeat = { at: now, groupId };
  store.touchPresence(groupId).catch(() => {});
}

setInterval(() => heartbeat(), 60 * 1000);
document.addEventListener('visibilitychange', () => heartbeat(true));

auth.watchUser((u) => {
  user = u;
  startNewsWatchers(u);
  unwatchAdmin?.();
  unwatchAdmin = null;
  isAdmin = false;
  if (u && !u.isAnonymous) {
    unwatchAdmin = store.watchIsAdmin(u.uid, (v) => {
      if (v === isAdmin) return;
      isAdmin = v;
      if (!authBusy && !location.hash.match(/^#\/g\//)) route();
    });
  }
  if (!authBusy) route();
  heartbeat(true);
});

route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
