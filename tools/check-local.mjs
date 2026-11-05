// 打开页面，收集控制台错误 / 未捕获异常 / 失败请求 / worker 日志，并截图
// 用法: node tools/check-local.mjs [URL] [输出png] [等待ms] [要执行的JS]
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const TARGET = process.argv[2] || 'http://127.0.0.1:3456/tools/seed-map';
const OUT = process.argv[3] || 'crawl/shot.png';
const WAIT = Number(process.argv[4]) || 9000;
const JS = (() => {
  const raw = process.argv[5] || '';
  if (raw.startsWith('@')) {
    // 以 @ 开头表示从文件读取，避免命令行引号转义问题
    return readFileSync(raw.slice(1), 'utf8');
  }
  return raw;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${resolve('tools/.chrome-profile2')}`,
  '--window-size=1500,950',
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

const errors = [];
const warnings = [];
const logs = [];
const failedReqs = [];
const responses = [];
const allReqs = [];
const failedById = new Map();
const workerSessions = [];

try {
  const wsUrl = await waitForDevtools();
  const ws = new WebSocket(wsUrl);
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

  function sendTo(sid, method, params = {}) {
    return new Promise((res, reject) => {
      const id = ++msgId;
      const handler = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) {
          ws.removeEventListener('message', handler);
          m.error ? reject(new Error(JSON.stringify(m.error))) : res(m.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
    });
  }

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const p = msg.params;
    const fromWorker = !!msg.sessionId;
    const tag = fromWorker ? '[worker] ' : '';
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      const where = d.url ? ` @ ${d.url}:${d.lineNumber}:${d.columnNumber}` : '';
      errors.push(tag + 'EXCEPTION: ' + (d.exception?.description || d.text) + where);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (p.type === 'error') errors.push(tag + 'CONSOLE: ' + text);
      else if (p.type === 'warning') warnings.push(tag + text);
      else if (fromWorker && p.type === 'log') logs.push(text);
    } else if (msg.method === 'Network.requestWillBeSent') {
      if (p.request?.url && !p.request.url.startsWith('data:')) allReqs.push({ url: p.request.url, fromWorker });
    } else if (msg.method === 'Network.loadingFailed') {
      failedReqs.push(p.errorText + ' (' + p.type + ') ' + (p.requestId ? '' : ''));
      if (p.requestId) failedById.set(p.requestId, p.errorText);
    } else if (msg.method === 'Network.responseReceived') {
      if (p.response.status >= 400) responses.push(p.response.status + ' ' + p.response.url);
    } else if (msg.method === 'Target.attachedToTarget') {
      const childSession = p.sessionId;
      const t = p.targetInfo?.type;
      if (t === 'worker' || t === 'shared_worker' || t === 'service_worker') workerSessions.push(childSession);
      sendTo(childSession, 'Runtime.enable').catch(() => {});
      sendTo(childSession, 'Runtime.runIfWaitingForDebugger').catch(() => {});
    }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));

  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Page.navigate', { url: TARGET });

  await sleep(WAIT);

  if (JS) {
    const r = await send('Runtime.evaluate', { expression: JS, awaitPromise: true, returnByValue: true })
      .catch((e) => ({ result: { value: 'EVAL ERR ' + e.message } }));
    console.log('交互:', String(JSON.stringify(r.result?.value) ?? '').slice(0, 300));
    await sleep(6000);
  }

  const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  const canvases = await send('Runtime.evaluate', {
    expression: 'Array.from(document.querySelectorAll("canvas")).map(c=>c.width+"x"+c.height).join(",")',
    returnByValue: true,
  });

  console.log('标题:', title.result.value);
  console.log('canvas:', canvases.result.value || '(无)');

  console.log('\nHTTP >=400:', responses.length);
  for (const r of responses.slice(0, 30)) console.log('  ', r);

  const wasmReqs = allReqs.filter((r) => /\/wasm\//.test(r.url));
  console.log('\n/wasm/ 请求:', wasmReqs.length);
  for (const r of wasmReqs.slice(0, 20)) console.log('  ', (r.fromWorker ? '[worker] ' : '[page]   ') + r.url);

  // 在 worker 里诊断 glue 加载
  if (workerSessions.length) {
    const probe = `(async () => {
      try {
        const r = self.location.origin;
        const res = await fetch(r + '/wasm/cubiomes.js?v=20261028-e3e-quart');
        const txt = await res.text();
        const f = Function(txt + '; return CubiomesModule;')();
        const kind = typeof f;
        let extra = '';
        try {
          const m = await Promise.race([
            f({ locateFile: (e) => e.endsWith('.wasm') ? (r + '/wasm/' + e + '?v=20261028-e3e-quart') : e }),
            new Promise((_, j) => setTimeout(() => j(new Error('timeout5s')), 5000)),
          ]);
          extra = ' | module=' + (m && typeof m) + ' ccall=' + (m && typeof m.ccall);
        } catch (e) { extra = ' | instantiate ERR ' + e.message; }
        return 'origin=' + r + ' status=' + res.status + ' len=' + txt.length + ' factory=' + kind + extra;
      } catch (e) { return 'ERR ' + e.message; }
    })()`;
    for (const sid of workerSessions.slice(0, 2)) {
      const out = await sendTo(sid, 'Runtime.evaluate', { expression: probe, awaitPromise: true, returnByValue: true })
        .catch((e) => ({ result: { value: 'EVAL ERR ' + e.message } }));
      console.log('\n[worker 诊断]', String(out.result?.value).slice(0, 400));
    }
  }

  console.log('\n失败请求:', failedReqs.length);
  for (const f of [...new Set(failedReqs)].slice(0, 20)) console.log('  ', f);

  console.log('\n错误:', errors.length);
  for (const e of errors.slice(0, 20)) console.log('  ', e.slice(0, 300));

  console.log('\nworker 日志:', logs.length);
  const key = logs.filter((x) => /successfully|Preparing seed|Seed prepared|failed|Failed|error|Error|skip|fallback/i.test(x));
  console.log('  关键日志 ' + key.length + ' 条:');
  for (const l of key.slice(0, 20)) console.log('  ', String(l).slice(0, 320));

  console.log('\n警告:', warnings.length);
  for (const w of warnings.slice(0, 8)) console.log('  ', String(w).slice(0, 200));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('\n截图:', OUT);
} finally {
  chrome.kill();
}
