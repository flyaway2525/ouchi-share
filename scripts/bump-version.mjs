// バージョンを 1 つ上げる（プッシュする前に毎回実行する）。
// 使い方：node scripts/bump-version.mjs "変更の内容（1 行）"
// 書き換えるもの：
//   js/version.js … アプリに埋め込むバージョンと日時（ホームのタイトルの横に出る）
//   version.json  … 公開中の最新バージョン（アプリが「更新あり」を確かめるのに使う）
//   sw.js         … オフライン用の保存（キャッシュ）の名前。変えると新しいファイルを取り直す
//   CHANGELOG.md  … 変更履歴（いちばん上に追記）
import { readFileSync, writeFileSync } from 'node:fs';

const note = process.argv.slice(2).join(' ').trim();
if (!note) {
  console.error('使い方：node scripts/bump-version.mjs "変更の内容"');
  process.exit(1);
}

const current = Number(readFileSync('js/version.js', 'utf8').match(/APP_VERSION = (\d+)/)[1]);
const next = current + 1;
// 日本時間の「2026-10-08 12:34」
const jst = new Date(Date.now() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 16);

writeFileSync(
  'js/version.js',
  `// アプリのバージョン（scripts/bump-version.mjs が書き換える。手で直さない）
export const APP_VERSION = ${next};
export const APP_BUILT_AT = '${jst}';
`,
);
writeFileSync('version.json', `${JSON.stringify({ version: next, builtAt: jst, note }, null, 2)}\n`);

const sw = readFileSync('sw.js', 'utf8');
writeFileSync('sw.js', sw.replace(/const CACHE = 'ouchi-share-v\d+';/, `const CACHE = 'ouchi-share-v${next}';`));

const log = readFileSync('CHANGELOG.md', 'utf8');
const marker = '<!-- 新しい版はこの下に追記（scripts/bump-version.mjs） -->\n';
writeFileSync('CHANGELOG.md', log.replace(marker, `${marker}\n## v${next}（${jst}）\n\n- ${note}\n`));

console.log(`v${current} → v${next}（${jst}）`);
