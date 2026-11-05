// 递归补齐静态资源：扫描本地 html/js 里出现的 chunk 引用，下载缺失的那些，直到收敛
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const ROOT = resolve('mirror');
const ORIGIN = 'https://minecraftsearch.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// 匹配形如 static/chunks/xxx.js、/_next/static/media/xxx.woff2 的引用
const REF = /(?:^|["'`(\s])((?:\/_next\/)?(?:static\/(?:chunks|media)|_next\/static\/(?:chunks|media))\/[A-Za-z0-9_\-\.]+\.(?:js|css|woff2?|png|webp|svg|json))/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (['.js', '.html', '.css', '.json'].includes(extname(name))) out.push(p);
  }
  return out;
}

function toUrlPath(ref) {
  if (ref.startsWith('/_next/')) return ref;
  if (ref.startsWith('_next/')) return '/' + ref;
  if (ref.startsWith('/static/')) return '/_next' + ref;
  return '/_next/' + ref;
}

function localFor(urlPath) {
  return join(ROOT, decodeURIComponent(urlPath).replace(/^\//, ''));
}

let round = 0;
let downloaded = 0;

while (round < 8) {
  round++;
  const files = walk(ROOT);
  const refs = new Set();
  for (const f of files) {
    if (statSync(f).size > 3 * 1024 * 1024) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(REF)) refs.add(toUrlPath(m[1]));
  }

  const missing = [...refs].filter((u) => !existsSync(localFor(u)));
  console.log(`第 ${round} 轮：共发现 ${refs.size} 个引用，缺失 ${missing.length} 个`);

  if (missing.length === 0) break;

  for (const u of missing) {
    const dest = localFor(u);
    try {
      const res = await fetch(ORIGIN + u, {
        headers: { 'User-Agent': UA, Referer: ORIGIN + '/tools/seed-map', Accept: '*/*' },
      });
      if (!res.ok) { console.log(`  跳过 ${u} (HTTP ${res.status})`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      downloaded++;
    } catch (e) {
      console.log(`  失败 ${u}: ${e.message}`);
    }
  }
  console.log(`  本轮下载 ${downloaded} 个`);
}

console.log(`\n完成：共下载 ${downloaded} 个资源`);
