// 在真实浏览器里探测 URL 状态，避免 fetch/header 差异导致的误判
// 用法: node tools/probe-urls.mjs <页面URL> <要探测的路径,逗号分隔>
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const PAGE = process.argv[2] || 'https://minecraftsearch.com/tools/seed-map';
const PATHS = (process.argv[3] || '/wasm/cubiomes.js').split(',').filter(Boolean);

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
  await sleep(5000);

  for (const p of PATHS) {
    const expr = `fetch(${JSON.stringify(p)}, {cache:'no-store'}).then(async r => r.status + ' | ' + (r.headers.get('content-type')||'-') + ' | ' + (await r.text()).length).catch(e => 'ERR ' + e.message)`;
    const out = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    console.log(p.padEnd(48), '=>', out.result.value);
  }
} finally {
  chrome.kill();
}
