// 用 Chrome DevTools Protocol 驱动页面：执行 JS、截图，用于验证离线地图
// 用法: node tools/shot.mjs <页面路径> <输出png> [要执行的JS]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;

const [pageArg, outArg, jsArg] = process.argv.slice(2);
if (!pageArg || !outArg) {
  console.error('用法: node tools/shot.mjs <页面> <输出png> [js]');
  process.exit(1);
}
const pageUrl = pageArg.startsWith('http') ? pageArg : pathToFileURL(resolve(pageArg)).href;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${resolve('tools/.chrome-profile')}`,
  '--window-size=1400,900',
  'about:blank',
], { stdio: 'ignore' });

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('DevTools 未就绪');
}

let msgId = 0;
function makeClient(ws) {
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  });
  return (method, params = {}) => new Promise((res, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve: res, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const browserWs = await waitForDevtools();
  const browser = new WebSocket(browserWs);
  await new Promise((r, j) => { browser.onopen = r; browser.onerror = j; });
  const bcall = makeClient(browser);

  const { targetId } = await bcall('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await bcall('Target.attachToTarget', { targetId, flatten: true });

  const send = (method, params = {}) => new Promise((res, reject) => {
    const id = ++msgId;
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        browser.removeEventListener('message', handler);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
    browser.addEventListener('message', handler);
    browser.send(JSON.stringify({ id, method, params, sessionId }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: pageUrl });
  await sleep(2500);

  if (jsArg) {
    const ev = await send('Runtime.evaluate', { expression: jsArg, awaitPromise: true, returnByValue: true });
    if (ev.exceptionDetails) console.error('页面异常:', JSON.stringify(ev.exceptionDetails).slice(0, 400));
    else console.log('eval =', JSON.stringify(ev.result.value));
    await sleep(1600);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outArg, Buffer.from(shot.data, 'base64'));
  console.log('已保存', outArg);

  const status = await send('Runtime.evaluate', {
    expression: "document.getElementById('status').textContent + ' | ' + document.getElementById('hud').textContent",
    returnByValue: true,
  });
  console.log('状态:', status.result.value);
} finally {
  chrome.kill();
}
