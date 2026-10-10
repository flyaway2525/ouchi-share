# ouchi-share（おうちでシェア）— Claude Code 向けの決まり

家族・友だちで予定やリストを共有するアプリ。vanilla JS の PWA（ビルドなし、ES modules）を GitHub Pages で公開し、
iPhone アプリは Capacitor で包んで TestFlight で配る。Firebase（Spark プラン）と Cloudflare Worker を使う。
有料サービスは使わない（Apple の年 99 ドルだけ）。設計は docs/design.md、残りの作業は docs/todo.md。
使っているサービス・費用・秘密の値の置き場所・データの流れは docs/architecture.md。サービスやプラン、設定値（URL・キーの置き場所など）を変えたら、そのファイルも直す。

## 対応する環境
アプリの形は 3 つ。それぞれ iPhone・Android（ブラウザ版は PC も）で動かす。

| 形 | 中身 | 対応する端末 |
|---|---|---|
| **ブラウザ版** | GitHub Pages の Web ページをブラウザで開く | PC（Chrome など）、iPhone（Safari）、Android（Chrome） |
| **ホーム画面版** | ブラウザ版を「ホーム画面に追加」したもの（PWA。全画面で開く） | iPhone、Android |
| **アプリ版** | Capacitor で包んだアプリ（iPhone は TestFlight で配る） | iPhone（Android は今後） |

- 形によって決まっている違い（例）：
  - iPhone のホーム画面版は、Safari とログインが別。
  - 通知は、ホーム画面版とアプリ版だけ。
  - Apple でのログインは、アプリ版だけ。
  - ホーム画面に追加の案内は、ブラウザ版だけ。
  - 形の判定は `auth.isNativeApp`（アプリ版）・`isStandalone()`（ホーム画面版）。
- 環境によって動きが違うとき（クリップボード、長押し・スワイプなどのタッチ操作、キーボード、日付・時刻の入力、ホーム画面への追加、通知、ログインなど）は、いちばん弱い環境に合わせて機能を削らず、**環境ごとに判定してそれぞれに合った動きにする**。
  - 判定は機能があるかどうかで行う（例：`navigator.clipboard.read` があるか）。それで決められないときだけ、端末の種類（`isIOS()` / `isAndroid()` / `auth.isNativeApp` / `isStandalone()` など）で分ける。
  - 環境ごとの違いと、どう分けたかは docs/design.md の該当する節に書く。

## テストと実機確認
- 手元で確かめられるのは PC の Chrome（ログイン済みのユーザーの Chrome と、組み込みのブラウザ）だけ。Chrome で動いても、iPhone・Android で同じとは限らない。
- 次のような変更は「Chrome で確認済み・実機は未確認」として扱い、**docs/device-test.md に実機確認の項目を足す**：タッチ操作（長押し・スワイプ・ドラッグ）、クリップボード、キーボードや入力欄、日付・時刻の入力、ホーム画面に追加・通知・ログイン、Safari や WebKit で動きが違いそうなもの。
- ユーザーは iPhone・Android の実機を用意できる。実機で確かめた結果を教えてもらったら、docs/device-test.md の結果の欄を更新し、うまく動かない環境はその環境に合わせて直す。
- 報告では、Chrome で確かめたことと、実機でまだ確かめていないことを分けて書く。

## 進め方の決まり
- プッシュするたびに `node scripts/bump-version.mjs "変更の内容"` で版を上げる（js/version.js・version.json・sw.js・CHANGELOG.md がまとめて変わる）。コミットの件名は「vNN: …」。報告にも版を書く（ホームの版の表示で反映を確かめてもらう）。
- プッシュ、`firebase deploy --only firestore:rules`、Worker の `npx wrangler deploy` は、毎回確認しなくてよい。
- 画面とポップアップの閉じ方の決まりは docs/design.md の「画面とポップアップの閉じ方（決まり）」に従う。
- 画面やメニューの項目を足す・動かすときは、docs/design.md の「画面の地図」を先に直す（「設定」= 自分のこと、「管理」= グループ全体のこと。メニューは 1 段が基本で、入り口を増やしすぎない）。
- テスト用のページ（`_*.html`）はコミットする前に消す。ユーザーのデータでテストしたときは、作ったものを最後に消す。
