# 第三方数据与算法参考

## 豆色数据

- 来源：[maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)
- 许可证：MIT License
- 使用方式：`data/beadcolors/*.csv` 为其 `gen/v3/` 目录下的原始数据；`src/palettes.js` 由 `tools/build-palettes.mjs` 在 Oklab 空间中聚类到 424/96/48/24 色生成。
- 数据为社区采集的豆色，非品牌官方色值。

## 算法参考

本项目为独立实现，没有复制下列项目的源码；在算法选择与参数上参考了它们的公开实现与文档：

| 项目 | 许可证 | 参考内容 |
|---|---|---|
| [Zippland/perler-beads](https://github.com/Zippland/perler-beads) | 见仓库 | Oklab 颜色距离 |
| [LunarXuan/Pindo](https://github.com/LunarXuan/Pindo) | GPL-3.0 | 线性光面积降采样、CIEDE2000 匹配流程 |
| [zwhy149/bead-grid-studio](https://github.com/zwhy149/bead-grid-studio) | Apache-2.0 | 纯函数量化架构、Oklab 粗筛 + CIEDE2000 精排 |
| [ImageOptim/libimagequant](https://github.com/ImageOptim/libimagequant) | 见仓库 | 误差扩散阻尼、量化前降噪、抖动门控思路 |
| [Jett-Wu/Perler_Beads_Generator](https://github.com/Jett-Wu/Perler_Beads_Generator) | 见仓库 | 孤立小区域清理思路 |
| [lokesh/color-thief](https://github.com/lokesh/color-thief) | MIT | 调色板量化思路 |
| [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors) | MIT | 豆色数据 |

## 颜色数学

CIEDE2000 公式与 Oklab 变换使用公开的标准公式（Sharma 等；Björn Ottosson），项目中为独立实现。
