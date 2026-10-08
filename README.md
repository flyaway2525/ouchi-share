# ouchi-share（おうちでシェア）

家族・恋人・友だちの小さなグループで、予定・リスト・日記を共有するアプリ。

- 公開中：https://flyaway2525.github.io/ouchi-share/
- 形は 3 つ：ブラウザ版・ホーム画面版（ブラウザ版をホーム画面に追加）・iPhone アプリ版（TestFlight で家族に配る）
- 主な機能：カレンダーと普段の予定、テキスト予定表、イベントと旅程、通常のリスト・欲しいもの系リスト・貸し借りリスト、日記、お知らせと通知、ログインボーナス、プロフィール

## 構成

- 画面：ビルドなしの素の JavaScript（ES modules）。GitHub Pages で公開し、アプリ版は同じファイルを Capacitor で包む
- データ：Firebase（Firestore + Authentication、無料の Spark プラン）でメンバー間をリアルタイムに同期
- 通知・リンクのタイトルと画像の取得：Cloudflare Workers（無料プラン。[worker/](worker/README.md)）

## ローカルで動かす

```bash
python -m http.server 5173
```

ブラウザで http://localhost:5173/ を開く。

## 資料

- [CLAUDE.md](CLAUDE.md)：開発の決まり（対応する環境、テストと実機確認、版の上げ方）
- [docs/design.md](docs/design.md)：設計メモ（機能一覧と意図、データ構造、各機能の決まり）
- [docs/todo.md](docs/todo.md)：次にやること
- [docs/device-test.md](docs/device-test.md)：実機確認リスト
- [docs/ios-setup.md](docs/ios-setup.md)：iPhone アプリ版の作り方（Mac での作業）
- [CHANGELOG.md](CHANGELOG.md)：版ごとの変更
