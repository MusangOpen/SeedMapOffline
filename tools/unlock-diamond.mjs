// 解除钻石查找的 Supporter 门禁（本地镜像专用）
// 用法: node tools/unlock-diamond.mjs [--restore]
//   --restore  从 .orig 备份还原，撤销全部补丁
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve('mirror/_next/static/chunks/0tq-rl8a74ptl.js');
const BAK = FILE + '.orig';

if (process.argv.includes('--restore')) {
  if (!existsSync(BAK)) { console.log('没有备份可还原'); process.exit(1); }
  copyFileSync(BAK, FILE);
  console.log('已还原本地文件 ->', FILE);
  process.exit(0);
}

// 1) 关键：把"锁定矿石"集合清空，chip 就不会走 onLockedOre
// 2) 选中 diamond 时不要再清空已选集合并 return
// 3) 不要再把 diamond 从已选集合里删除
// 4) 点击 diamond 当场不再弹升级框（此时集合尚未更新）
const PATCHES = [
  {
    name: '锁定矿石集合不再包含 diamond',
    from: 'ak=(0,l.useMemo)(()=>ia?new Set(["diamond"]):void 0,[ia])',
    to: 'ak=(0,l.useMemo)(()=>void 0,[ia])',
  },
  {
    name: '选中 diamond 时不再清空集合并 return',
    from: 'if("diamond"===ey&&ia){if(ir(new Set),ew.autoOpenDiamondUpsell){',
    to: 'if(!1){if(ir(new Set),ew.autoOpenDiamondUpsell){',
  },
  {
    name: '不再把 diamond 从已选集合里删除',
    from: 'ia&&it.has("diamond")&&(ir(e=>{if(!e.has("diamond"))return e;let t=new Set(e);return t.delete("diamond"),t}),1===it.size&&is(!1))',
    to: '!1',
  },
  {
    name: '点击 diamond 不再弹升级框',
    from: 'if("diamond"===e&&ia&&!it.has("diamond"))return void i_("diamond","restore");',
    to: 'if(!1)return void i_("diamond","restore");',
  },
];

if (!existsSync(BAK)) {
  copyFileSync(FILE, BAK);
  console.log('已备份原始文件 ->', BAK);
}

let src = readFileSync(BAK, 'utf8');   // 始终从原始版本重新打补丁，保证幂等
console.log('以原始备份为基础应用补丁\n');

let applied = 0;
for (const p of PATCHES) {
  const hits = src.split(p.from).length - 1;
  if (hits === 1) {
    src = src.replace(p.from, p.to);
    applied++;
    console.log(`  OK   ${p.name}`);
  } else if (hits === 0) {
    console.log(`  跳过 ${p.name}（原文未找到）`);
  } else {
    console.log(`  警告 ${p.name}：命中 ${hits} 次，跳过以免误改`);
  }
}

writeFileSync(FILE, src);
console.log(`\n已应用 ${applied}/${PATCHES.length} 处，文件 ${src.length} 字节`);
