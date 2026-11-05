// 解析 wasm 的类型/函数/导出节，输出每个导出函数的参数签名
import { readFileSync } from 'node:fs';

const buf = readFileSync(new URL('../mirror/wasm/cubiomes.wasm', import.meta.url));
let p = 8; // 跳过 magic + version

function u32() {
  let r = 0, s = 0, b;
  do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
  return r >>> 0;
}
function i32s() {
  let r = 0, s = 0, b;
  do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
  if (s < 32 && (b & 0x40)) r |= (~0 << s);
  return r;
}

const types = [];      // [{params:[], results:[]}]
const funcTypes = [];  // func idx -> type idx
const exports = [];

const VAL = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64' };

while (p < buf.length) {
  const id = buf[p++];
  const size = u32();
  const end = p + size;
  if (id === 1) {
    const n = u32();
    for (let i = 0; i < n; i++) {
      const form = buf[p++];
      if (form !== 0x60) throw new Error('unexpected functype ' + form);
      const np = u32(); const params = [];
      for (let j = 0; j < np; j++) params.push(VAL[buf[p++]] ?? '?');
      const nr = u32(); const results = [];
      for (let j = 0; j < nr; j++) results.push(VAL[buf[p++]] ?? '?');
      types.push({ params, results });
    }
  } else if (id === 3) {
    const n = u32();
    for (let i = 0; i < n; i++) funcTypes.push(u32());
  } else if (id === 7) {
    const n = u32();
    for (let i = 0; i < n; i++) {
      const len = u32();
      const name = buf.toString('utf8', p, p + len); p += len;
      const kind = buf[p++]; const idx = u32();
      exports.push({ name, kind, idx });
    }
  }
  p = end;
}

const importedFuncs = exports.length ? 0 : 0; // 见下方：函数索引含导入
const impCount = 7; // 已知 7 个导入函数

const rows = exports
  .filter((e) => e.kind === 0x00)
  .map((e) => {
    const ti = funcTypes[e.idx - impCount];
    const t = types[ti] ?? { params: [], results: [] };
    return { name: e.name, params: t.params, results: t.results };
  });

const groups = new Map();
for (const r of rows) {
  const key = `${r.params.length}参 -> ${r.results.join(',')}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r.name);
}
console.log('导出函数总签名分组：');
for (const [k, v] of [...groups].sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  console.log(`  ${k}  (${v.length})  ${v.join(' ')}`);
}
console.log('\n明细：');
for (const r of rows) console.log(`  ${r.name}(${r.params.join(', ')}) -> ${r.results.join(',') || 'void'}`);
