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
  actionSheet(`${auth.displayName()}${guest ? '（ゲスト）' : ''}`, [
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

function eventSheet({ title = '', emoji = EVENT_EMOJIS[0], startDate = todayStr(), endDate } = {}, okLabel = '作成') {
  let chosen = emoji;
  return openSheet((close) => {
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
            close({ title: t, emoji: chosen, startDate: startInput.value, endDate: endInput.value });
          },
        },
        picker,
        titleInput,
        h('div', { class: 'date-row' }, h('label', {}, '開始', startInput), h('label', {}, '終了', endInput)),
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

function byStart(a, b) {
  return toMin(a.start) - toMin(b.start) || (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

function dayItems(items, date) {
  return items.filter((i) => i.date === date && i.start).sort(byStart);
}

// その日の最後の予定が終わる時刻（予定がなければ 9:00）
function nextStart(items, date) {
  const day = dayItems(items, date);
  if (!day.length) return DEFAULT_START;
  const last = day[day.length - 1];
  return toHHMM(Math.min(toMin(last.start) + (last.duration ?? DEFAULT_DURATION), 23 * 60 + 59));
}

// 並べ替え後の順番で、最初の開始時刻はそのまま、各予定の長さを保って詰め直す
function reflow(ordered, firstStart) {
  let t = toMin(firstStart);
  const starts = {};
  for (const it of ordered) {
    starts[it.id] = toHHMM(Math.min(t, 47 * 60 + 59));
    t += it.duration ?? DEFAULT_DURATION;
  }
  return starts;
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
    const timeRow = h('div', { class: 'date-row' }, h('label', {}, '開始', start), h('label', {}, '長さ', durationSel));
    const syncTimeRow = () => (timeRow.style.display = dateSel.value ? '' : 'none');
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
            if (date && !start.value) return toast('開始時刻を入れてください');
            close({
              title: t,
              date,
              start: date ? start.value : null,
              duration: Number(durationSel.value),
              place: place.value.trim(),
              memo: memo.value.trim(),
            });
          },
        },
        title,
        dateSel,
        timeRow,
        place,
        memo,
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

const scheduleDrag = { active: false, pendingRender: null };

function enableScheduleDrag(container, onDrop) {
  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.sch-handle');
    if (!handle || e.button > 0) return;
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
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // キャプチャできない環境でも、つまみの上のイベントで動く
    }
    navigator.vibrate?.(10);

    let y = e.clientY;
    let overList = null;

    // 指の位置にあるリストの、指より下にある最初の行の前へ移動する（見た目上の仮の位置）
    const place = () => {
      ghost.style.top = `${y - offsetY}px`;
      ghost.style.visibility = 'hidden';
      const el = document.elementFromPoint(centerX, y);
      ghost.style.visibility = '';
      const list = el?.closest('.sch-day')?.querySelector('.sch-list[data-drop]');
      if (!list) return;
      if (overList !== list) {
        overList?.closest('.sch-day').classList.remove('drag-over');
        list.closest('.sch-day').classList.add('drag-over');
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

    const onMove = (ev) => {
      y = ev.clientY;
      place();
    };
    const finish = (cancelled) => {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      ghost.remove();
      li.classList.remove('sch-placeholder');
      container.classList.remove('dragging');
      overList?.closest('.sch-day').classList.remove('drag-over');
      const list = li.parentElement;
      scheduleDrag.active = false;
      if (!cancelled) onDrop(li.dataset.id, list.dataset.drop, [...list.children].map((r) => r.dataset.id));
      // 仮に動かした DOM を正しい状態に戻すため、必ず描き直す
      const render = scheduleDrag.pendingRender;
      scheduleDrag.pendingRender = null;
      render?.();
    };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  });
}

function scheduleSection(groupId, ev, schedule) {
  const items = schedule?.items ?? [];
  const days = eventDays(ev);
  const candidates = items.filter((i) => !i.date).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const outside = items.filter((i) => i.date && !days.includes(i.date)).sort((a, b) => a.date.localeCompare(b.date) || byStart(a, b));

  const add = async (initial) => {
    const res = await scheduleItemSheet(ev, items, initial);
    if (res) store.addScheduleItem(groupId, ev.id, res).catch(showError);
  };

  // 上へ・下へ：入れ替えてから、その日の最初の開始時刻を基準に詰め直す
  const move = (item, delta) => {
    const day = dayItems(items, item.date);
    const i = day.findIndex((x) => x.id === item.id);
    const j = i + delta;
    if (j < 0 || j >= day.length) return;
    const ordered = [...day];
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    store.setScheduleStarts(groupId, ev.id, reflow(ordered, day[0].start)).catch(showError);
  };

  // ドロップ：移動先の日を並びどおりに詰め直す。別の日・候補から来た／へ行った場合は、元の日も詰め直す
  //   target: "YYYY-MM-DD"（日）または ""（行きたい候補）、orderedIds: 移動先リストの見た目の並び
  const onDrop = (id, target, orderedIds) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const from = item.date ?? '';
    const changes = {};
    const set = (itemId, patch) => (changes[itemId] = { ...changes[itemId], ...patch });

    if (target === '') {
      if (from === '') return; // 候補どうしの並びは保存しない（追加順）
      set(id, { date: null, start: null });
    } else {
      const before = dayItems(items, target);
      if (from === target && before.map((i) => i.id).join() === orderedIds.join()) return; // 動いていない
      const base = (from === target ? before[0]?.start : before.find((i) => i.id !== id)?.start) ?? DEFAULT_START;
      const ordered = orderedIds.map((x) => (x === id ? { ...item, duration: item.duration ?? DEFAULT_DURATION } : items.find((i) => i.id === x))).filter(Boolean);
      for (const [itemId, start] of Object.entries(reflow(ordered, base))) set(itemId, { start });
      if (from !== target) set(id, { date: target, duration: item.duration ?? DEFAULT_DURATION });
    }
    if (from !== '' && from !== target) {
      const src = dayItems(items, from);
      const rest = src.filter((i) => i.id !== id);
      if (rest.length) for (const [itemId, start] of Object.entries(reflow(rest, src[0].start))) set(itemId, { start });
    }
    store.patchScheduleItems(groupId, ev.id, changes).catch(showError);
  };

  const scheduleInto = async (item) => {
    const date = await openSheet((close) => [
      h('div', { class: 'sheet-title' }, `「${item.title}」をいつにする？`),
      ...days.map((d, i) => h('button', { class: 'sheet-action', onClick: () => close(d) }, `${i + 1}日目 ${fmtDate(d)}`)),
      h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, 'キャンセル'),
    ]);
    if (date) store.updateScheduleItem(groupId, ev.id, item.id, { date, start: nextStart(items, date), duration: item.duration ?? DEFAULT_DURATION }).catch(showError);
  };

  const itemMenu = (item, day) => {
    const i = day ? day.findIndex((x) => x.id === item.id) : -1;
    actionSheet(item.title, [
      {
        label: '編集',
        onClick: async () => {
          const res = await scheduleItemSheet(ev, items, item, { editing: true });
          if (res) store.updateScheduleItem(groupId, ev.id, item.id, res).catch(showError);
        },
      },
      day && i > 0 && { label: '↑ 上へ（時刻を詰め直す）', onClick: () => move(item, -1) },
      day && i < day.length - 1 && { label: '↓ 下へ（時刻を詰め直す）', onClick: () => move(item, 1) },
      item.date
        ? { label: '💡 行きたい候補に戻す', onClick: () => store.updateScheduleItem(groupId, ev.id, item.id, { date: null, start: null }).catch(showError) }
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
    (item.place || item.memo) &&
    h(
      'span',
      { class: 'sch-details' },
      item.place && h('a', { class: 'sch-place', href: mapsUrl(item.place), target: '_blank', rel: 'noopener', onClick: (e) => e.stopPropagation() }, `📍${item.place}`),
      item.memo && h('span', { class: 'sch-memo' }, item.memo),
    );

  const timedRow = (item, day) => {
    const s = toMin(item.start);
    const dur = item.duration ?? DEFAULT_DURATION;
    return h(
      'li',
      { class: 'sch-item', 'data-id': item.id },
      day && h('span', { class: 'sch-handle', 'aria-label': `${item.title} をドラッグして移動`, title: 'ドラッグして移動' }, '⠿'),
      h('span', { class: 'sch-time' }, h('span', {}, fmtTime(s)), h('span', { class: 'sch-end' }, `–${fmtTime(s + dur)}`)),
      h('span', { class: 'sch-main' }, h('span', { class: 'sch-title' }, item.title), details(item)),
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

  const section = h(
    'div',
    { class: 'schedule' },
    h('p', { class: 'section-label' }, '🗓 旅程'),
    days.map((d, n) => {
      const day = dayItems(items, d);
      return h(
        'div',
        { class: 'sch-day' },
        h('div', { class: 'sch-day-head' }, h('span', {}, `${n + 1}日目`), h('span', { class: 'sch-day-date' }, fmtDate(d))),
        h('ul', { class: 'sch-list', 'data-drop': d }, day.map((it) => timedRow(it, day))),
        h('button', { class: 'sch-add', onClick: () => add({ date: d }) }, '＋ 予定を追加'),
      );
    }),
    outside.length > 0 &&
      h(
        'div',
        { class: 'sch-day' },
        h('div', { class: 'sch-day-head' }, h('span', {}, '⚠️ イベント期間外の予定')),
        h('ul', { class: 'sch-list' }, outside.map((it) => timedRow(it, null))),
      ),
    h(
      'div',
      { class: 'sch-day candidates' },
      h('div', { class: 'sch-day-head' }, h('span', {}, '💡 行きたい候補（日時未定）')),
      h('ul', { class: 'sch-list', 'data-drop': '' }, candidates.map(candidateRow)),
      h('button', { class: 'sch-add', onClick: () => add({ date: null }) }, '＋ 候補を追加'),
    ),
    items.some((i) => i.date && days.includes(i.date)) || candidates.length
      ? h('p', { class: 'sch-hint' }, '⠿ を押したまま動かすと、順番の入れ替えや別の日への移動ができます（時刻は自動で詰め直します）')
      : null,
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
          id === user.uid ? { class: 'is-me', onClick: () => (close(null), renameInGroup(group)) } : {},
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
  const top = h('div');
  const body = h('main', { class: 'content' });
  const members = h('div');
  root.append(top, body);
  let group;

  // オンライン表示は時間がたつと変わるので、定期的に描き直す
  function renderMembers() {
    if (!group) return;
    const all = Object.values(group.members ?? {});
    const online = all.filter((m) => store.isOnline(m.lastSeen));
    setChildren(
      members,
      h(
        'div',
        { class: 'member-strip' },
        h(
          'button',
          { class: 'member-strip-count', onClick: () => membersSheet(group, recoveryCodes) },
          h('span', {}, `👥 メンバー ${all.length} 人`),
          online.length > 0 && h('span', { class: 'online-count' }, onlineDot(true), `${online.length} 人がオンライン`),
        ),
        h('button', { class: 'member-strip-invite', onClick: () => inviteQrSheet(group) }, '＋ 招待'),
      ),
    );
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
      const owner = g.members?.[user.uid]?.role === 'owner';
      if (owner && !unwatchRecovery) {
        unwatchRecovery = store.watchRecoveryCodes(groupId, (codes) => (recoveryCodes = codes), () => {});
      }
      setChildren(
        top,
        header({
          title: g.name,
          back: '#/',
          onMenu: () =>
            actionSheet(g.name, [
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
    },
    onGone,
  );

  let lists = null;
  let events = null;
  let showPast = false;

  function renderBody() {
    if (!lists || !events) return;
    const checklists = lists.filter((l) => (l.type ?? 'checklist') === 'checklist');
    const daily = checklists.filter((l) => !l.eventId);
    const { active, past } = sortEvents(events);
    const eventCard = (ev) => {
      const st = eventStatus(ev);
      const evLists = checklists.filter((l) => l.eventId === ev.id);
      const total = evLists.reduce((n, l) => n + l.total, 0);
      const done = evLists.reduce((n, l) => n + l.done, 0);
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
    setChildren(
      body,
      members,
      h('p', { class: 'section-label' }, '📅 イベント'),
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
            const res = await eventSheet();
            if (res) store.createEvent(groupId, res).then((id) => (location.hash = `#/g/${groupId}/e/${id}`), showError);
          },
        },
        '＋ イベントを作成',
      ),
      h('p', { class: 'section-label' }, '🏡 日常'),
      daily.length === 0 && h('p', { class: 'empty small' }, 'まだリストがありません'),
      h('div', { class: 'card-list' }, daily.map((l) => listCard(groupId, l))),
      h('button', { class: 'add-card', onClick: () => addListMenu(groupId) }, '＋ リストを追加'),
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

  return () => {
    clearInterval(ticker);
    unwatchRecovery?.();
    unwatchGroup();
    unwatchLists();
    unwatchEvents();
  };
}

function listCard(groupId, l) {
  return h(
    'a',
    { class: 'card', href: `#/g/${groupId}/l/${l.id}` },
    h('span', { class: 'card-icon' }, l.emoji),
    h(
      'span',
      { class: 'card-main' },
      h('span', { class: 'card-title' }, l.title),
      h('span', { class: 'card-sub' }, l.total ? `${l.done} / ${l.total} 完了` : '空のリスト'),
      l.total > 0 && progressBar(l.done, l.total),
    ),
    h('span', { class: 'chevron' }, '›'),
  );
}

// ---- 画面：イベント ----

function eventView(root, { groupId, eventId }) {
  const top = h('div');
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
    const mine = lists.filter((l) => l.eventId === eventId && (l.type ?? 'checklist') === 'checklist');
    const schedule = lists.find((l) => l.id === store.scheduleId(eventId));
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
                const res = await eventSheet(ev, '保存');
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
    setChildren(
      body,
      h(
        'div',
        { class: 'event-hero' },
        h('span', { class: 'event-dates' }, fmtRange(ev)),
        h('span', { class: `event-badge ${st.kind}` }, st.label),
      ),
      scheduleSection(groupId, ev, schedule),
      h('p', { class: 'section-label' }, '📝 リスト'),
      mine.length === 0 && h('p', { class: 'empty small' }, '持ち物リストなどを追加しましょう。日常のリストや過去のイベントから取り込むこともできます。'),
      h('div', { class: 'card-list' }, mine.map((l) => listCard(groupId, l))),
      h('button', { class: 'add-card', onClick: () => addListMenu(groupId, eventId) }, '＋ リストを追加'),
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

function checklistView(root, { groupId, listId }) {
  const top = h('div');
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

// ---- ルーター（URL の # 以降で画面を切り替える） ----

const routes = [
  [/^#\/g\/([\w-]+)\/l\/([\w-]+)$/, (m) => [checklistView, { groupId: m[1], listId: m[2] }]],
  [/^#\/g\/([\w-]+)\/e\/([\w-]+)$/, (m) => [eventView, { groupId: m[1], eventId: m[2] }]],
  [/^#\/g\/([\w-]+)$/, (m) => [groupView, { groupId: m[1] }]],
  [/^#\/admin$/, () => [adminView, {}]],
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
