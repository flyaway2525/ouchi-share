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

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'ja';

// 端末にもキャッシュしておき、オフラインでも表示・編集できるようにする
// （つながったときに自動で同期される）
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
