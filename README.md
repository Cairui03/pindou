# 拼豆豆图生成器

把任意图片转换成拼豆图纸（像素图），适配 32×32 / 52×52 / 78×78 / 104×104 等主流智能拼豆板。

**在线使用：** <https://cairui03.github.io/pindou/>

在 iPhone / iPad 上用 Safari 打开上面的网址，点「分享 → 添加到主屏幕」，就会像 App 一样全屏运行。所有图片都在你自己的设备上处理，不会上传到任何服务器。

## v15：修复严重色差与噪点

v14 生成的豆图会出现「严重色差」和「噪点/脏点」。逐项定位后确认这是算法问题，不是渲染问题：

| 根因 | v14 的做法 | v15 的修复 |
|---|---|---|
| 采样偏色 | 在 sRGB（gamma 编码）空间直接求平均，缩小倍数越大越暗、越灰 | 转线性光后按像素覆盖面积做精确积分，再转回 sRGB |
| 匹配偏色 | CIE76 Lab 欧氏距离，每格独立对 424 色取最近 | **Oklab 粗筛 → CIEDE2000 精排**（色相、肤色更准） |
| 后处理色差 | `mergeHueOutliers` 会把 ΔE≤26、明度差≤8、用量少的颜色强行并进主色，是蓝/青色块和肤色发黄的主因 | 删除该步骤，改为只对平坦区做「数据项 + 邻域」约束的保边平滑 |
| 噪点 | 每格按 35% 阈值取「主色」（众数）+ unsharp 0.9，纹理区随机跳色 | 默认用真实平均色；锐化默认关闭；新增可选「线条增强」 |
| 抖动噪点 | 硬截断 Floyd–Steinberg | 蛇形扫描 + 误差阻尼 + 按比例钳制；默认仍然关闭 |
| 色卡不够用 | 通用 424 色是按 HSL 公式合成的颜色，不是真实豆色 | 改用 MIT 许可的真实豆色数据（maxcleme/beadcolors）聚类出 424/96/48/24 色 |

同一批测试图（52×52、与「线性光精确面积平均」真值比较）：

| 测试图 | v14 平均色差 ΔE00 | v15 平均色差 ΔE00 | v14 重色差格子(>10ΔE) | v15 重色差格子 |
|---|---|---|---|---|
| 人像 | 9.10 | **5.17** | 28.1% | **0.3%** |
| 风景 | 7.11 | **4.41** | 21.0% | **0.4%** |
| 花卉 | 8.85 | **4.13** | 29.0% | **1.8%** |
| 静物 | 6.75 | **4.83** | 19.0% | **1.5%** |

同时把转换耗时从旧版 104×104 的约 1.9 秒降到约 0.3 秒（同一台机器、Node 环境）。

### 算法参考（按 star 数）

- [Zippland/perler-beads](https://github.com/Zippland/perler-beads)（1048★）：Oklab 颜色距离
- [lokesh/color-thief](https://github.com/lokesh/color-thief)（13663★）：MMCQ / Oklch 量化思路
- [ImageOptim/libimagequant](https://github.com/ImageOptim/libimagequant)（938★）：误差扩散的阻尼、门控与量化前降噪
- [LunarXuan/Pindo](https://github.com/LunarXuan/Pindo)（455★）：线性光降采样、CIEDE2000 匹配、本地优先架构
- [zwhy149/bead-grid-studio](https://github.com/zwhy149/bead-grid-studio)（204★）：纯函数量化、Oklab 粗筛 + CIEDE2000 精排
- [Jett-Wu/Perler_Beads_Generator](https://github.com/Jett-Wu/Perler_Beads_Generator)（58★）：去孤立点小区域清理
- [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)（MIT）：真实豆色数据

## 功能

- 图片转豆图，支持裁切 / 留白 / 拉伸三种铺法，长图可平移缩放选段
- 板子尺寸：32 / 52 / 78 / 104 一键切换，另有 16～300 的自定义宽×高
- 色卡：通用 424 / 96 / 48 / 24 色（真实豆色），大嘴巴 221 色现货色号，也可导入自己的色卡
- 亮度 / 对比度 / 饱和度微调，浅色背景可一键变空豆
- 颜色精简：最多 96 / 48 / 24 色，方便控制买豆数量
- 线条增强：卡通粗描边、黑白线稿 / logo 可选，照片默认关闭
- 画笔 / 橡皮擦直接在预览图上修改，支持撤销
- 导出：精确像素图 PNG（1 像素 = 1 颗豆）、带网格坐标的高清图纸 PNG、色号表 CSV、工程文件 JSON、用豆清单 CSV
- 自动统计每种颜色要几颗豆

## 开发

保留零依赖 JavaScript：浏览器端是单个 `index.html`（可离线双击打开），算法核心与 UI 分离，便于测试。

```bash
node build.mjs                  # src/ → index.html
node --test test/core.test.mjs  # 单元测试（颜色数学 / 采样 / 匹配 / 导出）
node tools/build-palettes.mjs   # data/beadcolors/*.csv → src/palettes.js
node server.js                  # 局域网服务，方便平板访问（可选）
```

目录：

- `src/core.js`：纯算法（采样、Oklab/CIEDE2000、抖动、保边去斑、导出格式），无 DOM 依赖
- `src/app.js`：UI 与交互
- `src/palettes.js`：构建生成的真实豆色色卡
- `src/index.template.html`：页面模板
- `data/beadcolors/`：MIT 许可的原始豆色数据
- `test/`：Node 单元测试

## 部署

GitHub Pages：仓库 `Cairui03/pindou` 的 `main` 分支根目录，构建后访问 <https://cairui03.github.io/pindou/>。

## 许可与致谢

代码为本项目所有。豆色数据来自 [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)（MIT License）；算法参考了上面列出的开源项目，详见 [ATTRIBUTION.md](ATTRIBUTION.md)。
