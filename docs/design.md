# ouchi-share 設計メモ

## 方針

- iPhone の Safari で使う PWA（ホーム画面に追加して使う）
- 画面は静的サイトとして GitHub Pages で公開
- データはクラウド DB（Firebase Firestore 予定）でメンバー間同期
  - 現在のサンプルは `js/store.js` で localStorage に保存。画面側は store の関数だけを使うので、Firestore 版に差し替え可能

## データ構造

```
users/{userId}                      ユーザー情報（所属グループ一覧など）
groups/{groupId}                    グループ（家族、恋人、友人…）
  ├─ name
  ├─ members: { userId: role }      role = owner / editor / viewer（予定）
  └─ lists/{listId}                 1 つのリスト（ページ）
        ├─ type: checklist | inventory | schedule
        ├─ title, emoji
        ├─ copiedFrom: { groupId, listId }   別グループからコピーした場合
        └─ items/{itemId}           リストの中身
```

- 共有の単位は **グループ**。1 人が複数グループに所属できる
- リストは `type` で表示を切り替える。スケジュール・在庫なども同じ枠組みに載せる

## 決定事項

| 項目 | 決定 |
|---|---|
| 共有単位 | グループ |
| 別グループへの展開 | **コピー方式**（同期はしない）。コピー元・コピー先両方のメンバーのみ実行可。実装は後回し |
| 最初の機能 | チェックリスト |

## 検討中

- **ログイン / 参加方法**
  - 招待 URL を受け取った人はそのままグループに参加できる（ゲスト参加）
  - 候補: Firebase の匿名認証でゲスト参加 → あとで Google ログインなどに「昇格」できる
  - 編集にはログイン必須にするか、ゲストも編集可にするかは要相談
- 招待 URL の有効期限・無効化
