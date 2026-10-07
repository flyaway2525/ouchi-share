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
  signInWithCredential,
  OAuthProvider,
  signOut as fbSignOut,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { auth, isNativeApp } from './firebase.js';

export { isNativeApp };

// アプリの中のログイン画面（ネイティブのプラグイン）。アプリの中でだけ使う
const nativeAuth = () => window.Capacitor.registerPlugin('FirebaseAuthentication');

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

// ゲストのまま使っていたデータ（参加中のグループ）を Google アカウントに引き継ぐ
// 名前はゲストのときに入力したものをそのまま使う
export async function upgradeGuestToGoogle() {
  const { user } = isNativeApp ? await linkWithCredential(auth.currentUser, await nativeCredential('google.com')) : await linkWithPopup(auth.currentUser, provider);
  // ログイン方法が変わったことをセキュリティルール側にも反映させる
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
      return 'この Google アカウントはすでに別のデータで使われています。';
    case 'auth/unauthorized-domain':
      return 'このドメインはログインが許可されていません（Firebase の承認済みドメインを確認してください）。';
    case 'auth/admin-restricted-operation':
    case 'auth/operation-not-allowed':
      return 'このログイン方法は有効になっていません（Firebase の Authentication 設定を確認してください）。';
    case 'auth/network-request-failed':
      return 'ネットワークにつながりません。';
    default:
      return `ログインに失敗しました（${e?.code || e?.message || '不明なエラー'}）`;
  }
}
