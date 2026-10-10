# アプリ内課金（👑 サブスク・💎 買い切り）の作り方の計画

まだ作っていない。方針は [design.md](design.md) の「有料プランの方針」、App Store に入力するものは [app-store.md](app-store.md)。
課金の判定（使えるか）は js/skins.js にもう作ってある（`canUse`・`canUsePhoto`・`canShare`。今は `TRIAL = true` でだれでも使える）。
ここに書くのは、課金の状態をどう作って、その判定につなぐか。

最終更新: 2026-10-10

## 決まり（費用ゼロのまま作る）

- RevenueCat など有料・売上の何 % を取るサービスは使わない（no-costly-designs）
- 買う：iPhone アプリ版だけ（StoreKit 2）。ブラウザ版・ホーム画面版・Android は、課金の状態を読むだけ（グループのデータに入るので、どの形でも同じように効く）
- 課金の状態を書くのは Cloudflare Workers だけ（Apple が署名した取引を確かめてから）。アプリからは書けないようにルールで止める
- 読み取りを増やさない：グループの特典は `groups/{id}` に入れて、いまのグループの監視で一緒に届くようにする

## 商品（App Store Connect で作る）

| 商品 ID（案） | 種類 | 中身 |
|---|---|---|
| `ouchishare.sub.monthly` | 自動更新サブスク（月） | 👑 の着せ替え・自分の写真の壁紙・壁紙のおすそわけ。グループのメンバーにも 👑 を共有 |
| `ouchishare.sub.yearly` | 自動更新サブスク（年） | 同じ（2 か月分お得に） |
| `ouchishare.skin.<id>` | 非消耗型（買い切り） | 💎 の着せ替え 1 つ（中身ができてから） |

- 同じ「サブスクリプショングループ」に月・年を入れる（どちらか 1 つだけ有効になる）
- 1 か月の無料期間（お試しのオファー）を付ける

## データ

```
entitlements/{uid}          … Workers だけが書く。本人だけ読める
  { sub: { product, expiresAt, autoRenew, originalTransactionId }, owned: ['skin-id', ...], updatedAt }

groups/{id}.premium         … Workers だけが書く。メンバーが読める（グループの監視で届く）
  { subs: [サブスク中のメンバーの uid], owned: { 'skin-id': [買った人の uid] } }
```

- アプリは自分の `entitlements/{uid}` を 1 回読んで（起動時・購入後）、`skins.canUse(skin, { me, group })` の `me` に渡す
- 有効期限が切れたら、Workers が `premium.subs` から外す（下の「更新・解約」）
- firestore.rules：`entitlements` は本人の read だけ。`groups/{id}` の update の許可リストに `premium` を入れない（今もそうなので、アプリからは書けない）

## 流れ

### 買う（アプリ版）
1. 設定の画面（と着せ替えのシートの 👑）に「👑 サブスクにする」→ 月・年・値段・無料期間・自動更新の説明（Apple の決まり）・規約とプライバシーポリシーのリンク
2. StoreKit 2 で購入 → 取引（JWS の signedTransaction）を受け取る
3. Workers の `POST /purchase`（ID トークン付き）に signedTransaction を送る
4. Workers が確かめる：JWS の署名を Apple のルート証明書までたどる（x5c）、bundleId・productId・環境（本番／サンドボックス）・期限・`appAccountToken`（= 本人の uid から作った UUID。なりすまし防止）
5. `entitlements/{uid}` を書き、本人が入っている全グループの `premium.subs` に uid を足す
6. アプリは `entitlements` を読み直して、すぐ 👑 が使えるようになる

### 更新・解約・返金（App Store Server Notifications V2）
- App Store Connect に Workers の `POST /appstore-notify` を登録 → 更新（DID_RENEW）・期限切れ（EXPIRED）・返金（REFUND）などが届く
- 署名を確かめてから `entitlements` と、その人が入っている全グループの `premium` を直す
- 念のため、毎日の定期実行（今のリマインドと同じ cron）で、期限が過ぎた `entitlements` を片付ける

### グループに入る・抜ける・アカウントを消す
- サブスクの人がグループに参加 → そのグループの `premium.subs` に足す（参加のあとアプリが `POST /purchase` の「同期」を呼ぶ）
- 抜けた・外された・アカウントを消した → Workers が `premium` から外す（アカウントの削除の `adminDeleteUser` にも足す）

### 購入を復元
- 設定の画面に「購入を復元」（Apple の決まり）。StoreKit の `AppStore.sync()` → 今の有効な取引を `POST /purchase` に送り直す

## プラグイン（Capacitor）

- 無料のものから選ぶ（候補：`@capgo/native-purchases`、`cordova-plugin-purchase`。StoreKit 2 と `appAccountToken` を渡せるか、SPM で入れられるかを Mac で確かめる）
- 合わなければ、StoreKit 2 を呼ぶ小さな自作のプラグイン（Swift）にする

## アプリの見た目

- 👑 の着せ替えは、持っていなくても見本を見る・その場で試すのはできる。保存のときに「👑 サブスクで使えます」→ 購入の画面へ
- サブスク中は、設定の画面に「👑 サブスク中（次の更新日）」と「サブスクの管理」（App Store のサブスクの画面を開く）
- サブスクの人がいるグループでは、グループのプロフィールの画面などに「👑 〇〇さんのサブスクで、このグループでは 👑 が使えます」

## テスト

- App Store Connect のサンドボックスのテスターで買う（実際にはお金はかからない）。Xcode の StoreKit の設定ファイルで、手元でも試せる
- 購入・更新・期限切れ・返金・復元・別の端末・グループの参加と脱退、を device-test.md に足す

## 順番

1. App Store Connect：有料アプリの契約・税と口座・Small Business Program（ユーザー）
2. 商品を作る（ユーザー。ID は上の案）
3. Workers：`/purchase`・`/appstore-notify`・定期の片付け（Windows でできる）
4. firestore.rules：`entitlements`（Windows でできる）
5. アプリ：プラグイン・購入の画面・復元（Mac）
6. `skins.js` の `TRIAL` を false に
