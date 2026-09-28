// 画面部品（DOM ヘルパー・ヘッダー・ボトムシート・トースト）

// ---- 小さな DOM ヘルパー ----
// ユーザー入力は必ず textContent 経由で入れる（innerHTML は使わない）

export function h(tag, props = {}, ...children) {
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
export function setChildren(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}

export function header({ title, back, onMenu }) {
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

export function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h(
    'div',
    { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('div', { class: 'progress-fill', style: `width:${pct}%` }),
  );
}

// ---- ボトムシート（iOS の prompt/confirm の代わり） ----

export function openSheet(build) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'sheet-backdrop' });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    const close = (value) => {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 200);
      resolve(value);
    };
    // 背景のタップで閉じる。ただし入力欄で文字を選択しながら背景の上で指やマウスを離した場合は
    // 閉じない（押した場所と離した場所の両方が背景のときだけ閉じる）
    let downOnBackdrop = false;
    backdrop.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === backdrop));
    backdrop.addEventListener('click', (e) => {
      if (downOnBackdrop && e.target === backdrop) close(null);
      downOnBackdrop = false;
    });
    sheet.append(...build(close));
    backdrop.append(sheet);
    document.body.append(backdrop);
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      sheet.querySelector('input')?.focus();
    });
  });
}

export function actionSheet(title, actions) {
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

export function confirmSheet(message, okLabel = '削除') {
  return openSheet((close) => [
    h('div', { class: 'sheet-title' }, message),
    h('button', { class: 'sheet-action danger', onClick: () => close(true) }, okLabel),
    h('button', { class: 'sheet-action cancel', onClick: () => close(false) }, 'キャンセル'),
  ]);
}

export function askText({ title, value = '', placeholder = '', okLabel = 'OK', emojis }) {
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

// 画面下に一瞬だけ出るメッセージ
export function toast(message) {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2400);
}

// QR コード（必要になったときだけライブラリを読み込む）
let qrLib;

export function qrCode(text, size = 180) {
  const box = h('div', { class: 'qr', style: `width:${size}px;height:${size}px`, role: 'img', 'aria-label': `QRコード：${text}` });
  qrLib ??= import('https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/+esm').then((m) => m.default);
  qrLib
    .then((qrcode) => {
      const q = qrcode(0, 'M');
      q.addData(text);
      q.make();
      // ライブラリが生成した SVG 文字列を要素にする（ユーザー入力は含まれない）
      const svg = new DOMParser().parseFromString(q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }), 'image/svg+xml').documentElement;
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      box.replaceChildren(svg);
    })
    .catch(() => box.replaceChildren(h('span', { class: 'qr-error' }, 'QRコードを表示できませんでした')));
  return box;
}
