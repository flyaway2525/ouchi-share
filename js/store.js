// データの読み書きをまとめた層（Firestore 版）。
//
// データ構造（詳しくは docs/design.md）
//   admins/{uid}                      グループを作れる人の許可リスト（コンソールから手で追加）
//   groups/{groupId}                  グループ。memberIds / members でメンバーを管理
//   groups/{groupId}/lists/{listId}   リスト。アイテムは items マップとして 1 ドキュメントに入れる
//   presence/{uid}                    最終アクセス時刻（オンライン表示用。読めるのは本人と管理者だけ）
//
// watch〜 は変更があるたびに cb を呼ぶ（他のメンバーの編集もリアルタイムに届く）。
// 戻り値の関数を呼ぶと監視をやめる。

import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { currentUser, displayName, isGuest } from './auth.js';

const groupRef = (groupId) => doc(db, 'groups', groupId);
const listsCol = (groupId) => collection(db, 'groups', groupId, 'lists');
const listRef = (groupId, listId) => doc(db, 'groups', groupId, 'lists', listId);

function newId() {
  return doc(collection(db, '_')).id;
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

function uid() {
  const user = currentUser();
  if (!user) throw new Error('ログインしていません');
  return user.uid;
}

function byCreatedAt(a, b) {
  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

// 書き込み直後でサーバー時刻が未確定のときは、手元の推定時刻を使う
function withId(snap) {
  return { id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) };
}

// この時間以内にアクセスがあればオンラインとみなす（記録は 1 分ごと）
export const ONLINE_MS = 150 * 1000;

export function millis(ts) {
  return ts?.toMillis?.() ?? 0;
}

export function isOnline(ts, now = Date.now()) {
  return now - millis(ts) < ONLINE_MS;
}

function toList(snap) {
  const data = withId(snap);
  const items = Object.entries(data.items ?? {})
    .map(([id, it]) => ({ id, ...it }))
    .sort(byCreatedAt);
  return { ...data, items, total: items.length, done: items.filter((i) => i.checked).length };
}

// ---- 許可リスト ----

export function watchIsAdmin(userId, cb) {
  return onSnapshot(
    doc(db, 'admins', userId),
    (snap) => cb(snap.exists()),
    () => cb(false),
  );
}

// ---- グループ ----

export function watchGroups(cb, onError) {
  const q = query(collection(db, 'groups'), where('memberIds', 'array-contains', uid()));
  return onSnapshot(q, (snap) => cb(snap.docs.map(withId).sort(byCreatedAt)), onError);
}

export function watchGroup(groupId, cb, onError) {
  return onSnapshot(
    groupRef(groupId),
    (snap) => (snap.exists() ? cb(withId(snap)) : onError?.(new Error('not-found'))),
    onError,
  );
}

export async function createGroup(name) {
  const me = uid();
  const id = newId();
  await setDoc(groupRef(id), {
    name,
    createdAt: Date.now(),
    createdBy: me,
    inviteCode: randomCode(),
    memberIds: [me],
    members: { [me]: { name: displayName(), role: 'owner', guest: false, joinedAt: Date.now() } },
  });
  return id;
}

export async function renameGroup(groupId, name) {
  await updateDoc(groupRef(groupId), { name });
}

// 招待リンクを作り直す（古いリンクでは参加できなくなる）
export async function regenerateInvite(groupId) {
  await updateDoc(groupRef(groupId), { inviteCode: randomCode() });
}

export function inviteUrl(group) {
  return `${location.origin}${location.pathname}#/join/${group.id}/${group.inviteCode}`;
}

export async function deleteGroup(groupId) {
  const lists = await getDocs(listsCol(groupId));
  const batch = writeBatch(db);
  lists.forEach((l) => batch.delete(l.ref));
  batch.delete(groupRef(groupId));
  await batch.commit();
}

// 招待リンクから参加する。すでにメンバーならそのまま true を返す
export async function joinGroup(groupId, inviteCode) {
  const me = uid();
  try {
    const snap = await getDoc(groupRef(groupId));
    if (snap.exists()) return true; // 読めた = すでにメンバー
  } catch {
    // メンバーでなければ読めないので、参加処理へ進む
  }
  await updateDoc(groupRef(groupId), {
    memberIds: arrayUnion(me),
    [`members.${me}`]: { name: displayName(), role: 'member', guest: isGuest(), joinedAt: Date.now(), inviteCode },
  });
  return true;
}

// Google アカウントへ引き継いだあと、各グループに登録している自分の名前・ゲスト表示を更新する
export async function syncMyProfile() {
  const me = uid();
  const snap = await getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', me)));
  await Promise.all(
    snap.docs.map((d) =>
      updateDoc(d.ref, { [`members.${me}.name`]: displayName(), [`members.${me}.guest`]: isGuest() }),
    ),
  );
}

// ---- オンライン表示 ----

// 「今アプリを開いている」ことを記録する。groupId を渡すとそのグループのメンバー情報にも記録する
export async function touchPresence(groupId) {
  const me = uid();
  const writes = [setDoc(doc(db, 'presence', me), { lastSeen: serverTimestamp(), name: displayName(), guest: isGuest() })];
  if (groupId) writes.push(updateDoc(groupRef(groupId), { [`members.${me}.lastSeen`]: serverTimestamp() }));
  await Promise.all(writes);
}

// 管理者用：全ユーザーの最終アクセス時刻
export function watchPresence(cb, onError) {
  return onSnapshot(collection(db, 'presence'), (snap) => cb(snap.docs.map(withId)), onError);
}

// ---- リスト ----

export function watchLists(groupId, cb, onError) {
  const q = query(listsCol(groupId), orderBy('createdAt'));
  return onSnapshot(q, (snap) => cb(snap.docs.map(toList)), onError);
}

export function watchList(groupId, listId, cb, onError) {
  return onSnapshot(
    listRef(groupId, listId),
    (snap) => (snap.exists() ? cb(toList(snap)) : onError?.(new Error('not-found'))),
    onError,
  );
}

export async function createList(groupId, { title, emoji = '📝', type = 'checklist' }) {
  const id = newId();
  await setDoc(listRef(groupId, id), { type, title, emoji, createdAt: Date.now(), createdBy: uid(), items: {} });
  return id;
}

export async function updateList(groupId, listId, patch) {
  await updateDoc(listRef(groupId, listId), patch);
}

export async function deleteList(groupId, listId) {
  await deleteDoc(listRef(groupId, listId));
}

// ---- アイテム ----
// アイテムごとにフィールド単位で更新するので、別の人が同時に別のアイテムを触っても上書きし合わない

export async function addItem(groupId, listId, text) {
  const id = newId();
  await updateDoc(listRef(groupId, listId), {
    [`items.${id}`]: { text, checked: false, createdAt: Date.now() },
  });
  return id;
}

export async function setItemChecked(groupId, listId, itemId, checked) {
  await updateDoc(listRef(groupId, listId), { [`items.${itemId}.checked`]: checked });
}

export async function deleteItem(groupId, listId, itemId) {
  await updateDoc(listRef(groupId, listId), { [`items.${itemId}`]: deleteField() });
}

export async function uncheckAll(groupId, list) {
  const patch = {};
  for (const i of list.items) if (i.checked) patch[`items.${i.id}.checked`] = false;
  if (Object.keys(patch).length) await updateDoc(listRef(groupId, list.id), patch);
}

export async function deleteChecked(groupId, list) {
  const patch = {};
  for (const i of list.items) if (i.checked) patch[`items.${i.id}`] = deleteField();
  if (Object.keys(patch).length) await updateDoc(listRef(groupId, list.id), patch);
}
