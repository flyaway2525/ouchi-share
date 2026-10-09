// 演出の部品（紙吹雪・絵文字が飛び散る・数字のカウントアップ・ぽよん）。
// - 「動きを減らす」設定（prefers-reduced-motion）の人には動かさない（結果だけ見える）
// - Web Animations API と canvas だけで作る（ライブラリ・通信なし）
// - 振動は Android のブラウザだけ（iPhone の Web は振動できない。アプリ版は今後 Haptics で）

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function haptic(ms = 12) {
  navigator.vibrate?.(ms);
}

const MEDAL_COLORS = {
  gold: ['#ffd700', '#ffcf40', '#fff3b0', '#e0a100', '#ffffff'],
  silver: ['#d9dee5', '#b8c2cc', '#ffffff', '#9aa6b2'],
  bronze: ['#e8a065', '#b8733a', '#f6c8a0', '#ffffff'],
  party: ['#f08a4b', '#ffd36e', '#3b7ddd', '#e57fa3', '#43a047', '#9b6bd6'],
};

// 紙吹雪（画面の上の方から舞い落ちる）。colors は MEDAL_COLORS の名前か色の配列
export function confetti({ colors = 'party', count = 90, duration = 2000 } = {}) {
  if (reduced()) return;
  const palette = Array.isArray(colors) ? colors : MEDAL_COLORS[colors] ?? MEDAL_COLORS.party;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth * (0.15 + Math.random() * 0.7),
    y: innerHeight * 0.35 + Math.random() * 40,
    vx: (Math.random() - 0.5) * 9,
    vy: -6 - Math.random() * 9,
    w: 6 + Math.random() * 6,
    h: 4 + Math.random() * 6,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: palette[Math.floor(Math.random() * palette.length)],
  }));
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - duration * 0.6) / (duration * 0.4));
    for (const p of parts) {
      p.vy += 0.28;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

// 要素のまん中から絵文字が飛び散る（メダル・✨ など）
export function burst(el, emojis = ['✨'], { count = 10, distance = 90 } = {}) {
  if (reduced() || !el?.isConnected) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const list = Array.isArray(emojis) ? emojis : [emojis];
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 'fx-spark';
    s.textContent = list[i % list.length];
    s.style.left = `${cx}px`;
    s.style.top = `${cy}px`;
    document.body.append(s);
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const d = distance * (0.6 + Math.random() * 0.6);
    s.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 20}px)) scale(1.1)`, opacity: 1, offset: 0.7 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.1}px), calc(-50% + ${Math.sin(a) * d + 10}px)) scale(0.8)`, opacity: 0 },
      ],
      { duration: 800 + Math.random() * 300, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
    ).onfinish = () => s.remove();
  }
}

// ぽよん（大きくなって戻る）。delay で順番に
export function pop(el, { delay = 0, scale = 1.25 } = {}) {
  if (reduced() || !el) return;
  el.animate(
    [
      { transform: 'scale(0.6)', opacity: 0 },
      { transform: `scale(${scale})`, opacity: 1, offset: 0.6 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 480, delay, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)', fill: 'backwards' },
  );
}

// 数字のカウントアップ（el の文字を from → to。format で見た目を作る）
export function countUp(el, to, { from = 0, duration = 700, delay = 0, format = (n) => String(n) } = {}) {
  if (!el) return;
  if (reduced() || to === from) {
    el.textContent = format(to);
    return;
  }
  el.textContent = format(from);
  const start = performance.now() + delay;
  const step = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
