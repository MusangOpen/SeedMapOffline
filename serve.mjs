// 零依赖静态服务器：把 mirror/ 当作 minecraftsearch.com 的本地副本提供服务
// 用法: node serve.mjs [端口]
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, normalize } from 'node:path';

const ROOT = resolve('mirror');
const PORT = Number(process.argv[2]) || 3456;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

/** 把 URL 路径映射到本地文件；返回 null 表示没有对应文件 */
function resolveFile(pathname) {
  const clean = decodeURIComponent(pathname.split('?')[0]);
  const rel = normalize(clean).replace(/^([/\\])+/, '');
  if (rel.includes('..')) return null;
  return rel === '' ? null : join(ROOT, rel);
}

async function tryFile(p) {
  try {
    const st = await stat(p);
    if (st.isFile()) return { path: p, size: st.size };
    if (st.isDirectory()) {
      const idx = join(p, 'index.html');
      const s2 = await stat(idx).catch(() => null);
      if (s2?.isFile()) return { path: idx, size: s2.size };
    }
  } catch { /* 不存在 */ }
  return null;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  res.on('finish', () => {
    if (pathname.startsWith('/wasm/')) {
      console.log(`[wasm] ${res.statusCode} ${pathname}${url.search} (${Date.now() - started}ms)`);
    } else if (res.statusCode >= 400) {
      console.log(`[${res.statusCode}] ${pathname}${url.search}`);
    }
  });

  // 埋点接口：直接吞掉，避免控制台报错
  if (pathname === '/api/rec' || pathname.startsWith('/cdn-cgi/')) {
    res.writeHead(pathname.startsWith('/cdn-cgi/trace') ? 200 : 204, {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    res.end(pathname.startsWith('/cdn-cgi/trace') ? 'fl=local\nh=localhost\nip=127.0.0.1\n' : '');
    return;
  }

  // Next.js 图片优化接口：本地没有图片转换服务，直接把原图返回给浏览器缩放
  if (pathname === '/_next/image') {
    const raw = url.searchParams.get('url') || '';
    if (!raw.startsWith('/') || raw.includes('..')) {
      res.writeHead(400); res.end('bad image url'); return;
    }
    const hit = await tryFile(join(ROOT, decodeURIComponent(raw).replace(/^\//, '')));
    if (!hit) {
      res.writeHead(404); res.end('image not mirrored: ' + raw); return;
    }
    const inner = extname(hit.path).toLowerCase();
    const body = await readFile(hit.path);
    res.writeHead(200, {
      'content-type': MIME[inner] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'public, max-age=86400',
    });
    res.end(body);
    return;
  }

  // 补丁备份文件不对外提供
  if (pathname.endsWith('.orig')) {
    res.writeHead(404);
    res.end();
    return;
  }

  // RSC 预取/导航请求：本地没有对应 payload，返回 204 让 Next 退化成整页刷新
  if (url.searchParams.has('_rsc')) {
    res.writeHead(204);
    res.end();
    return;
  }

  // 根路径进中文版种子地图
  if (pathname === '/' || pathname === '') {
    res.writeHead(302, { location: '/zh-CN/tools/seed-map' });
    res.end();
    return;
  }

  let hit = await tryFile(resolveFile(pathname));

  if (!hit) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 ' + pathname);
    return;
  }

  const ext = extname(hit.path).toLowerCase();
  const type = MIME[ext] || (ext === '' ? 'text/html; charset=utf-8' : 'application/octet-stream');
  const body = await readFile(hit.path);

  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'no-cache',
  });
  res.end(body);
});

const url = `http://127.0.0.1:${PORT}/zh-CN/tools/seed-map`;

function openBrowser() {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`, { shell: 'cmd.exe' }, () => {});
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') {
    console.error('服务启动失败:', err.message);
    process.exit(1);
  }
  console.log(`端口 ${PORT} 已被占用，检查是否已有实例在运行…`);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      console.log('检测到服务已在运行，直接打开浏览器即可。');
      openBrowser();
      process.exit(0);
    }
  } catch { /* 不是本服务 */ }
  console.log(`占用端口的不是本服务。请先结束占用进程，或换端口启动：`);
  console.log(`  node serve.mjs 3457`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`本地镜像已启动: ${url}`);
  console.log(`静态根目录: ${ROOT}`);
  console.log('关闭本窗口或按 Ctrl+C 停止服务。');

  if (!process.argv.includes('--no-open')) {
    setTimeout(openBrowser, 800);
  }
});
