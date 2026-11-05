// 指纹 find_structures_in_area：调用后找出结果指针与计数函数
import { readFileSync } from 'node:fs';

const buf = readFileSync(new URL('../mirror/wasm/cubiomes.wasm', import.meta.url));
const mod = new WebAssembly.Module(buf);
const io = { a: {} };
for (const imp of WebAssembly.Module.imports(mod)) {
  io[imp.module] ??= {};
  io[imp.module][imp.name] = () => 0;
}
const ex = new WebAssembly.Instance(mod, io).exports;
ex.z(28, 0);
ex.A(3524112526139516812n, 0);

const zero = ['n','o','q','v','E','F','M','Q','U','V','W','X','Y','Z','_','ba','ja','ka','la','ma','sa','ta','ua','va','za'];

// find_structures_in_area(type, x0, z0, x1, z1, maxCount, checkTerrain)
const TYPES = { village: 5, desert_pyramid: 1, ocean_monument: 8, ancient_city: 13, mineshaft: 15 };

for (const [name, type] of Object.entries(TYPES)) {
  const c = ex.D(type, -2000, -2000, 2000, 2000, 40, 0);
  console.log(`\n${name}(type=${type}) 在 4000×4000 内 find_structures_in_area = ${c}`);
  if (typeof c !== 'number' || c <= 0) continue;

  for (const fn of zero) {
    let p; try { p = ex[fn](); } catch { continue; }
    if (typeof p !== 'number' || p <= 0 || p + 16 > ex.h.buffer.byteLength || p % 4) continue;
    const pair = Array.from(new Int32Array(ex.h.buffer, p, 4));
    if (Math.abs(pair[0]) <= 30000000 && Math.abs(pair[1]) <= 30000000 &&
        (pair[0] !== 0 || pair[1] !== 0) && Math.abs(pair[0]) > 100) {
      console.log(`   候选 ${fn}() = 0x${p.toString(16)}  前 4 个 int: [${pair.join(', ')}]`);
    }
  }

  // 计数候选：值等于 c
  for (const fn of zero) {
    let v; try { v = ex[fn](); } catch { continue; }
    if (v === c) console.log(`   计数候选：${fn}() = ${v}  (= 结果数)`);
  }
}
