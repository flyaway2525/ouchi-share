// ログインまわり。
// - Google ログイン：グループを作れるのは Google ログインした人（許可リストに入っている人）だけ
// - ゲスト（匿名ログイン）：招待 URL から参加するときに使う。あとで Google アカウントに引き継げる
// - iPhone アプリ版（Capacitor）では、ポップアップのログインが使えないので、iPhone の仕組みのログイン画面
//   （@capacitor-firebase/authentication。skipNativeAuth で、ログインの結果だけを受け取る）から
//   Firebase の JavaScript SDK にログインする。アプリでは「Apple でサインイン」も使える（Apple のルール）

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  linkWithPopup,
  linkWithCredential,
  unlink,
  signInWithCredential,
  OAuthProvider,
  signOut as fbSignOut,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth, isNativeApp } from './firebase.js';

export { isNativeApp };

// アプリの中のログイン画面（ネイティブのプラグイン）。アプリの中でだけ使う
// ビルドなしで @capacitor/core を読み込んでいないので registerPlugin はない。アプリが最初から入れる
// window.Capacitor.nativePromise でプラグインを直接呼ぶ
const nativeAuth = () => {
  const call = (method) => (options = {}) => window.Capacitor.nativePromise('FirebaseAuthentication', method, options);
  return { signInWithGoogle: call('signInWithGoogle'), signInWithApple: call('signInWithApple'), signOut: call('signOut') };
};

// iPhone の仕組みで Google / Apple にログインして、Firebase 用の資格情報（credential）にする
async function nativeCredential(providerId) {
  if (providerId === 'apple.com') {
    const { credential } = await nativeAuth().signInWithApple();
    return new OAuthProvider('apple.com').credential({ idToken: credential.idToken, rawNonce: credential.nonce });
  }
  const { credential } = await nativeAuth().signInWithGoogle();
  return GoogleAuthProvider.credential(credential.idToken, credential.accessToken);
}

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export function watchUser(cb) {
  return onAuthStateChanged(auth, cb);
}

export function currentUser() {
  return auth.currentUser;
}

export function isGuest(user = auth.currentUser) {
  return !!user?.isAnonymous;
}

export function displayName(user = auth.currentUser) {
  return user?.displayName?.trim() || (user?.isAnonymous ? 'ゲスト' : 'ユーザー');
}

// 名前が未設定か（未設定なら最初に入力してもらう）
export function needsName(user = auth.currentUser) {
  return !!user && !user.displayName?.trim();
}

export async function setDisplayName(name) {
  await updateProfile(auth.currentUser, { displayName: name });
}

export async function signInWithGoogle() {
  if (isNativeApp) await signInWithCredential(auth, await nativeCredential('google.com'));
  else await signInWithPopup(auth, provider);
}

// Apple でサインイン（アプリの中だけ）
export async function signInWithApple() {
  await signInWithCredential(auth, await nativeCredential('apple.com'));
}

export async function signInAsGuest(name) {
  const { user } = await signInAnonymously(auth);
  if (name) await updateProfile(user, { displayName: name });
  return user;
}

// ---- ログイン方法の連携 ----
// 1 つのアカウントに Google・Apple をまとめられる（どれでログインしても同じデータ）。
// ゲストが連携すると、そのデータ（参加中のグループ・名前）のまま正式なアカウントになる（ゲストからの昇格）。
// Apple との連携は iPhone アプリの中だけ（Web で Apple を使うには、Apple 側のサービス設定が別に要るため）。
export const LINK_PROVIDERS = [
  { id: 'google.com', label: 'Google', icon: 'G' },
  { id: 'apple.com', label: 'Apple', icon: '', appOnly: true },
];

// 連携しているログイン方法 → [{ id: 'google.com', email }]
export function linkedProviders(user = auth.currentUser) {
  return (user?.providerData ?? []).map((p) => ({ id: p.providerId, email: p.email ?? '' }));
}

export async function linkAccount(providerId) {
  const me = auth.currentUser;
  let result;
  if (isNativeApp) result = await linkWithCredential(me, await nativeCredential(providerId));
  else if (providerId === 'google.com') result = await linkWithPopup(me, provider);
  else throw Object.assign(new Error('app-only'), { code: 'app-only' });
  // ログイン方法が変わったこと（ゲストでなくなったことなど）をセキュリティルール側にも反映させる
  await result.user.getIdToken(true);
  return result.user;
}

export async function unlinkAccount(providerId) {
  const user = await unlink(auth.currentUser, providerId);
  await user.getIdToken(true);
  return user;
}

export async function signOut() {
  await fbSignOut(auth);
  // アプリでは、次に別の Google アカウントを選べるように、iPhone 側のログインも終わらせる
  if (isNativeApp) await nativeAuth().signOut().catch(() => {});
}

// Firebase のエラーコードを日本語メッセージにする
export function authErrorMessage(e) {
  // アプリのログイン画面を閉じた（キャンセルした）だけなら何も出さない
  if (isNativeApp && /cancel/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`)) return null;
  switch (e?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null; // ユーザーが閉じただけなので何も出さない
    case 'auth/popup-blocked':
      return 'ポップアップがブロックされました。ブラウザの設定を確認してください。';
    case 'auth/credential-already-in-use':
    case 'auth/email-already-in-use':
    case 'auth/account-exists-with-different-credential':
      return 'このアカウントは、すでに別のデータ（別のログイン）で使われています。';
    case 'auth/provider-already-linked':
      return 'このログイン方法は、もう連携してあります。';
    case 'app-only':
      return 'Apple との連携は、iPhone アプリから行えます。';
    case 'auth/unauthorized-domain':
      return 'このドメインはログインが許可されていません（Firebase の承認済みドメインを確認してください）。';
    case 'auth/admin-restricted-operation':
    case 'auth/operation-not-allowed':
      return 'このログイン方法は有効になっていません（Firebase の Authentication 設定を確認してください）。';
    case 'auth/network-request-failed':
      return 'ネットワークにつながりません。';
    case 'auth/user-disabled':
      return 'このアカウントは、アプリの管理者によって停止されています。';
    default:
      return `ログインに失敗しました（${e?.code || e?.message || '不明なエラー'}）`;
  }
}
