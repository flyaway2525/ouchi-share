# 構成（使っているサービス・お金・データの流れ）

サービスを足す・やめる・プランを変える・設定値を変えたら、このファイルを直す（CLAUDE.md の決まり）。
アプリの中の作り（画面・データ構造）は [design.md](design.md)、端末ごとの違いは [CLAUDE.md](../CLAUDE.md) の「対応する環境」。

最終更新: 2026-10-08

## 全体の図

```mermaid
flowchart LR
  subgraph 端末
    B[ブラウザ版<br>PC・iPhone・Android]
    H[ホーム画面版<br>iPhone・Android]
    A[アプリ版<br>iPhone（TestFlight）]
  end
  GP[GitHub Pages<br>画面のファイル]
  FA[Firebase Authentication<br>ログイン]
  FS[(Firestore<br>データ)]
  CF[Cloudflare Workers<br>ouchi-share-notify]
  FCM[Firebase Cloud Messaging<br>通知の配達]
  EXT[TikTok・YouTube の oEmbed<br>ほかのサイトの OGP]
  CDN[jsDelivr・gstatic<br>ライブラリの配布]

  B & H -->|画面を読む| GP
  A -.->|画面はアプリに同梱。版の確認だけ version.json を読む| GP
  B & H & A -->|Firebase の SDK| CDN
  B & H & A -->|ログイン| FA
  B & H & A <-->|読み書き・リアルタイム同期| FS
  B & H & A -->|通知して・リンクの情報をちょうだい<br>（ログインのトークン付き）| CF
  CF -->|メンバー・通知の送り先を読む| FS
  CF -->|送る| FCM
  FCM -->|通知| H & A
  CF -->|タイトル・画像を取る| EXT
```

## サービスの一覧

| サービス | 何に使うか | プラン・費用 | 管理する場所 | リポジトリの中の設定 |
|---|---|---|---|---|
| **GitHub** | ソースコード、Web 版の公開（GitHub Pages） | 無料 | GitHub のユーザー `flyaway2525`、リポジトリ `ouchi-share` | リポジトリ直下のファイルがそのまま公開される（ビルドなし） |
| **Firebase**（Google） | ログイン（Authentication：Google・匿名（ゲスト）・Apple）、データ（Firestore、東京リージョン `asia-northeast1`）、通知の配達（Cloud Messaging） | Spark（無料）。超えても課金されず、その日は止まる | Firebase コンソールのプロジェクト `ouchi-share` | `js/firebase.js`（公開してよい設定値・VAPID キー）、`firestore.rules`、`firebase.json`、`.firebaserc`、`ios/App/App/GoogleService-Info.plist` |
| **Cloudflare Workers** | 通知を送る（`POST /`）、リンクのタイトルと画像を取る（`POST /preview`）、毎日 20 時（日本時間）の翌日の予定のリマインド | 無料（1 日 10 万リクエストまで） | Cloudflare のアカウント（workers.dev のサブドメイン `flyaway2525`）、Worker `ouchi-share-notify` | `worker/`（`wrangler.toml` に定期実行の時刻）。URL は `js/firebase.js` の `NOTIFY_URL` |
| **Apple** | iPhone アプリ版（Xcode でビルド → TestFlight で配る）、Apple でサインイン、アプリの通知（APNs。これから） | Apple Developer Program 年 99 ドル（**更新はまだ**） | Apple Developer・App Store Connect | `ios/`、`capacitor.config.json`（アプリ ID `io.github.flyaway2525.ouchishare`） |

### 外から読み込んでいるもの（アカウント不要・無料）

| 読み込み先 | 何を | どこから |
|---|---|---|
| `www.gstatic.com/firebasejs/12.19.0/` | Firebase の SDK | `js/firebase.js`・`js/store.js`・`js/auth.js`・`js/push.js` |
| `cdn.jsdelivr.net`（qrcode-generator 2.0.4） | QR コードを作るライブラリ（必要なときだけ） | `js/ui.js` の `qrCode` |
| TikTok・YouTube の oEmbed、各サイトのページ | リンクのタイトル・画像 | Cloudflare Workers の `/preview`（アプリから直接は読まない） |

## 秘密の値・公開してよい値

| 値 | 公開してよいか | 置き場所 |
|---|---|---|
| Firebase の設定値（apiKey など）・VAPID の公開鍵 | よい（ルールで守る前提の値） | `js/firebase.js` |
| Firebase のサービスアカウントキー | **だめ** | Cloudflare の秘密の値 `FIREBASE_SERVICE_ACCOUNT`（`npx wrangler secret put`）だけ。リポジトリ・会話には出さない。登録はユーザーが行う |
| 管理者の許可リスト | uid だけ（メールアドレスは載せない） | Firestore の `admins/{uid}`（コンソールから手で追加） |

## 公開・反映のしかた

| 何を | コマンド | どこで |
|---|---|---|
| Web 版 | `node scripts/bump-version.mjs "変更の内容"` → コミット → `git push`（数分で GitHub Pages に反映） | Windows（いつもの作業場所） |
| Firestore のルール | `firebase deploy --only firestore:rules` | Windows |
| Cloudflare Workers | `worker/` で `npx wrangler deploy` | Windows |
| iPhone アプリ版 | `npm run ios:sync` → Xcode でビルド → TestFlight へアップロード（手順は [ios-setup.md](ios-setup.md)） | Mac（MacBook Pro 2018・Xcode 26.3） |

## 無料枠の目安（家族で使う分には十分）

| サービス | 無料枠 | 気にするところ |
|---|---|---|
| Firestore（Spark） | 1 日：読み取り 5 万・書き込み 2 万・削除 2 万。保存 1GiB | オンライン表示の記録（1 人 1 分に 1〜2 回）、写真（縮小した JPEG を Firestore に保存） |
| Cloudflare Workers | 1 日 10 万リクエスト | 通知とリンクの取得には 1 人ごとの回数の上限を入れてある |
| Cloud Messaging | 無料 | — |
| GitHub Pages | 公開サイト 1GB・月 100GB の転送（目安） | — |

## お金

- かかるのは **Apple Developer Program の年 99 ドルだけ**。ほかに有料のサービス・プランは使わない（Firebase は Blaze にしない）
- 有料のものが必要になりそうなときは、先にユーザーに相談する
