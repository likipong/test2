#!/usr/bin/env node
/* index.html の CSS / JS を 1 枚の HTML に埋め込む。
 *   dist/dia-editor.html … ブラウザで直接開ける単体ファイル
 *   dist/artifact.html  … <head>/<body> を持たない埋め込み用（Artifact 公開向け）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let out = html
  .replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">\n?/g,
    (m, href) => /^https?:/.test(href) ? m : '<style>\n' + read(href) + '\n</style>\n')
  .replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g,
    (_, src) => '<script>\n' + read(src) + '\n</script>\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/dia-editor.html'), out);

// Artifact 用：外枠のタグを外し、<title> と <style> と本文だけにする
const title = (/<title>([^<]*)<\/title>/.exec(out) || [, '運転ダイヤ作成'])[1];
const styles = (out.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
const body = (/<body>([\s\S]*)<\/body>/.exec(out) || [, ''])[1];
fs.writeFileSync(path.join(root, 'dist/artifact.html'),
  `<title>${title}</title>\n${styles}\n${body.trim()}\n`);

const kb = f => (fs.statSync(path.join(root, f)).size / 1024).toFixed(0) + ' KB';
console.log('dist/dia-editor.html', kb('dist/dia-editor.html'));
console.log('dist/artifact.html  ', kb('dist/artifact.html'));
