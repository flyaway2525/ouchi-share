// Firebase の初期化。
// この設定値はブラウザに配る公開用のもの（秘密ではない）。
// データの保護は firestore.rules のセキュリティルールで行う。

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDccFVgKkvI19h6yoiPYWMRJrHMRs83W5Y',
  authDomain: 'ouchi-share.firebaseapp.com',
  projectId: 'ouchi-share',
  storageBucket: 'ouchi-share.firebasestorage.app',
  messagingSenderId: '510809098274',
  appId: '1:510809098274:web:9122327a17b63d6179227b',
};

// ---- 通知 ----
// VAPID_KEY：Firebase コンソール → プロジェクトの設定 → Cloud Messaging → ウェブプッシュ証明書 の「鍵ペア」（公開してよい値）
// NOTIFY_URL：通知を送る Cloudflare Workers の URL（worker/ を公開すると決まる）
// どちらかが空のあいだは、通知の設定画面に「準備中」と出て、通知は送らない
export const VAPID_KEY = '';
export const NOTIFY_URL = '';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'ja';

// 端末にもキャッシュしておき、オフラインでも表示・編集できるようにする
// （つながったときに自動で同期される）
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
