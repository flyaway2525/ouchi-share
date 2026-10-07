# iPhone アプリ版（TestFlight で家族に配る）の手順

Web 版（GitHub Pages）のファイルを、そのまま **Capacitor** で iPhone アプリに包む。配り方は **TestFlight**（家族・友人だけに招待で配る。収益化なし）。
リポジトリ側の準備（`package.json`・`capacitor.config.json`・`scripts/build-www.mjs`・`icons/icon-1024.png`）は Windows で済ませてある。
ここから先は **Mac** で行う。Mac にも Claude Code を入れて、このファイルを見せながら進めるとよい。

- アプリ名：おうちでシェア
- Bundle ID：`io.github.flyaway2525.ouchishare`（あとから変えられないので、変えるなら最初に `capacitor.config.json` を直す）
- かかるお金：Apple Developer Program の年 99 ドルだけ

---

## 0. Apple Developer Program を復旧する（本人の操作）

1. Mac で https://developer.apple.com/account を開き、**前に登録したときの Apple ID** でサインイン
   - パスワードを忘れていたら https://iforgot.apple.com で再設定
2. 期限切れなら「メンバーシップを更新（Renew）」の案内が出るので、年 99 ドルを支払う
   （Mac の「Apple Developer」アプリからでもできる）
3. 「Membership details」が有効（Active）になれば OK。反映まで数時間〜1 日かかることがある

## 1. Mac の準備

1. **Xcode 26.3** を入れて、一度起動（追加のコンポーネントのインストールを済ませる）
   - 使う Mac は MacBook Pro 13 インチ（2018・Intel）で、macOS は **Sequoia（15.8.1）まで**（Tahoe には上げられない）
   - App Store の最新 Xcode（26.4 以降）は Tahoe が必要で入らないので、https://developer.apple.com/download/all/ から
     「Xcode 26.3.xip」をダウンロード → ダブルクリックで展開 →「アプリケーション」に移動
   - アップロードの条件は「Xcode 26 以降」（2026-04-28 から）なので 26.3 で足りる。Capacitor 8 も Xcode 26 以上が条件
   - 将来 Xcode 27 が必須になったら（例年なら 2027 年の春）、この Mac ではアップロードできなくなる →
     クラウドでビルドする（Codemagic の無料枠など）に切り替える
2. Xcode → Settings → Accounts で、上の Apple ID を追加（チームが表示されれば OK）
3. **Node.js**（LTS）を https://nodejs.org から入れる
4. **Claude Code** を入れる（デスクトップアプリか、ターミナルで `npm install -g @anthropic-ai/claude-code`）
5. リポジトリを持ってくる

   ```bash
   git clone https://github.com/flyaway2525/ouchi-share.git
   ```

## 2. iOS のプロジェクトを作って、シミュレーターで動かす

`ios/`（Xcode のプロジェクト）は Windows で作ってコミット済み（2026-10-07。アイコン・起動画面・暗号化の申告も入れてある）。Mac では：

```bash
cd ouchi-share
npm install
npm run ios:sync
npm run ios:open
```

- 部品（Capacitor）は Swift Package Manager で GitHub から取ってくるので、CocoaPods は要らない。最初に Xcode が部品を読み込むまで少し待つ
- Xcode が開いたら、左の「App」→ Signing & Capabilities → **Team** に自分のチームを選ぶ
- 上のメニューでシミュレーター（iPhone 16 など）を選んで ▶ で起動
- Web のファイルを直したら、毎回 `npm run ios:sync` でアプリにも反映する

### アイコン・起動画面・暗号化の申告（済み）

- アイコン：`icons/icon-1024.png`（`scripts/make-icon-1024.mjs` で作成）を AppIcon に入れてある
- 起動画面：クリーム色の背景に角丸のアイコン（`scripts/make-splash.mjs` で作成）
- `Info.plist` に `ITSAppUsesNonExemptEncryption` = `NO`（HTTPS しか使っていないので、アップロードのたびに聞かれないように）

## 3. アプリの中だけ動かないところを直す（Mac の Claude Code で）

Web 版のままだと、アプリの中では次が動かない。ここは Mac で実機・シミュレーターを見ながら直す。

1. **Google ログイン**：ポップアップのログインはアプリの中では開けない
   - `@capacitor-firebase/authentication` を入れて、iPhone の仕組みの Google ログインにする（`js/auth.js` で `isNativeApp` のときだけ切り替え）
   - Firebase コンソール → プロジェクトの設定 → **iOS アプリを追加**（Bundle ID は上と同じ）→ `GoogleService-Info.plist` を Xcode の App フォルダに入れる
   - Google でのログインがあるアプリは「**Apple でサインイン**」も付けるのが Apple のルール → Firebase の Authentication で Apple を有効にし、Xcode の Signing & Capabilities に「Sign in with Apple」を追加
   - ゲスト（匿名ログイン）と招待リンクからの参加は、今のままで動く見込み
2. **通知**：Web の通知（Service Worker）はアプリの中では使えない
   - `@capacitor-firebase/messaging` を入れて、アプリの通知（APNs）にする
   - Apple Developer → Keys で **APNs キー（.p8）** を作り、Firebase コンソール → Cloud Messaging → Apple アプリの構成 に登録
   - Xcode の Signing & Capabilities に「Push Notifications」と「Background Modes → Remote notifications」を追加
   - 通知を送る Workers は、アプリ向け（apns）の書き方も入れてあるので、端末のトークンを `push/{uid}` に保存すれば届く
3. 済んでいること（Windows 側で対応済み）
   - アプリの中では Firebase のログイン情報の保存先を IndexedDB にして初期化（`js/firebase.js` の `isNativeApp`）
   - 招待リンク・復旧リンク・QR は、アプリの中でも Web 版のアドレス（`WEB_URL`）で作る

## 4. 自分の iPhone で動かす

1. iPhone を USB で Mac につなぐ → iPhone の 設定 → プライバシーとセキュリティ → **デベロッパモード** をオン
2. Xcode の上のメニューで自分の iPhone を選んで ▶

## 5. TestFlight で家族に配る

1. https://appstoreconnect.apple.com → マイ App → ＋ → 新規 App
   - プラットフォーム：iOS、名前：おうちでシェア（ほかのアプリと同じ名前は使えないので、だめなら少し変える）
   - 主言語：日本語、バンドル ID：上と同じ、SKU：`ouchi-share` など
2. Xcode：上のメニューで「Any iOS Device」を選ぶ → Product → **Archive** → Distribute App → App Store Connect → アップロード
3. App Store Connect の **TestFlight** タブ（処理に 10〜30 分ほど）
   - **外部テスト**のグループを作り、家族を追加（メールで招待、または公開リンク）。外部テストは最初のビルドだけ簡単な審査（1 日ほど）がある
   - テスト情報（アプリの説明・連絡先のメールなど）を入れる
4. 家族は iPhone に「**TestFlight**」アプリを入れて、招待から「おうちでシェア」をインストール

### 期限

- TestFlight のビルドは **90 日で期限切れ**。それまでに Mac から新しいビルドをアップロードする（2 の Archive からやり直し。番号（Build）を 1 つ上げる）
- Web 版を直しただけなら、アプリは次のビルドまで古いまま（`npm run ios:sync` → Archive → アップロードで更新）
