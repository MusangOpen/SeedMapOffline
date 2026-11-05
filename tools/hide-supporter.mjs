// 隐藏「支持者」相关的推广横幅与升级入口
// 用法: node tools/hide-supporter.mjs [--restore]
//   --restore  移除注入的样式块
// 说明：用 CSS 隐藏而不是删除节点——React 重新渲染时不会报错，
//       且对后续动态插入的 nudge 横幅同样生效。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGES = [
  'mirror/zh-CN/tools/seed-map',
  'mirror/tools/seed-map',
];

const MARK = 'hide-supporter';
const SNIPPET = `<style id="${MARK}">` +
  '[data-v3="supporter-nudge"],.ms-sup-nudge,' +
  '[data-v3="supporter-card"],[data-v3="supporter-row"],[data-v3="supporter-thanks"],' +
  'a[href$="/supporter"]{display:none!important}' +
  '</style>';

const restore = process.argv.includes('--restore');
let changed = 0;

for (const rel of PAGES) {
  const f = resolve(rel);
  if (!existsSync(f)) { console.log('跳过（不存在）', rel); continue; }

  let html = readFileSync(f, 'utf8');
  const already = html.includes(`id="${MARK}"`);

  if (restore) {
    if (!already) { console.log('无需还原', rel); continue; }
    html = html.replace(new RegExp(`<style id="${MARK}">[\\s\\S]*?</style>`), '');
    writeFileSync(f, html);
    console.log('已还原', rel);
    changed++;
    continue;
  }

  if (already) { console.log('已注入，跳过', rel); continue; }
  if (!html.includes('</head>')) { console.log('跳过（没有 </head>）', rel); continue; }

  html = html.replace('</head>', SNIPPET + '</head>');
  writeFileSync(f, html);
  console.log('已注入', rel);
  changed++;
}

console.log(restore ? `\n还原 ${changed} 个页面` : `\n处理 ${changed} 个页面`);
