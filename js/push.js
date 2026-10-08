// 通知まわり（受け取る側の準備と、送るのを頼む側）。
//
// 受け取る：Firebase Cloud Messaging（FCM、無料プランで使える）の Web Push。
//   端末ごとのトークンを push/{uid} に保存し、送る側（Cloudflare Workers）がそれを読んで送る。
//   iPhone はホーム画面に追加したアプリ（iOS 16.4 以降）でだけ受け取れる。
// 送るのを頼む：お知らせや予定を追加したら、Cloudflare Workers に「このグループに通知して」と頼む。
//   Workers が、頼んだ人がそのグループのメンバーか確かめてから、メンバーの端末に送る。
//
// push/{uid} = { tokens: { [id]: { token, ua, updatedAt } }, prefs: { news, plans, reminders } }

import { getMessaging, getToken, deleteToken, isSupported } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { app, db, auth, VAPID_KEY, NOTIFY_URL } from './firebase.js';

export const DEFAULT_PREFS = { news: true, plans: true, reminders: true };

const pushRef = () => doc(db, 'push', auth.currentUser.uid);

// 通知の準備ができているか（設定値・ブラウザの対応・ホーム画面に追加したか）
export async function pushStatus() {
  if (!VAPID_KEY || !NOTIFY_URL) return { state: 'not-ready' };
  const supported = 'Notification' in window && 'serviceWorker' in navigator && (await isSupported().catch(() => false));
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!supported) return { state: ios && !standalone ? 'ios-home-screen' : 'unsupported' };
  if (Notification.permission === 'denied') return { state: 'denied' };
  const token = localStorage.getItem('ouchi-share:pushTokenId');
  return { state: Notification.permission === 'granted' && token ? 'on' : 'off' };
}

async function tokenId(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

// 通知をオンにする（許可を求め、この端末のトークンを保存する）
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'denied' : 'dismissed');
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error('no-token');
  const id = await tokenId(token);
  await setDoc(pushRef(), { tokens: { [id]: { token, ua: navigator.userAgent.slice(0, 200), updatedAt: Date.now() } } }, { merge: true });
  try {
    localStorage.setItem('ouchi-share:pushTokenId', id);
  } catch {
    // 保存できなくても通知は届く
  }
}

// この端末の通知をオフにする
export async function disablePush() {
  let id = null;
  try {
    id = localStorage.getItem('ouchi-share:pushTokenId');
    localStorage.removeItem('ouchi-share:pushTokenId');
  } catch {
    // 何もしない
  }
  await deleteToken(getMessaging(app)).catch(() => {});
  if (id) await updateDoc(pushRef(), { [`tokens.${id}`]: deleteField() }).catch(() => {});
}

export async function getPushPrefs() {
  const snap = await getDoc(pushRef()).catch(() => null);
  return { ...DEFAULT_PREFS, ...(snap?.exists() ? snap.data().prefs : {}) };
}

export async function setPushPrefs(prefs) {
  await setDoc(pushRef(), { prefs }, { merge: true });
}

// 送るのを頼む。kind: 'news'（お知らせ）| 'plan'（予定・イベントの追加）| 'appnews'（アプリからのお知らせ。管理者のみ）
// 失敗しても画面の操作には影響させない（通知はおまけ）
export async function notify({ groupId = null, kind, title, body = '', url = '', participants = [] }) {
  if (!NOTIFY_URL || !auth.currentUser) return;
  try {
    const idToken = await auth.currentUser.getIdToken();
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ groupId, kind, title: title.slice(0, 100), body: body.slice(0, 300), url, participants }),
    });
  } catch (e) {
    console.warn('通知を頼めませんでした', e);
  }
}

// リンクのタイトルと画像を取ってくる（同じ Workers の /preview）。取れなければ null
// → { title, site, image: 'data:image/...' | null }
export async function linkPreview(groupId, url) {
  if (!NOTIFY_URL || !auth.currentUser) return null;
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(new URL('preview', NOTIFY_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ groupId, url }),
    });
    return res.ok ? await res.json() : null;
  } catch (e) {
    console.warn('リンクの情報を読めませんでした', e);
    return null;
  }
}

// アプリ開発者の管理（同じ Workers の /admin。元に戻せない削除）。失敗したら Error を投げる
// action: 'deleteGroup'（{ groupId }）| 'deleteUser'（{ uid }）
export async function adminAction(action, payload) {
  if (!NOTIFY_URL || !auth.currentUser) throw new Error('通知のサーバーにつながりません');
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(new URL('admin', NOTIFY_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`できませんでした（${data.error ?? res.status}）`);
  return data;
}
