// 按请求清单把站点资源镜像到本地 mirror/ 目录，保持原始路径结构
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve('mirror');
const LIST = process.argv[2] || 'crawl/requests.json';
const ORIGIN = 'https://minecraftsearch.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const list = JSON.parse(readFileSync(LIST, 'utf8'));

/** URL → 本地相对路径（丢弃 query，目录补 index.html） */
function localPath(u) {
  const url = new URL(u);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (!p.startsWith('/')) p = '/' + p;
  return p.slice(1);
}

const targets = list.filter((r) => {
  try { return new URL(r.url).host === 'minecraftsearch.com'; } catch { return false; }
});

console.log('待镜像同源资源:', targets.length);

let ok = 0, skip = 0, fail = 0, bytes = 0;
const failed = [];

for (const r of targets) {
  const rel = localPath(r.url);
  const abs = join(ROOT, rel);
  if (existsSync(abs)) { skip++; continue; }

  try {
    const res = await fetch(r.url, {
      headers: { 'User-Agent': UA, Referer: ORIGIN + '/tools/seed-map', Accept: '*/*' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
    bytes += buf.length;
    ok++;
    if (ok % 20 === 0) console.log(`  已下载 ${ok} …`);
  } catch (e) {
    fail++;
    failed.push({ url: r.url, error: String(e.message) });
  }
}

console.log(`\n完成：成功 ${ok}，已存在跳过 ${skip}，失败 ${fail}，合计 ${(bytes / 1048576).toFixed(1)} MB`);
if (failed.length) {
  console.log('失败清单：');
  for (const f of failed) console.log('  ', f.url, '->', f.error);
  writeFileSync(join(ROOT, '_failed.json'), JSON.stringify(failed, null, 1));
}
