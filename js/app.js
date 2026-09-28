import * as store from './store.js';

const app = document.getElementById('app');
const LIST_EMOJIS = ['📝', '🧳', '🧻', '🧊', '🛒', '💊', '🎒', '🏕️', '🎁', '🐶'];

// ---- 小さな DOM ヘルパー ----
// ユーザー入力は必ず textContent 経由で入れる（innerHTML は使わない）

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// false や null を含む子要素リストで中身を置き換える（条件付き表示用）
function setChildren(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}

function header({ title, back, onMenu }) {
  return h(
    'header',
    { class: 'topbar' },
    back
      ? h('a', { class: 'topbar-btn', href: back, 'aria-label': '戻る' }, '‹')
      : h('span', { class: 'topbar-btn' }),
    h('h1', { class: 'topbar-title' }, title),
    onMenu
      ? h('button', { class: 'topbar-btn', onClick: onMenu, 'aria-label': 'メニュー' }, '⋯')
      : h('span', { class: 'topbar-btn' }),
  );
}

function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h(
    'div',
    { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('div', { class: 'progress-fill', style: `width:${pct}%` }),
  );
}

// ---- ボトムシート（iOS の prompt/confirm の代わり） ----

function openSheet(build) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'sheet-backdrop' });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    const close = (value) => {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 200);
      resolve(value);
    };
    backdrop.addEventListener('click', (e) => e.target === backdrop && close(null));
    sheet.append(...build(close));
    backdrop.append(sheet);
    document.body.append(backdrop);
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      sheet.querySelector('input')?.focus();
    });
  });
}

function actionSheet(title, actions) {
  return openSheet((close) => [
    h('div', { class: 'sheet-title' }, title),
    ...actions.map((a) =>
      h(
        'button',
        {
          class: `sheet-action${a.danger ? ' danger' : ''}`,
          onClick: () => {
            close(null);
            a.onClick();
          },
        },
        a.label,
      ),
    ),
    h('button', { class: 'sheet-action cancel', onClick: () => close(null) }, 'キャンセル'),
  ]);
}

function confirmSheet(message, okLabel = '削除') {
  return openSheet((close) => [
    h('div', { class: 'sheet-title' }, message),
    h('button', { class: 'sheet-action danger', onClick: () => close(true) }, okLabel),
    h('button', { class: 'sheet-action cancel', onClick: () => close(false) }, 'キャンセル'),
  ]);
}

function askText({ title, value = '', placeholder = '', okLabel = 'OK', emojis }) {
  let emoji = emojis?.[0];
  return openSheet((close) => {
    const input = h('input', { class: 'text-input', value, placeholder, maxlength: 60, enterkeyhint: 'done' });
    const submit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) close(emojis ? { text, emoji } : text);
    };
    const picker =
      emojis &&
      h(
        'div',
        { class: 'emoji-picker' },
        emojis.map((em, i) => {
          const btn = h(
            'button',
            {
              type: 'button',
              class: `emoji-btn${i === 0 ? ' selected' : ''}`,
              onClick: () => {
                emoji = em;
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
      h('div', { class: 'sheet-title' }, title),
      h(
        'form',
        { class: 'sheet-form', onSubmit: submit },
        picker,
        input,
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

// ---- 画面：グループ一覧 ----

function homeView(root) {
  const body = h('main', { class: 'content' });
  root.append(header({ title: 'ouchi-share' }), body);

  async function refresh() {
    const groups = await store.listGroups();
    setChildren(body,
      h('p', { class: 'section-label' }, 'グループ'),
      h(
        'div',
        { class: 'card-list' },
        groups.map((g) =>
          h(
            'a',
            { class: 'card', href: `#/g/${g.id}` },
            h('span', { class: 'card-icon' }, '🏠'),
            h('span', { class: 'card-main' }, h('span', { class: 'card-title' }, g.name), h('span', { class: 'card-sub' }, `${g.listCount} 個のリスト`)),
            h('span', { class: 'chevron' }, '›'),
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'add-card',
          onClick: async () => {
            const name = await askText({ title: '新しいグループ', placeholder: '例：わが家、旅行メンバー', okLabel: '作成' });
            if (name) location.hash = `#/g/${await store.createGroup(name)}`;
          },
        },
        '＋ グループを作成',
      ),
    );
  }

  refresh();
  return store.subscribe(refresh);
}

// ---- 画面：グループ内のリスト一覧 ----

function groupView(root, { groupId }) {
  const top = h('div');
  const body = h('main', { class: 'content' });
  root.append(top, body);

  async function refresh() {
    let group, lists;
    try {
      [group, lists] = await Promise.all([store.getGroup(groupId), store.listLists(groupId)]);
    } catch {
      location.hash = '#/';
      return;
    }
    setChildren(top,
      header({
        title: group.name,
        back: '#/',
        onMenu: () =>
          actionSheet(group.name, [
            {
              label: 'グループ名を変更',
              onClick: async () => {
                const name = await askText({ title: 'グループ名を変更', value: group.name, okLabel: '保存' });
                if (name) store.renameGroup(groupId, name);
              },
            },
            {
              label: 'グループを削除',
              danger: true,
              onClick: async () => {
                if (await confirmSheet(`「${group.name}」と中のリストをすべて削除しますか？`)) {
                  await store.deleteGroup(groupId);
                  location.hash = '#/';
                }
              },
            },
          ]),
      }),
    );
    setChildren(body,
      h('p', { class: 'section-label' }, 'リスト'),
      lists.length === 0 && h('p', { class: 'empty' }, 'まだリストがありません'),
      h(
        'div',
        { class: 'card-list' },
        lists.map((l) =>
          h(
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
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'add-card',
          onClick: async () => {
            const res = await askText({ title: '新しいチェックリスト', placeholder: '例：キャンプの持ち物', okLabel: '作成', emojis: LIST_EMOJIS });
            if (res) {
              const id = await store.createList(groupId, { title: res.text, emoji: res.emoji });
              location.hash = `#/g/${groupId}/l/${id}`;
            }
          },
        },
        '＋ リストを作成',
      ),
    );
  }

  refresh();
  return store.subscribe(refresh);
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
      onSubmit: async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        await store.addItem(groupId, listId, text);
        input.focus();
      },
    },
    input,
    h('button', { type: 'submit', class: 'btn primary' }, '追加'),
  );
  root.append(top, body, footer);

  async function refresh() {
    let list, items;
    try {
      [list, items] = await Promise.all([store.getList(groupId, listId), store.listItems(groupId, listId)]);
    } catch {
      location.hash = `#/g/${groupId}`;
      return;
    }
    const done = items.filter((i) => i.checked).length;
    const sorted = [...items.filter((i) => !i.checked), ...items.filter((i) => i.checked)];

    setChildren(top,
      header({
        title: `${list.emoji} ${list.title}`,
        back: `#/g/${groupId}`,
        onMenu: () =>
          actionSheet(list.title, [
            {
              label: 'リスト名を変更',
              onClick: async () => {
                const res = await askText({ title: 'リスト名を変更', value: list.title, okLabel: '保存', emojis: [list.emoji, ...LIST_EMOJIS.filter((e) => e !== list.emoji)] });
                if (res) store.updateList(groupId, listId, { title: res.text, emoji: res.emoji });
              },
            },
            { label: 'チェックをすべて外す', onClick: () => store.uncheckAll(groupId, listId) },
            {
              label: 'チェック済みを削除',
              danger: true,
              onClick: async () => {
                if (done && (await confirmSheet(`チェック済みの ${done} 件を削除しますか？`))) store.deleteChecked(groupId, listId);
              },
            },
            {
              label: 'リストを削除',
              danger: true,
              onClick: async () => {
                if (await confirmSheet(`「${list.title}」を削除しますか？`)) {
                  await store.deleteList(groupId, listId);
                  location.hash = `#/g/${groupId}`;
                }
              },
            },
          ]),
      }),
    );

    setChildren(body,
      h(
        'div',
        { class: 'summary' },
        h('span', {}, items.length ? `${done} / ${items.length} 完了` : 'アイテムを追加しましょう'),
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
                onChange: (e) => store.updateItem(groupId, listId, item.id, { checked: e.target.checked }),
              }),
              h('span', { class: 'item-text' }, item.text),
            ),
            h(
              'button',
              { class: 'item-delete', 'aria-label': `${item.text} を削除`, onClick: () => store.deleteItem(groupId, listId, item.id) },
              '×',
            ),
          ),
        ),
      ),
    );
  }

  refresh();
  return store.subscribe(refresh);
}

// ---- ルーター（URL の # 以降で画面を切り替える） ----

const routes = [
  [/^#\/g\/([\w-]+)\/l\/([\w-]+)$/, (m) => [checklistView, { groupId: m[1], listId: m[2] }]],
  [/^#\/g\/([\w-]+)$/, (m) => [groupView, { groupId: m[1] }]],
];

let unmount = null;

function route() {
  unmount?.();
  app.replaceChildren();
  const hash = location.hash;
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

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
