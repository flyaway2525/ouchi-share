# ouchi-share

家族・恋人・友人と共有できる、おうちの情報共有ツール（iPhone 向け PWA）。

## 予定している機能

- 📅 スケジュール共有
- 🧊 冷蔵庫の中身リスト
- 🧻 日用品の在庫チェック（トイレットペーパーなど）
- 🧳 旅行の持ち物リスト・出発前チェックリスト

## 構成（予定）

- フロントエンド: 静的サイト（PWA）を GitHub Pages で公開
- データ: クラウド DB（Firebase など）でメンバー間同期

## ローカルで動かす

```bash
python -m http.server 5173
```

ブラウザで http://localhost:5173/ を開く。

> 現在のサンプルはデータを端末内（localStorage）に保存します。共有機能は Firebase 導入後に対応予定。
> 設計メモは [docs/design.md](docs/design.md) を参照。
