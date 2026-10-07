// データの読み書きをまとめた層（Firestore 版）。
//
// データ構造（詳しくは docs/design.md）
//   admins/{uid}                      グループを作れる人の許可リスト（コンソールから手で追加）
//   groups/{groupId}                  グループ。memberIds / members でメンバーを管理
//   groups/{groupId}/lists/{listId}   リスト。アイテムは items マップとして 1 ドキュメントに入れる
//                                     eventId があればそのイベントのリスト、なければ「日常」のリスト
//   groups/{groupId}/events/{eventId} イベント（旅行など、期間のある予定）。participants: 参加者の uid（空なら全員）
//   groups/{groupId}/plans/{planId}   普段の予定（歯医者など）。カレンダーに表示する
//   recovery/{code}                   ゲストの復旧ID（下の「ゲストの復旧ID」を参照）
//   announcements/{id}                アプリからのお知らせ（管理者が書く）
//   groups/{groupId}/announcements/{id} グループのお知らせ（メンバーが書く）
//   reads/{uid}                       お知らせの既読 { seen: { "app:ID" | "g:GID:ID": 既読にした時刻 } }（本人だけ）
//   presence/{uid}                    最終アクセス時刻（オンライン表示用。読めるのは本人と管理者だけ）
//
// watch〜 は変更があるたびに cb を呼ぶ（他のメンバーの編集もリアルタイムに届く）。
// 戻り値の関数を呼ぶと監視をやめる。

import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
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
const eventsCol = (groupId) => collection(db, 'groups', groupId, 'events');
const eventRef = (groupId, eventId) => doc(db, 'groups', groupId, 'events', eventId);
const plansCol = (groupId) => collection(db, 'groups', groupId, 'plans');
const planRef = (groupId, planId) => doc(db, 'groups', groupId, 'plans', planId);

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

// 並べ替えた順（order）。並べ替えていないもの（order なし）は作った順で、並べ替えたものより後ろ
function byOrder(a, b) {
  return (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0);
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
    .sort(byOrder);
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

export async function listMyGroups() {
  const snap = await getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', uid())));
  return snap.docs.map(withId).sort(byCreatedAt);
}

export async function fetchGroup(groupId) {
  return withId(await getDoc(groupRef(groupId)));
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
  const [lists, events, plans, news, bonus] = await Promise.all([
    getDocs(listsCol(groupId)),
    getDocs(eventsCol(groupId)),
    getDocs(plansCol(groupId)),
    getDocs(groupNewsCol(groupId)),
    getDocs(collection(db, 'groups', groupId, 'bonus')),
  ]);
  const batch = writeBatch(db);
  for (const snap of [lists, events, plans, news, bonus]) snap.forEach((d) => batch.delete(d.ref));
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
  await ensureRecoveryCode(groupId).catch(() => {});
  return true;
}

// メンバーを外す（オーナーがほかの人を、またはオーナー以外が自分を）。その人のこのグループ用の復旧ID も消す
export async function removeMember(groupId, memberUid) {
  await updateDoc(groupRef(groupId), { memberIds: arrayRemove(memberUid), [`members.${memberUid}`]: deleteField() });
  const codes = await getDocs(query(collection(db, 'recovery'), where('groupId', '==', groupId), where('uid', '==', memberUid))).catch(() => null);
  await Promise.all((codes?.docs ?? []).map((d) => deleteDoc(d.ref).catch(() => {})));
}

// このグループでの自分の名前を変える
export async function renameMeInGroup(groupId, name) {
  await updateDoc(groupRef(groupId), { [`members.${uid()}.name`]: name });
}

// ---- ゲストの復旧ID ----
// ゲスト（匿名アカウント）は別の端末から同じアカウントに戻れないので、
// 復旧ID を使って「新しいゲストが元のゲストのグループでの席を引き継ぐ」形で復旧する。
//   recovery/{code}   { groupId, uid, name, createdAt }
//   - code を知っていれば誰でも get できる（code 自体が合言葉。一覧は本人とグループのオーナーだけ）
//   - 引き継ぐと元のゲストはグループから外れる（なくした端末からは見られなくなる）

const RECOVERY_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 読み間違えやすい 0/O/1/I は使わない

function newRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => RECOVERY_CHARS[b % 32]).join('');
}

export function formatRecoveryCode(code) {
  return code.match(/.{1,4}/g).join('-');
}

export function normalizeRecoveryCode(input) {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function recoveryUrl(code) {
  return `${location.origin}${location.pathname}#/recover/${code}`;
}

// ゲストが参加中のグループに復旧ID がなければ作る
export async function ensureRecoveryCode(groupId) {
  if (!isGuest()) return;
  const me = uid();
  const mine = await getDocs(query(collection(db, 'recovery'), where('uid', '==', me), where('groupId', '==', groupId)));
  if (!mine.empty) return;
  await setDoc(doc(db, 'recovery', newRecoveryCode()), { groupId, uid: me, name: displayName(), createdAt: Date.now() });
}

// オーナー用：グループのゲストの復旧ID を発行する
export async function issueRecoveryCode(groupId, memberUid, name) {
  const code = newRecoveryCode();
  await setDoc(doc(db, 'recovery', code), { groupId, uid: memberUid, name, createdAt: Date.now() });
  return code;
}

// 自分の復旧ID（グループごと）
export async function myRecoveryCodes() {
  const snap = await getDocs(query(collection(db, 'recovery'), where('uid', '==', uid())));
  return snap.docs.map((d) => ({ code: d.id, ...d.data() }));
}

// オーナー用：グループのゲストの復旧ID（uid → code）
export function watchRecoveryCodes(groupId, cb, onError) {
  return onSnapshot(
    query(collection(db, 'recovery'), where('groupId', '==', groupId)),
    (snap) => cb(Object.fromEntries(snap.docs.map((d) => [d.data().uid, d.id]))),
    onError,
  );
}

// 復旧ID の中身（グループと名前）を調べる。無効なら null
export async function lookupRecoveryCode(code) {
  const snap = await getDoc(doc(db, 'recovery', code)).catch(() => null);
  return snap?.exists() ? { code, ...snap.data() } : null;
}

// 復旧ID を使って、元のゲストのグループでの席を今のアカウントに引き継ぐ
export async function recoverWithCode(code) {
  const me = uid();
  const rec = await lookupRecoveryCode(code);
  if (!rec) throw new Error('invalid-recovery-code');
  if (rec.uid !== me) {
    // 1) 自分をメンバーに加え、元のゲストのメンバー情報を消す
    //    （配列への追加と削除は 1 回の更新でできないので 2 段階に分ける）
    await updateDoc(groupRef(rec.groupId), {
      memberIds: arrayUnion(me),
      [`members.${me}`]: { name: rec.name || displayName(), role: 'member', guest: isGuest(), joinedAt: Date.now(), recoveryCode: code },
      [`members.${rec.uid}`]: deleteField(),
    });
    // 2) メンバーになったので、元のゲストを memberIds から外す（これで元の端末からは読めなくなる）
    await removeStaleMemberIds(rec.groupId, [rec.uid]);
  }
  // 使った復旧ID は消して、新しいアカウント用を作り直す
  await deleteDoc(doc(db, 'recovery', code)).catch(() => {});
  await ensureRecoveryCode(rec.groupId).catch(() => {});
  return rec.groupId;
}

// メンバー情報がもう無い uid を memberIds から外す（復旧の 2 段階目。途中で失敗したときの後片付けにも使う）
export async function removeStaleMemberIds(groupId, uids) {
  if (uids.length) await updateDoc(groupRef(groupId), { memberIds: arrayRemove(...uids) });
}

// Google アカウントに引き継いだら、ゲスト用の復旧ID は不要なので消す
export async function deleteMyRecoveryCodes() {
  const snap = await getDocs(query(collection(db, 'recovery'), where('uid', '==', uid())));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

// 参加中の全グループの自分の情報を更新する
// （Google アカウントへ引き継いだとき = ゲスト表示、名前を全グループに反映したいとき = 名前も）
export async function syncMyProfile({ name = false } = {}) {
  const me = uid();
  const snap = await getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', me)));
  await Promise.all(
    snap.docs.map((d) =>
      updateDoc(d.ref, {
        [`members.${me}.guest`]: isGuest(),
        ...(name ? { [`members.${me}.name`]: displayName() } : {}),
      }),
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

// ---- イベント（旅行など期間のある予定） ----
// 日付は "YYYY-MM-DD" の文字列で持つ（タイムゾーンに左右されない）

function withEventFields(snap) {
  return withId(snap);
}

export function watchEvents(groupId, cb, onError) {
  return onSnapshot(eventsCol(groupId), (snap) => cb(snap.docs.map(withEventFields)), onError);
}

export function watchEvent(groupId, eventId, cb, onError) {
  return onSnapshot(
    eventRef(groupId, eventId),
    (snap) => (snap.exists() ? cb(withEventFields(snap)) : onError?.(new Error('not-found'))),
    onError,
  );
}

export async function fetchEvents(groupId) {
  const snap = await getDocs(eventsCol(groupId));
  return snap.docs.map(withEventFields);
}

export async function createEvent(groupId, { title, emoji, startDate, endDate, participants = [] }) {
  const id = newId();
  await setDoc(eventRef(groupId, id), { title, emoji, startDate, endDate, participants, createdAt: Date.now(), createdBy: uid() });
  return id;
}

export async function updateEvent(groupId, eventId, patch) {
  await updateDoc(eventRef(groupId, eventId), patch);
}

// イベントと、その中のリストをまとめて消す
export async function deleteEvent(groupId, eventId) {
  const lists = await getDocs(query(listsCol(groupId), where('eventId', '==', eventId)));
  const batch = writeBatch(db);
  lists.forEach((l) => batch.delete(l.ref));
  batch.delete(eventRef(groupId, eventId));
  await batch.commit();
}

// ---- お知らせ ----
// お知らせ 1 件 = { title, body, createdAt, createdBy, createdByName,
//   announcedAt, announcedBy, announcedByName（再アナウンスしたとき。これより前に読んだ人は未読に戻る） }

const appNewsCol = () => collection(db, 'announcements');
const groupNewsCol = (groupId) => collection(db, 'groups', groupId, 'announcements');

function newsFields({ title, body }) {
  return { title, body, createdAt: Date.now(), createdBy: uid(), createdByName: displayName() };
}

export function watchAppNews(cb, onError) {
  return onSnapshot(appNewsCol(), (snap) => cb(snap.docs.map(withId)), onError);
}

export async function createAppNews(news) {
  const ref = doc(appNewsCol());
  await setDoc(ref, newsFields(news));
  return ref.id;
}

export async function deleteAppNews(id) {
  await deleteDoc(doc(db, 'announcements', id));
}

export function watchGroupNews(groupId, cb, onError) {
  return onSnapshot(groupNewsCol(groupId), (snap) => cb(snap.docs.map(withId)), onError);
}

export async function createGroupNews(groupId, news) {
  const ref = doc(groupNewsCol(groupId));
  await setDoc(ref, newsFields(news));
  return ref.id;
}

// 再アナウンス：みんなの未読に戻す（通知は app.js から頼む）
export async function reannounceNews(groupId, id) {
  const ref = groupId ? doc(db, 'groups', groupId, 'announcements', id) : doc(db, 'announcements', id);
  await updateDoc(ref, { announcedAt: Date.now(), announcedBy: uid(), announcedByName: displayName() });
}

export async function deleteGroupNews(groupId, id) {
  await deleteDoc(doc(db, 'groups', groupId, 'announcements', id));
}

// 既読：自分の reads ドキュメントの seen マップに足していく（merge なので他の既読は消えない）
export function watchReads(cb, onError) {
  return onSnapshot(
    doc(db, 'reads', uid()),
    (snap) => cb(snap.exists() ? snap.data().seen ?? {} : {}),
    onError,
  );
}

export async function markRead(key) {
  await setDoc(doc(db, 'reads', uid()), { seen: { [key]: Date.now() } }, { merge: true });
}

// ---- 普段の予定（歯医者など。カレンダーに出す） ----
// { title, date: "YYYY-MM-DD", start: "HH:MM" | null（終日）, duration: 分, place, memo, participants: [uid]（空なら全員） }

export function watchPlans(groupId, cb, onError) {
  return onSnapshot(plansCol(groupId), (snap) => cb(snap.docs.map(withId)), onError);
}

export async function createPlan(groupId, plan) {
  const id = newId();
  await setDoc(planRef(groupId, id), { ...plan, createdAt: Date.now(), createdBy: uid() });
  return id;
}

export async function updatePlan(groupId, planId, patch) {
  await updateDoc(planRef(groupId, planId), patch);
}

export async function deletePlan(groupId, planId) {
  await deleteDoc(planRef(groupId, planId));
}

// ---- 旅程（イベントのスケジュール） ----
// イベントごとに 1 つ、type: 'schedule' のリストを ID「sch-{eventId}」で持つ（最初の予定を追加したときに作る）。
// items の 1 件 = { title, place, memo, date, start, duration, createdAt }
//   date: "YYYY-MM-DD"（null なら「行きたい候補」）、start: "HH:MM"（候補は null）、duration: 分

export function scheduleId(eventId) {
  return `sch-${eventId}`;
}

async function ensureSchedule(groupId, eventId) {
  const ref = listRef(groupId, scheduleId(eventId));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, { type: 'schedule', title: '旅程', emoji: '🗓', eventId, createdAt: Date.now(), createdBy: uid(), items: {} });
    }
  });
  return ref;
}

export async function addScheduleItem(groupId, eventId, item) {
  const ref = await ensureSchedule(groupId, eventId);
  await updateDoc(ref, { [`items.${newId()}`]: { ...item, createdAt: Date.now() } });
}

// 1 件の一部の項目だけを書き換える（ほかの人が同時に別の予定を編集しても上書きし合わない）
export async function updateScheduleItem(groupId, eventId, itemId, patch) {
  const fields = {};
  for (const [k, v] of Object.entries(patch)) fields[`items.${itemId}.${k}`] = v;
  await updateDoc(listRef(groupId, scheduleId(eventId)), fields);
}

// 並べ替えで詰め直した開始時刻をまとめて書き込む  { itemId: "HH:MM" }
export async function setScheduleStarts(groupId, eventId, starts) {
  const fields = {};
  for (const [id, start] of Object.entries(starts)) fields[`items.${id}.start`] = start;
  if (Object.keys(fields).length) await updateDoc(listRef(groupId, scheduleId(eventId)), fields);
}

// ドラッグ＆ドロップの結果をまとめて書き込む  { itemId: { date, start, ... } }
export async function patchScheduleItems(groupId, eventId, changes) {
  const fields = {};
  for (const [id, patch] of Object.entries(changes)) {
    for (const [k, v] of Object.entries(patch)) fields[`items.${id}.${k}`] = v;
  }
  if (Object.keys(fields).length) await updateDoc(listRef(groupId, scheduleId(eventId)), fields);
}

export async function deleteScheduleItem(groupId, eventId, itemId) {
  await updateDoc(listRef(groupId, scheduleId(eventId)), { [`items.${itemId}`]: deleteField() });
}

// ---- リスト ----

export function watchLists(groupId, cb, onError) {
  const q = query(listsCol(groupId), orderBy('createdAt'));
  return onSnapshot(q, (snap) => cb(snap.docs.map(toList).sort(byOrder)), onError);
}

export function watchList(groupId, listId, cb, onError) {
  return onSnapshot(
    listRef(groupId, listId),
    (snap) => (snap.exists() ? cb(toList(snap)) : onError?.(new Error('not-found'))),
    onError,
  );
}

// 1 回だけ読む（取り込み元を選ぶときなど）
export async function fetchLists(groupId) {
  const snap = await getDocs(query(listsCol(groupId), orderBy('createdAt')));
  return snap.docs.map(toList);
}

export async function createList(groupId, { title, emoji = '📝', type = 'checklist', variant = null, eventId = null, items = {} }) {
  const id = newId();
  await setDoc(listRef(groupId, id), { type, title, emoji, eventId, createdAt: Date.now(), createdBy: uid(), items, ...(variant ? { variant } : {}) });
  return id;
}

// アイテムのテキストから、チェックの外れた新しい items マップを作る
function freshItems(texts) {
  const now = Date.now();
  return Object.fromEntries(texts.map((text, i) => [newId(), { text, checked: false, createdAt: now + i }]));
}

// 取り込み A：ほかのリストを丸ごと新しいリストとしてコピーする（チェックは外す）
export async function copyListAsNew(groupId, source, { eventId = null, title = source.title, emoji = source.emoji } = {}) {
  return createList(groupId, { title, emoji, eventId, items: freshItems(source.items.map((i) => i.text)) });
}

// 取り込み B：今のリストに、選んだアイテムを追加する
export async function addItems(groupId, listId, texts) {
  if (!texts.length) return;
  const patch = {};
  for (const [id, item] of Object.entries(freshItems(texts))) patch[`items.${id}`] = item;
  await updateDoc(listRef(groupId, listId), patch);
}

// 並べ替え：ids の順に order を 0, 1, 2… と付け直す
export async function reorderLists(groupId, ids) {
  const batch = writeBatch(db);
  ids.forEach((id, i) => batch.update(listRef(groupId, id), { order: i }));
  await batch.commit();
}

export async function reorderItems(groupId, listId, ids) {
  const patch = {};
  ids.forEach((id, i) => (patch[`items.${id}.order`] = i));
  await updateDoc(listRef(groupId, listId), patch);
}

export async function updateList(groupId, listId, patch) {
  await updateDoc(listRef(groupId, listId), patch);
}

export async function deleteList(groupId, listId) {
  await deleteDoc(listRef(groupId, listId));
}

// ---- 欲しいものリスト（type: 'wish'） ----
// リストの variant：'buy'（欲しいもの。なし も同じ）| 'place'（行きたいところ・食べに行きたい）| 'food'（食べたいもの）
// items の 1 件 = { text: 名前・メモ, url, photoId, place: 場所（place）, how: 'cook' | 'buy' | 'eatout'（food）,
//   status: 'open' | 'bought' | 'visited' | 'ate' | 'gaveup', result: 結果・感想, rating: 0〜5, closedAt, createdAt, createdBy }

export async function addWish(groupId, listId, wish) {
  const id = newId();
  await updateDoc(listRef(groupId, listId), { [`items.${id}`]: { ...wish, status: 'open', result: '', createdAt: Date.now(), createdBy: uid() } });
  return id;
}

// 欲しいもの系のアイテムを別のリストへ移す（写真はそのまま使う）
export async function moveWish(groupId, fromListId, toListId, item) {
  const { id, ...data } = item;
  const batch = writeBatch(db);
  batch.update(listRef(groupId, toListId), { [`items.${newId()}`]: data });
  batch.update(listRef(groupId, fromListId), { [`items.${id}`]: deleteField() });
  await batch.commit();
}

// リストのアイテム 1 件の一部の項目を書き換える（欲しいもの・貸し借りで共通）
export async function patchListItem(groupId, listId, itemId, patch) {
  const fields = {};
  for (const [k, v] of Object.entries(patch)) fields[`items.${itemId}.${k}`] = v;
  await updateDoc(listRef(groupId, listId), fields);
}

// ---- 写真 ----
// Firebase Storage は無料プランで使えないため、縮小した JPEG を data URL の文字列で Firestore に 1 枚 1 ドキュメント保存する

const photoRef = (groupId, photoId) => doc(db, 'groups', groupId, 'photos', photoId);
const photoCache = new Map();

export async function savePhoto(groupId, dataUrl) {
  const ref = doc(collection(db, 'groups', groupId, 'photos'));
  await setDoc(ref, { data: dataUrl, createdAt: Date.now(), createdBy: uid() });
  photoCache.set(`${groupId}/${ref.id}`, dataUrl);
  return ref.id;
}

export async function getPhoto(groupId, photoId) {
  const key = `${groupId}/${photoId}`;
  if (!photoCache.has(key)) {
    photoCache.set(
      key,
      getDoc(photoRef(groupId, photoId))
        .then((s) => (s.exists() ? s.data().data : null))
        .catch(() => null),
    );
  }
  return photoCache.get(key);
}

export async function deletePhoto(groupId, photoId) {
  photoCache.delete(`${groupId}/${photoId}`);
  await deleteDoc(photoRef(groupId, photoId)).catch(() => {});
}

// ---- 貸し借りリスト（type: 'money'） ----
// items の 1 件 = { from: 貸した人の uid, to: 借りた人の uid, kind: 'money' | 'item', amount: 円, item: もの,
//                   memo, date: "YYYY-MM-DD", settled: 精算済みか, createdAt, createdBy }

export async function addMoneyEntry(groupId, listId, entry) {
  await updateDoc(listRef(groupId, listId), { [`items.${newId()}`]: { ...entry, settled: false, createdAt: Date.now(), createdBy: uid() } });
}

export async function updateMoneyEntry(groupId, listId, itemId, patch) {
  const fields = {};
  for (const [k, v] of Object.entries(patch)) fields[`items.${itemId}.${k}`] = v;
  await updateDoc(listRef(groupId, listId), fields);
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

// ---- ログインボーナス（グループごと） ----
// groups/{id}/bonus/{uid} = { lastDate: "YYYY-MM-DD", streak: 連続日数, total: 合計日数, stamps: { 絵文字: もらった回数 }, lastStamp,
//   month: "YYYY-MM", monthDays: その月に受け取った回数, tickets: { bronze, silver, gold }（持っている枚数）, updatedAt }
// グループのメンバーなら、みんなの記録を読める（メンバー一覧の 🔥）

const bonusRef = (groupId, userId) => doc(db, 'groups', groupId, 'bonus', userId);

// 今日のぶんをもらう。今日もらい済みなら null。pick({ streak, total, stamps }) が今日もらうスタンプの配列を返す。
// schedule（配布表）{ "N": { bronze, silver, gold } } の、その月の受け取り回数ぶんのチケットも足す
// （2 台の端末で同時に開いても二重にもらわないよう、トランザクションで確かめてから書く）
export async function claimDailyBonus(groupId, today, yesterday, pick, schedule = {}) {
  const ref = bonusRef(groupId, uid());
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? snap.data() : {};
    if (cur.lastDate === today) return null;
    const streak = cur.lastDate === yesterday ? (cur.streak ?? 0) + 1 : 1;
    const total = (cur.total ?? 0) + 1;
    const before = cur.stamps ?? {};
    const got = pick({ streak, total, stamps: before });
    const stamps = { ...before };
    for (const s of got) stamps[s] = (stamps[s] ?? 0) + 1;
    const month = today.slice(0, 7);
    const monthDays = cur.month === month ? (cur.monthDays ?? 0) + 1 : 1;
    const reward = schedule[monthDays] ?? {};
    const tickets = { ...(cur.tickets ?? {}) };
    for (const [t, n] of Object.entries(reward)) if (n > 0) tickets[t] = (tickets[t] ?? 0) + n;
    tx.set(ref, { lastDate: today, streak, total, stamps, lastStamp: got[0], month, monthDays, tickets, updatedAt: Date.now() });
    return { streak, total, got, stamps, before, monthDays, reward, tickets };
  });
}

export function watchBonus(groupId, cb, onError) {
  return onSnapshot(bonusRef(groupId, uid()), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

// ---- チケットの配布表（アプリ共通。管理者だけ書ける） ----
// config/bonus = { days: { "1": { bronze: 1 }, "7": { silver: 1 }, ... }, updatedAt }

export async function getBonusSchedule() {
  const snap = await getDoc(doc(db, 'config', 'bonus'));
  return snap.exists() ? snap.data().days ?? null : null;
}

export async function setBonusSchedule(days) {
  await setDoc(doc(db, 'config', 'bonus'), { days, updatedAt: Date.now() });
}

// ---- ごほうび（グループごと。オーナーが登録し、メンバーがチケットで交換する） ----
// groups/{id}/rewards/{rid} = { title, emoji, ticket: 'bronze' | 'silver' | 'gold', count, createdAt }
// groups/{id}/redemptions/{xid} = { uid, name, title, emoji, ticket, count, at, done }（交換の記録）

const rewardsCol = (groupId) => collection(db, 'groups', groupId, 'rewards');
const redemptionsCol = (groupId) => collection(db, 'groups', groupId, 'redemptions');

export function watchRewards(groupId, cb, onError) {
  return onSnapshot(rewardsCol(groupId), (snap) => cb(snap.docs.map(withId)), onError);
}

export async function saveReward(groupId, rewardId, { title, emoji, ticket, count }) {
  const ref = rewardId ? doc(rewardsCol(groupId), rewardId) : doc(rewardsCol(groupId));
  await setDoc(ref, { title, emoji, ticket, count, createdAt: Date.now() }, { merge: true });
}

export async function deleteReward(groupId, rewardId) {
  await deleteDoc(doc(rewardsCol(groupId), rewardId));
}

export function watchRedemptions(groupId, cb, onError) {
  return onSnapshot(query(redemptionsCol(groupId), orderBy('at', 'desc'), limit(30)), (snap) => cb(snap.docs.map(withId)), onError);
}

// チケットでごほうびと交換する（足りなければ Error('not-enough')）。チケットを減らして、交換の記録を残す
export async function redeemReward(groupId, reward, name) {
  const ref = bonusRef(groupId, uid());
  const log = doc(redemptionsCol(groupId));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const tickets = { ...(snap.exists() ? snap.data().tickets ?? {} : {}) };
    if ((tickets[reward.ticket] ?? 0) < reward.count) throw new Error('not-enough');
    tickets[reward.ticket] -= reward.count;
    tx.update(ref, { tickets, updatedAt: Date.now() });
    tx.set(log, { uid: uid(), name, title: reward.title, emoji: reward.emoji, ticket: reward.ticket, count: reward.count, at: Date.now(), done: false });
  });
}

export async function setRedemptionDone(groupId, id, done) {
  await updateDoc(doc(redemptionsCol(groupId), id), { done });
}

export async function getBonus(groupId, userId = uid()) {
  const snap = await getDoc(bonusRef(groupId, userId));
  return snap.exists() ? snap.data() : null;
}

// グループのみんなの記録 → { uid: 記録 }
export async function getGroupBonus(groupId) {
  const snap = await getDocs(collection(db, 'groups', groupId, 'bonus'));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
}
