// 依据调用协议指纹化：init_generator -> apply_seed -> generate_biome_range_at_y -> 数据指针
import { readFileSync } from 'node:fs';

const buf = readFileSync(new URL('../mirror/wasm/cubiomes.wasm', import.meta.url));
const mod = new WebAssembly.Module(buf);

function freshInstance() {
  const importObject = { a: {} };
  for (const imp of WebAssembly.Module.imports(mod)) {
    importObject[imp.module] ??= {};
    importObject[imp.module][imp.name] = () => 0;
  }
  return new WebAssembly.Instance(mod, importObject).exports;
}

// 签名表（来自 wasm-sigs.mjs 的输出）
const twoArgI32 = ['y','z','A','B','I','J','K','L','N','ca','da','ra'];
const sixArgI32 = ['R','S','na'];
const zeroArgI32 = ['n','o','q','v','E','F','M','Q','U','V','W','X','Y','Z','_','ba','ja','ka','la','ma','sa','ta','ua','va','za'];

const VERSIONS = [28, 22, 4, 26, 21];
console.log('=== 寻找 init_generator（2参->i32，期望返回 1）===');
const initHits = [];
for (const fn of twoArgI32) {
  for (const ver of VERSIONS) {
    const ex = freshInstance();
    try {
      const r = ex[fn](ver, 0);
      if (r === 1) { console.log(`  ${fn}(${ver}, 0) = 1`); initHits.push({ fn, ver }); break; }
    } catch { /* ignore */ }
  }
}

if (initHits.length === 0) {
  console.log('  未命中，打印原始返回值：');
  for (const fn of twoArgI32) {
    const ex = freshInstance();
    let r; try { r = ex[fn](28, 0); } catch (e) { r = 'THROW'; }
    console.log(`    ${fn}(28,0) = ${r}`);
  }
  process.exit(0);
}

const initFn = initHits[0].fn;
const initVer = initHits[0].ver;
const SEED = 3524112526139516812n;

console.log(`\n=== 用 ${initFn}(${initVer},0) + A(seed,0) 激活生成器 ===`);
const ex = freshInstance();
console.log('  init =', ex[initFn](initVer, 0));
console.log('  applySeed A =', ex.A(SEED, 0));

console.log('\n=== 6 参候选：generate_biome_range_at_y(4, x, y, z, 1, 1) ===');
for (const fn of sixArgI32) {
  let r; try { r = ex[fn](4, 0, 63, 0, 1, 1); } catch (e) { r = 'THROW:' + e.message.slice(0, 40); }
  console.log(`  ${fn} = ${r}`);
}

console.log('\n=== 0 参候选（找数据指针/大小）===');
const vals = {};
for (const fn of zeroArgI32) {
  let r; try { r = ex[fn](); } catch { continue; }
  vals[fn] = r;
  if (typeof r === 'number' && r > 4096 && r < ex.h.buffer.byteLength) {
    const i32 = new Int32Array(ex.h.buffer);
    console.log(`  ${fn}() = 0x${r.toString(16)}  ints=[${Array.from(i32.slice(r >> 2, (r >> 2) + 4)).join(',')}]`);
  } else {
    console.log(`  ${fn}() = ${r}`);
  }
}
