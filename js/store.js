// データの読み書きをまとめた層。
// いまは localStorage に保存しているが、画面側はこのファイルの関数だけを使うので、
// 後で Firestore 版に差し替えれば同期・共有に切り替えられる。
// （Firestore に合わせて、関数はすべて Promise を返す）

const STORAGE_KEY = 'ouchi-share:v1';
const listeners = new Set();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function seed() {
  const now = Date.now();
  const g = uid();
  const travel = uid();
  const daily = uid();
  const item = (text, checked = false, i = 0) => ({ id: uid(), text, checked, createdAt: now + i });
  return {
    groups: {
      [g]: {
        id: g,
        name: 'わが家',
        createdAt: now,
        lists: {
          [travel]: {
            id: travel,
            type: 'checklist',
            title: '旅行の持ち物',
            emoji: '🧳',
            createdAt: now,
            items: Object.fromEntries(
              ['財布', 'スマホの充電器', '着替え', '歯ブラシ', '常備薬', 'パスポート']
                .map((t, i) => item(t, i < 2, i))
                .map((it) => [it.id, it]),
            ),
          },
          [daily]: {
            id: daily,
            type: 'checklist',
            title: '日用品の在庫',
            emoji: '🧻',
            createdAt: now + 1,
            items: Object.fromEntries(
              ['トイレットペーパー', 'ティッシュ', '洗濯洗剤', '食器用洗剤']
                .map((t, i) => item(t, false, i))
                .map((it) => [it.id, it]),
            ),
          },
        },
      },
    },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // 壊れたデータや読み込めない環境では初期データから始める
  }
  const data = seed();
  save(data);
  return data;
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // プライベートブラウズなどで保存できない場合はメモリ上だけで動かす
  }
}

let db = load();

function commit() {
  save(db);
  listeners.forEach((fn) => fn());
}

function byCreatedAt(a, b) {
  return a.createdAt - b.createdAt;
}

function getGroupOrThrow(groupId) {
  const g = db.groups[groupId];
  if (!g) throw new Error('グループが見つかりません');
  return g;
}

function getListOrThrow(groupId, listId) {
  const l = getGroupOrThrow(groupId).lists[listId];
  if (!l) throw new Error('リストが見つかりません');
  return l;
}

// 別のタブで変更されたときも画面を更新する（Firestore の onSnapshot 相当）
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  db = load();
  listeners.forEach((fn) => fn());
});

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- グループ ----

export async function listGroups() {
  return Object.values(db.groups)
    .map(({ lists, ...g }) => ({ ...g, listCount: Object.keys(lists).length }))
    .sort(byCreatedAt);
}

export async function getGroup(groupId) {
  const { lists, ...g } = getGroupOrThrow(groupId);
  return g;
}

export async function createGroup(name) {
  const id = uid();
  db.groups[id] = { id, name, createdAt: Date.now(), lists: {} };
  commit();
  return id;
}

export async function renameGroup(groupId, name) {
  getGroupOrThrow(groupId).name = name;
  commit();
}

export async function deleteGroup(groupId) {
  delete db.groups[groupId];
  commit();
}

// ---- リスト ----

export async function listLists(groupId) {
  return Object.values(getGroupOrThrow(groupId).lists)
    .map(({ items, ...l }) => {
      const all = Object.values(items);
      return { ...l, total: all.length, done: all.filter((i) => i.checked).length };
    })
    .sort(byCreatedAt);
}

export async function getList(groupId, listId) {
  const { items, ...l } = getListOrThrow(groupId, listId);
  return l;
}

export async function createList(groupId, { title, emoji = '📝', type = 'checklist' }) {
  const id = uid();
  getGroupOrThrow(groupId).lists[id] = { id, type, title, emoji, createdAt: Date.now(), items: {} };
  commit();
  return id;
}

export async function updateList(groupId, listId, patch) {
  Object.assign(getListOrThrow(groupId, listId), patch);
  commit();
}

export async function deleteList(groupId, listId) {
  delete getGroupOrThrow(groupId).lists[listId];
  commit();
}

// ---- アイテム ----

export async function listItems(groupId, listId) {
  return Object.values(getListOrThrow(groupId, listId).items).sort(byCreatedAt);
}

export async function addItem(groupId, listId, text) {
  const id = uid();
  getListOrThrow(groupId, listId).items[id] = { id, text, checked: false, createdAt: Date.now() };
  commit();
  return id;
}

export async function updateItem(groupId, listId, itemId, patch) {
  const item = getListOrThrow(groupId, listId).items[itemId];
  if (!item) return;
  Object.assign(item, patch);
  commit();
}

export async function deleteItem(groupId, listId, itemId) {
  delete getListOrThrow(groupId, listId).items[itemId];
  commit();
}

export async function uncheckAll(groupId, listId) {
  Object.values(getListOrThrow(groupId, listId).items).forEach((i) => (i.checked = false));
  commit();
}

export async function deleteChecked(groupId, listId) {
  const list = getListOrThrow(groupId, listId);
  for (const [id, i] of Object.entries(list.items)) if (i.checked) delete list.items[id];
  commit();
}
