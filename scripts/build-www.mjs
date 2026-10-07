// iPhone アプリ版（Capacitor）に入れる Web のファイルを www/ にまとめる。
// Web 版（GitHub Pages）はリポジトリ直下のファイルをそのまま使うので、ここでは中身を変えずにコピーするだけ。
// 使い方：npm run build（npm run ios:sync なら、このあと Xcode のプロジェクトにも反映する）
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
const DIRS = ['css', 'js', 'icons'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`);
for (const d of DIRS) cpSync(d, `www/${d}`, { recursive: true });
console.log('www/ を作りました');
