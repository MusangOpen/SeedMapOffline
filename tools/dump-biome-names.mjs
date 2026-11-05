// 从 cubiomes.wasm 导出 biome id → 官方名称（$ = get_biome_name）
import { readFileSync, writeFileSync } from 'node:fs';

const buf = readFileSync(new URL('../mirror/wasm/cubiomes.wasm', import.meta.url));
const mod = new WebAssembly.Module(buf);
const io = { a: {} };
for (const imp of WebAssembly.Module.imports(mod)) {
  io[imp.module] ??= {};
  io[imp.module][imp.name] = () => 0;
}
const ex = new WebAssembly.Instance(mod, io).exports;
ex.i();
ex.aa();

function readStr(p) {
  if (p <= 0 || p >= ex.h.buffer.byteLength) return '';
  const u8 = new Uint8Array(ex.h.buffer, p, 80);
  let s = '';
  for (const ch of u8) { if (ch === 0) break; s += String.fromCharCode(ch); }
  return s;
}

const names = {};
for (let id = 0; id < 256; id++) {
  let s = '';
  try { s = readStr(ex['$'](id)); } catch { /* 越界 */ }
  if (s && /^[a-z_0-9]{2,50}$/.test(s)) names[id] = s;
}

const ids = Object.keys(names).map(Number).sort((a, b) => a - b);
console.log('biome 数量:', ids.length);
for (const id of ids) console.log(String(id).padStart(3), names[id]);
writeFileSync(new URL('../out-biome-names.json', import.meta.url), JSON.stringify(names, null, 2));
