// 扫描本地 js 里出现的静态素材路径（图片/json 等），并发下载缺失的那些
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const ROOT = resolve('mirror');
const ORIGIN = 'https://minecraftsearch.com';
const CONCURRENCY = 12;

// 匹配 "/images/xxx.webp"、"/textures/xxx.png" 这类以斜杠开头的静态资源
const REF = /["'`(](\/[A-Za-z0-9_\-./]+\.(?:png|webp|svg|jpe?g|gif|json|woff2?|ttf))["'`)]/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (['.js', '.css'].includes(extname(name))) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const refs = new Set();
for (const f of files) {
  if (statSync(f).size > 3 * 1024 * 1024) continue;
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(REF)) {
    const p = m[1];
    if (p.startsWith('/_next/') || p.startsWith('/wasm/')) continue;
    refs.add(p);
  }
}

const missing = [...refs].filter((u) => !existsSync(join(ROOT, u.replace(/^\//, ''))));
console.log(`共发现 ${refs.size} 个素材引用，缺失 ${missing.length} 个`);

let ok = 0, fail = 0, done = 0;

async function worker(queue) {
  while (queue.length) {
    const u = queue.pop();
    try {
      const res = await fetch(ORIGIN + u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          Referer: ORIGIN + '/tools/seed-map',
          Accept: 'image/avif,image/webp,image/png,*/*',
        },
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const dest = join(ROOT, decodeURIComponent(u).replace(/^\//, ''));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, buf);
        ok++;
      } else {
        fail++;
      }
    } catch {
      fail++;
    }
    done++;
    if (done % 100 === 0) console.log(`  进度 ${done}/${missing.length}`);
  }
}

const queue = [...missing];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
console.log(`下载成功 ${ok}，失败 ${fail}`);
