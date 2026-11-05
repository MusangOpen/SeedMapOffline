// 解析 cubiomes.wasm 的导出表 / 导入表，用于确认核心算法接口
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const buf = readFileSync(new URL('../mirror/wasm/cubiomes.wasm', import.meta.url));
const mod = new WebAssembly.Module(buf);

const exports = WebAssembly.Module.exports(mod);
const imports = WebAssembly.Module.imports(mod);

const byKind = (list, kind) => list.filter((x) => x.kind === kind);

console.log('=== 导出函数 (%d) ===', byKind(exports, 'function').length);
for (const e of byKind(exports, 'function')) console.log('  ' + e.name);
console.log('\n=== 导出其它 ===');
for (const e of exports.filter((x) => x.kind !== 'function')) console.log(`  [${e.kind}] ${e.name}`);
console.log('\n=== 导入 (%d) ===', imports.length);
for (const i of imports) console.log(`  ${i.module}.${i.name} (${i.kind})`);
console.log('\nsha256:', createHash('sha256').update(buf).digest('hex'));
