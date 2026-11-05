// 借助真实浏览器下载资源（绕过服务端对非浏览器请求的拦截），按 URL 路径落盘到 mirror/
// 用法: node tools/fetch-via-browser.mjs <路径1,路径2,...> [目标目录]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const PAGE = 'https://minecraftsearch.com/tools/seed-map';
const PATHS = (process.argv[2] || '').split(',').filter(Boolean);
const OUT_DIR = resolve(process.argv[3] || 'mirror');

if (!PATHS.length) { console.error('需要给出路径列表'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run',
  '--no-default-browser-check', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${resolve('tools/.chrome-profile3')}`, 'about:blank',
], { stdio: 'ignore' });

let msgId = 0;
async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* 等待 */ }
    await sleep(250);
  }
  throw new Error('DevTools 未就绪');
}

try {
  const ws = new WebSocket(await waitForDevtools());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let sessionId = null;
  const send = (method, params = {}) => new Promise((res, reject) => {
    const id = ++msgId;
    const handler = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener('message', handler);
        m.error ? reject(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
    ws.addEventListener('message', handler);
    const m = { id, method, params };
    if (sessionId) m.sessionId = sessionId;
    ws.send(JSON.stringify(m));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: PAGE });
  await sleep(4000);

  for (const p of PATHS) {
    const expr = `(async () => {
      const r = await fetch(${JSON.stringify(p)}, {cache:'no-store'});
      if (!r.ok) return { status: r.status };
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = '';
      const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      return { status: r.status, size: buf.length, b64: btoa(s) };
    })()`;
    const out = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const v = out.result.value;
    if (!v || v.status !== 200) { console.log(`${p} => 失败 ${v ? v.status : '无结果'}`); continue; }

    const clean = p.split('?')[0];
    const dest = join(OUT_DIR, decodeURIComponent(clean).replace(/^\//, ''));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(v.b64, 'base64'));
    console.log(`${p} => ${v.size} 字节 -> ${dest}`);
  }
} finally {
  chrome.kill();
}
