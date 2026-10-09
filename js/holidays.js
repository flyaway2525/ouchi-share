// 日本の祝日（「国民の祝日に関する法律」の今の決まりから、アプリの中で計算する。通信なし）
// - 固定の日、ハッピーマンデー（第 n 月曜）、春分の日・秋分の日（計算式。1980〜2099 年）
// - 振替休日：祝日が日曜なら、次の祝日でない日が休み
// - 国民の休日：前の日と次の日が祝日で、その日が祝日・日曜でない日（9 月の敬老の日と秋分の日の間など）
// - 2020・2021 年（東京オリンピック）の移動、2019 年の天皇誕生日なしにも合わせてある
// 法律が変わったら、ここを直す。戻り値は Map（"YYYY-MM-DD" → 祝日の名前）

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// その月の第 n 月曜日
const nthMonday = (y, m, n) => {
  const first = new Date(y, m - 1, 1).getDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
};
const equinox = (y, base) => Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

const cache = new Map();

export function holidaysOf(y) {
  if (cache.has(y)) return cache.get(y);
  const h = new Map();
  const add = (m, d, name) => h.set(ymd(y, m, d), name);
  add(1, 1, '元日');
  add(1, nthMonday(y, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  if (y >= 2020) add(2, 23, '天皇誕生日');
  add(3, equinox(y, 20.8431), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  // 海の日・山の日・スポーツの日（2020・2021 年はオリンピックで移動）
  if (y === 2020) {
    add(7, 23, '海の日');
    add(7, 24, 'スポーツの日');
    add(8, 10, '山の日');
  } else if (y === 2021) {
    add(7, 22, '海の日');
    add(7, 23, 'スポーツの日');
    add(8, 8, '山の日');
  } else {
    add(7, nthMonday(y, 7, 3), '海の日');
    if (y >= 2016) add(8, 11, '山の日');
    add(10, nthMonday(y, 10, 2), y >= 2020 ? 'スポーツの日' : '体育の日');
  }
  add(9, nthMonday(y, 9, 3), '敬老の日');
  add(9, equinox(y, 23.2488), '秋分の日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');
  if (y <= 2018) add(12, 23, '天皇誕生日');

  // 国民の休日（前後が祝日に挟まれた平日）
  for (const date of [...h.keys()]) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + 2);
    const after = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    d.setDate(d.getDate() - 1);
    const mid = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (h.has(after) && !h.has(mid) && d.getDay() !== 0 && mid.startsWith(`${y}-`)) h.set(mid, '国民の休日');
  }
  // 振替休日（日曜の祝日の次の、祝日でない日）
  for (const date of [...h.keys()].sort()) {
    const d = new Date(`${date}T00:00:00`);
    if (d.getDay() !== 0) continue;
    do d.setDate(d.getDate() + 1);
    while (h.has(ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())));
    const sub = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (sub.startsWith(`${y}-`)) h.set(sub, '振替休日');
  }
  cache.set(y, h);
  return h;
}

// その日の祝日の名前（祝日でなければ null）
export function holidayName(date) {
  return holidaysOf(Number(date.slice(0, 4))).get(date) ?? null;
}
