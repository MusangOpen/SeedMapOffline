// 用 CDP 打开线上页面，记录全部网络请求，产出资源清单
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const TARGET = process.argv[2] || 'https://minecraftsearch.com/tools/seed-map';
const OUT = process.argv[3] || 'crawl/requests.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${resolve('tools/.chrome-profile')}`,
  '--window-size=1400,900',
  'about:blank',
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
  const browserWs = await waitForDevtools();
  const ws = new WebSocket(browserWs);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  const events = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method) events.push(msg);
  });

  let sessionId = null;
  const send = (method, params = {}) => new Promise((res, reject) => {
    const id = ++msgId;
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.removeEventListener('message', handler);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));

  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');

  await send('Page.navigate', { url: TARGET });
  await sleep(6000);

  // 触发交互，让懒加载的 worker / chunk 也跑出来
  await send('Runtime.evaluate', {
    expression: `(async () => {
      window.scrollTo(0, 300); await new Promise(r => setTimeout(r, 500));
      window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 500));
      const btn = document.querySelector('button');
      return document.title;
    })()`,
    awaitPromise: true, returnByValue: true,
  }).catch(() => {});
  await sleep(4000);

  // 按资源类型汇总
  const byUrl = new Map();
  for (const e of events) {
    const p = e.params;
    if (e.method === 'Network.requestWillBeSent' && p.request) {
      const u = p.request.url;
      if (!u.startsWith('data:') && !u.startsWith('blob:')) {
        const prev = byUrl.get(u);
        if (!prev) byUrl.set(u, { url: u, type: p.type, method: p.request.method });
      }
    } else if (e.method === 'Network.responseReceived' && p.response) {
      const rec = byUrl.get(p.response.url);
      if (rec) {
        rec.status = p.response.status;
        rec.mime = p.response.mimeType;
        rec.fromCache = p.response.fromDiskCache || p.response.fromServiceWorker;
      }
    }
  }

  const list = [...byUrl.values()];
  const stats = {};
  for (const r of list) stats[r.type] = (stats[r.type] || 0) + 1;

  console.log('总请求:', list.length);
  console.log('按类型:', JSON.stringify(stats));
  console.log('按状态:', JSON.stringify(list.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {})));

  writeFileSync(OUT, JSON.stringify(list, null, 1));
  console.log('清单已写入', OUT);

  const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  console.log('页面标题:', title.result.value);
} finally {
  chrome.kill();
}
