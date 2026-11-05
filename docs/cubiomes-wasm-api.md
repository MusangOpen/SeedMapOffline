# cubiomes.wasm 逆向与接口说明

对 `https://minecraftsearch.com/tools/seed-map` 的核心算法提取记录。站点前端是 Next.js（Turbopack）构建的 SPA，
真正的地形生成本质上是把开源 C 库 **[cubiomes](https://github.com/Cubitect/cubiomes)** 编译成 WebAssembly
后在 Web Worker 里跑。这里记录该 wasm 的获取方式、导出符号映射与调用协议。

## 1. 引擎文件

| 项 | 值 |
| --- | --- |
| 请求地址 | `https://minecraftsearch.com/wasm/cubiomes.wasm?v=<build>` |
| 必须的头 | `Referer: https://minecraftsearch.com/tools/seed-map`（缺失返回 403） |
| 大小 | 702,001 字节 |
| SHA-256 | `8b78974d45a5afebed0a87e1c1b5103d2299fe3320b2748b1c08447a5b298cb9` |
| 导入 | 7 个函数（`a.a` … `a.g`），**实例化过程中不会被调用**，全部 stub 成 `() => 0` 即可 |
| 导出 | 72 个函数 + 1 个 `memory`（名为 `h`），初始 32 MB |
| 二进制 | Emscripten 产物；导出名被压缩为单/双字母（`i…z`、`A…Z`、`_`、`$`、`aa…za`） |

因为导出名被压缩，站点自己的胶水层通过 `Module.ccall("init_generator", …)` 这类**字符串名**调用。
名字→字母的映射没有出现在任何可公开抓取的 chunk 里，所以下面这张表是通过**调用协议 + 行为指纹**反推出来的，
并已用实际地形结果验证。

## 2. 导出符号映射

### 2.1 生成主流程

| 导出 | 真实含义 | 签名 | 说明 |
| --- | --- | --- | --- |
| `z` | `init_generator` | `(mcVersion: i32, flags: i32) -> i32` | 返回 `1` 表示成功 |
| `A` | `apply_seed` | `(seed: i64, dimension: i32) -> i32` | 返回 `1` 表示成功 |
| `T` | `generate_biome_range` | `(scale, x, z, w, h) -> i32` | 地表 biome 网格，返回采样点数 |
| `R` | `generate_biome_range_at_y` | `(scale, x, z, y, w, h) -> i32` | 指定高度切片，返回采样点数 |
| `U` | `_get_biome_data_pointer` | `() -> i32` | 结果在 `HEAP32` 中的**字节偏移** |
| `V` | `_get_biome_data_size` | `() -> i32` | 结果个数（＝ `w * h`） |
| `ba` | `_get_all_biome_colors` | `() -> i32` | 指向 768 字节 RGB 调色板（256 × 3） |
| `i` / `aa` | 无参 `void` | `() -> void` | 触发内置调色板初始化，调用后再取 `ba` |
| `$` | `get_biome_name` | `(id: i32) -> i32` | 返回 C 字符串指针，如 `"cherry_grove"` |

### 2.2 结构查找

| 导出 | 真实含义 | 签名 |
| --- | --- | --- |
| `D` | `find_structures_in_area` | `(type, x0, z0, x1, z1, maxCount, checkTerrain) -> i32` |
| `E` | `_get_structure_results_pointer` | `() -> i32` |
| `F` | `_get_structure_results_count` | `() -> i32` |

结果是一段 `int32` 数组，**每两项一组** `(x, z)`，单位是**方块坐标**（不是区块、不是 quart）。

⚠️ `U` 与 `E` 指向**同一块复用缓冲区**（实测都是 `0xcd508`）。所以必须先取完 biome 数据（或先渲染完），
再调 `find_structures_in_area`，否则会互相覆盖。

## 3. 调用协议

```js
init_generator(mcVersion, 0)        // 必须 === 1
apply_seed(seedBigInt, dimension)   // 必须 === 1

// 地表 biome（推荐，比 at_y 快）
n = generate_biome_range(4, x0, z0, w, h)
ptr = _get_biome_data_pointer()
size = _get_biome_data_size()
biomes = new Int32Array(memory.buffer, ptr, size)

// 指定高度
n = generate_biome_range_at_y(4, x0, 63, z0, w, h)   // 注意 y 在 w/h 之前
```

### 坐标单位

所有 `x` / `z` 参数是 **quart 坐标**（方块坐标 `>> 2`），一格 = 4 方块。`scale` 参数站点固定传 `4`。
`w` / `h` 是要采样的格数。

```js
const quartX = blockX >> 2;
const blockX = quartX * 4;
```

### 维度

| 值 | 维度 |
| --- | --- |
| `0` | 主世界 |
| `-1` | 下界 |
| `1` | 末地 |

## 4. 版本编号

`init_generator` 的 `mcVersion` 不是 MC 版本字符串，而是站点内部编号。取自站点自己的映射表：

| MC 版本 | mcVersion | MC 版本 | mcVersion |
| --- | --- | --- | --- |
| 26.4 | 31 | 1.21.1 | 26 |
| 26.3 | 30 | 1.20 | 25 |
| 26.2 / 26.1.2 / 26.1 | 29 | 1.19.4 | 24 |
| 1.21.9 / 1.21.6 / 1.21.5 | 29 | 1.19.2 | 23 |
| 1.21.4 | 28 | 1.18 | 22 |
| 1.21.3 | 27 | 1.17 | 21 |

更早版本依次递减（1.16→20、1.15→18、1.14→17、1.13→16、1.12→15 … 1.0→3）。
实测 `init_generator` 对 0–32 全部返回 1（内部会 clamp），所以传错不会报错，只会得到别的版本地形。

## 5. 结构类型编号

`find_structures_in_area` 的 `type` 取自站点结构表里的 `cubiomesType`：

| 编号 | 结构 | 编号 | 结构 |
| --- | --- | --- | --- |
| 1 | 沙漠神殿 | 15 | 废弃矿井 |
| 2 | 丛林神庙 | 16 | 沙漠水井 |
| 3 | 沼泽小屋 | 17 | 紫水晶晶洞 |
| 5 | 村庄 | 18 | 下界要塞 |
| 6 | 海底废墟 | 20 | 末地城 |
| 7 | 沉船 | 21 | 末地折跃门 |
| 8 | 海底神殿 | 23 | 古迹废墟 |
| 9 | 林地府邸 | 24 | 试炼密室 |
| 10 | 掠夺者前哨 | 25 | 废弃营地 |
| 11 | 废弃传送门 | 191–194 | 堡垒遗迹（马厩/住宅/桥/宝库） |
| 12 | 废弃传送门（下界） | 201–203 | 地牢（僵尸/骷髅/蜘蛛） |
| 13 | 远古城市 | 212–215 | 峡谷 / 水下峡谷 |
| 14 | 埋藏的宝藏 | 216–217 | 铁 / 铜矿脉 |
| 219 / 220 | 雪屋（无 / 有地下室） | 221–223 | 化石 / 钻石化石 / 硫磺泉 |

`checkTerrain = 0` 只做位置计算；传 `1` 会额外做地形/生物群系校验（更慢，但能过滤掉不合法位置）。

## 6. 复现提取过程

```bash
# 1. 取 wasm（必须有 Referer，否则 403）
curl -H "Referer: https://minecraftsearch.com/tools/seed-map" \
     -o cubiomes.wasm https://minecraftsearch.com/wasm/cubiomes.wasm

# 2. 看导出签名，按参数个数分组
node tools/wasm-sigs.mjs

# 3. 指纹识别：init/seed/biome 三件套
node tools/map-api.mjs

# 4. 指纹识别：结构查找
node tools/find-structures.mjs

# 5. 导出全部 biome 名称
node tools/dump-biome-names.mjs
```

## 7. 已知未解部分

- 其余约 50 个导出（`j`、`p`、`m`、`x` …）未逐个确认用途，推测包含 `malloc`/`free`、地表高度
  `_getSurfaceHeightAt`、结构中心 `get_structure_center` 等，给本地地图用不到。
- 站点还有若干独立的小 wasm（`bedrockFinder.wasm`、`dungeonFinder.wasm` 等，Rust + wasm-bindgen 生成），
  分别负责矿洞扫描、地牢查找，本仓库未包含。
- 站点服务器端是否参与种子求解未验证；本仓库的全部功能都由本地 wasm 完成。
