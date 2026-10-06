# ouchi-share-notify（通知を送る Cloudflare Workers）

アプリから「このグループに通知して」と頼まれたら、そのグループのメンバーの端末へ Firebase Cloud Messaging（FCM）で通知を送る。
毎日 20 時（日本時間）に、翌日の予定・イベントのリマインドも送る。

- Cloudflare Workers の無料プラン（1 日 10 万リクエストまで）・Firebase の無料プラン（Spark）のままで動く
- 秘密の値（サービスアカウントキー）はリポジトリに入れず、`wrangler secret` で Cloudflare に登録する

## 初回の準備

1. Cloudflare の無料アカウントを作る：https://dash.cloudflare.com/sign-up
2. この `worker` フォルダで Cloudflare にログイン（ブラウザが開く）

   ```
   npx wrangler login
   ```

3. Firebase のサービスアカウントキーを用意する
   - Firebase コンソール → ⚙ プロジェクトの設定 → サービス アカウント →「新しい秘密鍵の生成」
   - ダウンロードした JSON ファイルは**誰にも渡さない・リポジトリに入れない**
4. キーを Cloudflare に登録する（`<ファイル>` はダウンロードした JSON のパス）

   ```
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < <ファイル>
   ```

   登録できたら、ダウンロードした JSON ファイルは削除してよい
5. 公開する

   ```
   npx wrangler deploy
   ```

   表示された URL（`https://ouchi-share-notify.<アカウント名>.workers.dev`）を、`js/firebase.js` の `NOTIFY_URL` に入れる
6. Web Push の鍵（公開してよい値）を作る
   - Firebase コンソール → ⚙ プロジェクトの設定 → Cloud Messaging → ウェブ構成 → ウェブプッシュ証明書 →「鍵ペアを生成」
   - 表示された鍵を `js/firebase.js` の `VAPID_KEY` に入れる

## 更新するとき

```
npx wrangler deploy
```
