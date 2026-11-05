// 精简语言列表：只保留英文与简体中文
// 用法: node tools/trim-locales.mjs [--restore]
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 语言列表数组出现在这几个 chunk 里
const TARGETS = [
  'mirror/_next/static/chunks/1nv4r-4142jb0.js',
  'mirror/_next/static/chunks/1_qw37-p-4f7o.js',
  'mirror/_next/static/chunks/26vx3x00u8kt6.js',
];

// 只保留的两项（保持原字段结构）
const KEEP = '[{code:"en-US",name:"EN (US)",flagCode:"us",autonym:"English"},' +
  '{code:"zh-CN",name:"ZH (CN)",flagCode:"cn",autonym:"简体中文",scriptLabel:"简"}]';

if (process.argv.includes('--restore')) {
  for (const rel of TARGETS) {
    const f = resolve(rel);
    if (existsSync(f + '.orig')) { copyFileSync(f + '.orig', f); console.log('已还原', rel); }
  }
  process.exit(0);
}

/** 从 start（指向 '['）开始做括号匹配，返回数组表达式结束后的下标 */
function matchArray(text, start) {
  let depth = 0, inStr = false, quote = '';
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = true; quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

for (const rel of TARGETS) {
  const f = resolve(rel);
  if (!existsSync(f)) { console.log('跳过（不存在）', rel); continue; }

  const bak = f + '.orig';
  if (!existsSync(bak)) copyFileSync(f, bak);

  const src = readFileSync(bak, 'utf8');   // 始终以原始版本为基础，保证幂等
  const start = src.indexOf('[{code:"en-US"');
  if (start < 0) { console.log('跳过（未找到语言数组）', rel); continue; }

  const end = matchArray(src, start);
  if (end < 0) { console.log('跳过（括号匹配失败）', rel); continue; }

  const original = src.slice(start, end);
  const out = src.slice(0, start) + KEEP + src.slice(end);
  writeFileSync(f, out);
  console.log(`OK ${rel}  数组 ${original.length} -> ${KEEP.length} 字符`);
}

console.log('\n完成。语言列表现在只保留 en-US / zh-CN。');
