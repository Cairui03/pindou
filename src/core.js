/* =====================================================================
   拼豆豆图生成器 · 核心算法 v15（纯函数，无 DOM 依赖）
   ---------------------------------------------------------------------
   算法参考（GitHub 高星项目）：
   - Zippland/perler-beads (1048★)：Oklab 颜色距离
   - LunarXuan/Pindo (455★)     ：线性光面积降采样、CIEDE2000 精排
   - zwhy149/bead-grid-studio (204★)：Oklab 粗筛 + CIEDE2000 复排、纯函数架构
   - ImageOptim/libimagequant (938★)：误差扩散的阻尼/门控、量化前降噪思路
   - maxcleme/beadcolors (MIT)  ：通用色卡的真实豆色数据
   ---------------------------------------------------------------------
   修复要点：
   1. 采样：sRGB 均值 → 线性光精确面积平均（消除缩小时的压暗/偏色）
   2. 匹配：CIE76 Lab 欧氏 → Oklab 粗筛 + CIEDE2000 精排（色相/肤色更准）
   3. 去噪：删除 3×3 色度中值、删掉「色相离群合并」(ΔE≤26) 等过激后处理，
      改为只对平坦区做受数据项约束的邻域平滑（保边）
   4. 抖动：默认关闭；开启时用蛇形扫描 + 误差阻尼，避免方向性噪点
   5. 调色板：真实豆色（MIT 数据）替代数学合成色
   ===================================================================== */
var PindouCore = (function () {
  "use strict";

  /* ---------------- 基础颜色数学 ---------------- */
  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

  function hexToRgb(hex) {
    var h = String(hex || "").trim().replace(/^#/, "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) {
    return "#" + [clamp255(Math.round(r)), clamp255(Math.round(g)), clamp255(Math.round(b))]
      .map(function (v) { return v.toString(16).padStart(2, "0"); }).join("").toUpperCase();
  }
  function srgbToLinear(v) {
    var c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(v) {
    var s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return clamp255(s * 255);
  }
  function srgbLuma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  /* sRGB -> Oklab（Ottosson），用于快速、感知均匀的粗筛 */
  function rgbToOklab(r, g, b) {
    var rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
    var l = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
    var m = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
    var s = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }
  function oklabToRgb(L, a, b) {
    var l = L + 0.3963377774 * a + 0.2158037573 * b;
    var m = L - 0.1055613458 * a - 0.0638541728 * b;
    var s = L - 0.0894841775 * a - 1.2914855480 * b;
    var l3 = l * l * l, m3 = m * m * m, s3 = s * s * s;
    var r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    var g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    var bb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
    return [linearToSrgb(Math.max(0, Math.min(1, r))),
            linearToSrgb(Math.max(0, Math.min(1, g))),
            linearToSrgb(Math.max(0, Math.min(1, bb)))];
  }
  function oklabDistance(a, b) {
    var dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  /* sRGB -> CIE Lab (D65) */
  function rgbToLab(r, g, b) {
    var rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
    var X = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
    var Y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750);
    var Z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    var fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /* CIEDE2000 色差（kL=kC=kH=1）。色相比 CIE76 更接近人眼。 */
  function deltaE2000(lab1, lab2) {
    var L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
    var L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];
    var rad = Math.PI / 180, deg = 180 / Math.PI;
    var c1 = Math.sqrt(a1 * a1 + b1 * b1), c2 = Math.sqrt(a2 * a2 + b2 * b2);
    var cb = (c1 + c2) / 2, cb7 = Math.pow(cb, 7);
    var G = 0.5 * (1 - Math.sqrt(cb7 / (cb7 + Math.pow(25, 7))));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var c1p = Math.sqrt(a1p * a1p + b1 * b1), c2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = Math.atan2(b1, a1p) * deg; if (h1p < 0) h1p += 360;
    var h2p = Math.atan2(b2, a2p) * deg; if (h2p < 0) h2p += 360;
    var dLp = L2 - L1, dCp = c2p - c1p, dhp = 0;
    if (c1p * c2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
    }
    var dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(dhp * rad / 2);
    var lBar = (L1 + L2) / 2, cBarp = (c1p + c2p) / 2, hBar = h1p + h2p;
    if (c1p * c2p !== 0) {
      hBar = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2
        : (h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2);
    }
    var t = 1 - 0.17 * Math.cos((hBar - 30) * rad) + 0.24 * Math.cos(2 * hBar * rad)
      + 0.32 * Math.cos((3 * hBar + 6) * rad) - 0.20 * Math.cos((4 * hBar - 63) * rad);
    var dTheta = 30 * Math.exp(-Math.pow((hBar - 275) / 25, 2));
    var cb7p = Math.pow(cBarp, 7), rc = 2 * Math.sqrt(cb7p / (cb7p + Math.pow(25, 7)));
    var sl = 1 + 0.015 * Math.pow(lBar - 50, 2) / Math.sqrt(20 + Math.pow(lBar - 50, 2));
    var sc = 1 + 0.045 * cBarp, sh = 1 + 0.015 * cBarp * t;
    var rt = -Math.sin(2 * dTheta * rad) * rc;
    var dl = dLp / sl, dc = dCp / sc, dh = dHp / sh;
    return Math.sqrt(Math.max(0, dl * dl + dc * dc + dh * dh + rt * dc * dh));
  }

  /* 画面调整：亮度 / 对比度 / 饱和度（在每格颜色上做） */
  function adjustColor(rgb, adj) {
    if (!adj) return rgb;
    var r = rgb[0], g = rgb[1], b = rgb[2], d, c, l, s;
    if (adj.bright) {
      d = adj.bright * 2.55;
      r += d; g += d; b += d;
    }
    if (adj.contrast) {
      var k = adj.contrast * 2.55;
      c = (259 * (k + 255)) / (255 * (259 - k));
      r = c * (r - 128) + 128; g = c * (g - 128) + 128; b = c * (b - 128) + 128;
    }
    if (adj.sat) {
      l = srgbLuma(r, g, b);
      s = 1 + adj.sat / 100;
      r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s;
    }
    return [clamp255(r), clamp255(g), clamp255(b)];
  }

  /* ---------------- 色卡 ---------------- */
  /* 接受 [[name, hex], ...] 或 [{name,hex,rgb}, ...]，返回带 lab/oklab 的对象数组 */
  function compilePalette(list) {
    if (!list) return [];
    if (list.__compiled) return list;
    var out = new Array(list.length);
    for (var i = 0; i < list.length; i++) {
      var item = list[i], name = null, hex = null, rgb = null;
      if (Object.prototype.toString.call(item) === "[object Array]") { name = item[0]; hex = item[1]; }
      else { name = item.name; hex = item.hex; rgb = item.rgb; }
      if (!rgb) rgb = hexToRgb(hex);
      if (!rgb) { out[i] = null; continue; }
      rgb = [clamp255(rgb[0]), clamp255(rgb[1]), clamp255(rgb[2])];
      out[i] = {
        name: String(name == null ? hex : name),
        hex: rgbToHex(rgb[0], rgb[1], rgb[2]),
        rgb: rgb,
        lab: rgbToLab(rgb[0], rgb[1], rgb[2]),
        oklab: rgbToOklab(rgb[0], rgb[1], rgb[2])
      };
    }
    Object.defineProperty(out, "__compiled", { value: true });
    return out;
  }

  function parsePaletteText(text) {
    var lines = String(text || "").split(/\r?\n/);
    var out = [];
    var isHex = function (s) { return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s); };
    var isNum = function (s) { return /^-?\d+(\.\d+)?$/.test(s); };
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.charAt(0) === "#" && !isHex(line)) continue;
      var name = null, rgb = null;
      var parts = line.split(/[,\uFF0C;\t]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length >= 1 && isHex(parts[0])) {
        rgb = hexToRgb(parts[0]);
        name = parts.length > 1 ? parts[1] : parts[0];
      } else if (parts.length >= 2 && isHex(parts[1])) {
        rgb = hexToRgb(parts[1]);
        name = parts[0];
      } else if (parts.length >= 4 && isNum(parts[1]) && isNum(parts[2]) && isNum(parts[3])) {
        rgb = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
        name = parts[0];
      } else if (parts.length >= 3 && isNum(parts[0]) && isNum(parts[1]) && isNum(parts[2])) {
        rgb = [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
        name = parts.length > 3 ? parts[3] : rgbToHex(rgb[0], rgb[1], rgb[2]);
      }
      if (!rgb) continue;
      if (rgb.some(function (v) { return v < 0 || v > 255; })) continue;
      out.push([name, rgbToHex(rgb[0], rgb[1], rgb[2])]);
    }
    if (!out.length) throw new Error("没认出任何颜色，请检查格式");
    return compilePalette(out);
  }

  /* ---------------- 采样：线性光、按面积精确积分 ---------------- */
  /*
   * 每个豆格在源图上覆盖一块矩形，按像素与矩形的重叠面积加权，
   * 先转线性光再求平均，最后转回 sRGB。这才是"正确的缩小"。
   * 同时用 6×6 子采样估计格内主色，供可选的线稿增强使用。
   */
  function sampleCells(imageData, iw, ih, cols, rows, opts) {
    opts = opts || {};
    var data = imageData.data || imageData;
    var fit = opts.fit || "cover";
    var zoom = opts.zoom || 1;
    var posX = typeof opts.posX === "number" ? opts.posX : 0.5;
    var posY = typeof opts.posY === "number" ? opts.posY : 0.5;

    var ox = 0, oy = 0, stepX, stepY, offX = 0, offY = 0;
    if (fit === "stretch") {
      stepX = iw / cols; stepY = ih / rows;
    } else if (fit === "contain") {
      var s0 = Math.min(cols / iw, rows / ih);
      stepX = stepY = 1 / s0;
      offX = (cols - iw * s0) / 2; offY = (rows - ih * s0) / 2;
    } else {
      var s = Math.max(cols / iw, rows / ih) * zoom;
      stepX = stepY = 1 / s;
      offX = (cols - iw * s) * posX; offY = (rows - ih * s) * posY;
    }
    if (fit === "stretch") { ox = 0; oy = 0; }
    else { ox = offX; oy = offY; }

    var mapX = fit === "stretch"
      ? function (t) { return t * stepX; }
      : function (t) { return (t - ox) * stepX; };
    var mapY = fit === "stretch"
      ? function (t) { return t * stepY; }
      : function (t) { return (t - oy) * stepY; };

    var SUB = 6, SUB2 = SUB * SUB;
    var colors = new Array(rows), edge = new Array(rows), coverage = new Array(rows);
    for (var y = 0; y < rows; y++) {
      var rowC = new Array(cols), rowE = new Array(cols), rowV = new Array(cols);
      for (var x = 0; x < cols; x++) {
        var sx0 = mapX(x), sx1 = mapX(x + 1);
        var sy0 = mapY(y), sy1 = mapY(y + 1);
        if (sx0 > sx1) { var tmp = sx0; sx0 = sx1; sx1 = tmp; }
        if (sy0 > sy1) { var tmp2 = sy0; sy0 = sy1; sy1 = tmp2; }
        var cx0 = Math.max(0, Math.min(iw, sx0)), cx1 = Math.max(0, Math.min(iw, sx1));
        var cy0 = Math.max(0, Math.min(ih, sy0)), cy1 = Math.max(0, Math.min(ih, sy1));
        var cellArea = Math.max(1e-9, (sx1 - sx0) * (sy1 - sy0));
        var R = 0, G = 0, B = 0, A = 0;
        if (cx1 > cx0 && cy1 > cy0) {
          var px0 = Math.floor(cx0), px1 = Math.min(iw - 1, Math.ceil(cx1) - 1);
          var py0 = Math.floor(cy0), py1 = Math.min(ih - 1, Math.ceil(cy1) - 1);
          for (var py = py0; py <= py1; py++) {
            var wy = Math.max(0, Math.min(cy1, py + 1) - Math.max(cy0, py));
            if (wy <= 0) continue;
            var base = py * iw;
            for (var px = px0; px <= px1; px++) {
              var wx = Math.max(0, Math.min(cx1, px + 1) - Math.max(cx0, px));
              if (wx <= 0) continue;
              var w = wx * wy, o = (base + px) * 4;
              var a = data[o + 3] / 255;
              var rr = data[o] * a + 255 * (1 - a);
              var gg = data[o + 1] * a + 255 * (1 - a);
              var bb = data[o + 2] * a + 255 * (1 - a);
              R += srgbToLinear(rr) * w;
              G += srgbToLinear(gg) * w;
              B += srgbToLinear(bb) * w;
              A += w;
            }
          }
        }
        /* 没盖到的部分按白底算（和旧版先在白画布上画图的行为一致） */
        var uncovered = Math.max(0, cellArea - A);
        var rgb = [
          Math.round(linearToSrgb((R + uncovered) / cellArea)),
          Math.round(linearToSrgb((G + uncovered) / cellArea)),
          Math.round(linearToSrgb((B + uncovered) / cellArea))
        ];
        rowC[x] = rgb;
        rowV[x] = A / cellArea;

        /* 子采样主色：只用于可选线稿增强，默认不参与输出 */
        var hist = {}, bestKey = -1, bestN = 0, minL = 255, maxL = 0;
        var darkN = 0, darkR = 0, darkG = 0, darkB = 0, lumSum = 0;
        for (var sy = 0; sy < SUB; sy++) {
          var ty = y + (sy + 0.5) / SUB;
          var spy = Math.floor(mapY(ty));
          if (spy < 0) spy = 0; else if (spy >= ih) spy = ih - 1;
          for (var sx = 0; sx < SUB; sx++) {
            var tx = x + (sx + 0.5) / SUB;
            var spx = Math.floor(mapX(tx));
            if (spx < 0) spx = 0; else if (spx >= iw) spx = iw - 1;
            var oo = (spy * iw + spx) * 4;
            var aa = data[oo + 3] / 255;
            var sr = data[oo] * aa + 255 * (1 - aa);
            var sg = data[oo + 1] * aa + 255 * (1 - aa);
            var sb = data[oo + 2] * aa + 255 * (1 - aa);
            var key = ((sr >> 3) << 10) | ((sg >> 3) << 5) | (sb >> 3);
            var h = hist[key];
            if (!h) { h = hist[key] = { n: 0, r: 0, g: 0, b: 0 }; }
            h.n++; h.r += sr; h.g += sg; h.b += sb;
            if (h.n > bestN) { bestN = h.n; bestKey = key; }
            var ly = srgbLuma(sr, sg, sb);
            lumSum += ly;
            if (ly < minL) minL = ly;
            if (ly > maxL) maxL = ly;
            if (ly < 70) { darkN++; darkR += sr; darkG += sg; darkB += sb; }
          }
        }
        var dom = hist[bestKey];
        rowE[x] = {
          rgb: [dom.r / dom.n, dom.g / dom.n, dom.b / dom.n],
          share: bestN / SUB2,
          range: maxL - minL,
          luma: lumSum / SUB2,
          darkShare: darkN / SUB2,
          darkRgb: darkN ? [darkR / darkN, darkG / darkN, darkB / darkN] : null
        };
      }
      colors[y] = rowC; edge[y] = rowE; coverage[y] = rowV;
    }
    return { colors: colors, edge: edge, coverage: coverage, cols: cols, rows: rows };
  }

  /* ---------------- 匹配：Oklab 粗筛 + CIEDE2000 精排 ---------------- */
  var SHORTLIST = 6;
  function matchColor(rgb, pal, outCands) {
    var ok = rgbToOklab(rgb[0], rgb[1], rgb[2]);
    var bestIdx = new Array(SHORTLIST), bestD = new Array(SHORTLIST);
    var n = 0, worst = Infinity;
    for (var i = 0; i < pal.length; i++) {
      var p = pal[i];
      if (!p) continue;
      var d = oklabDistance(ok, p.oklab);
      if (n < SHORTLIST) {
        bestIdx[n] = i; bestD[n] = d; n++;
        if (n === SHORTLIST) {
          /* 插入排序一次，之后始终有序 */
          for (var a = 1; a < n; a++) {
            var ki = bestIdx[a], kd = bestD[a], j = a - 1;
            while (j >= 0 && bestD[j] > kd) { bestIdx[j + 1] = bestIdx[j]; bestD[j + 1] = bestD[j]; j--; }
            bestIdx[j + 1] = ki; bestD[j + 1] = kd;
          }
          worst = bestD[SHORTLIST - 1];
        }
      } else if (d < worst) {
        var pos = SHORTLIST - 1;
        while (pos > 0 && bestD[pos - 1] > d) { bestIdx[pos] = bestIdx[pos - 1]; bestD[pos] = bestD[pos - 1]; pos--; }
        bestIdx[pos] = i; bestD[pos] = d;
        worst = bestD[SHORTLIST - 1];
      }
    }
    var lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
    var bi = bestIdx[0], bd = Infinity, cands = [];
    for (var k = 0; k < n; k++) {
      var idx = bestIdx[k];
      var de = deltaE2000(pal[idx].lab, lab);
      cands.push([idx, de]);
      if (de < bd) { bd = de; bi = idx; }
    }
    cands.sort(function (a, b) { return a[1] - b[1]; });
    if (outCands) outCands.push(cands);
    return bi;
  }

  function nearPaletteColor(rgb, pal) {
    var cands = [];
    matchColor(rgb, pal, cands);
    return cands.length && cands[0].length ? cands[0][0][0] : 0;
  }

  /* ---------------- 抖动（默认关闭） ---------------- */
  /*
   * 蛇形扫描 + 误差阻尼 + 逐通道比例钳制。
   * 直接照搬 Floyd–Steinberg 在浅色区会抖出粗颗粒，阻尼后颗粒细很多。
   */
  function ditherCells(work, rows, cols, pal) {
    var n = rows * cols;
    var buf = new Float32Array(n * 3);
    var active = new Uint8Array(n);
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var c = work[y][x], o = y * cols + x;
        if (!c) continue;
        active[o] = 1;
        buf[o * 3] = srgbToLinear(c[0]);
        buf[o * 3 + 1] = srgbToLinear(c[1]);
        buf[o * 3 + 2] = srgbToLinear(c[2]);
      }
    }
    var out = new Array(rows);
    for (var yy = 0; yy < rows; yy++) out[yy] = new Array(cols);
    var DAMP = 0.75;
    var add = function (x, y, er, eg, eb, f) {
      if (x < 0 || x >= cols || y >= rows) return;
      var o = y * cols + x;
      if (!active[o]) return;
      var i = o * 3;
      buf[i] = Math.max(0, Math.min(1, buf[i] + er * f));
      buf[i + 1] = Math.max(0, Math.min(1, buf[i + 1] + eg * f));
      buf[i + 2] = Math.max(0, Math.min(1, buf[i + 2] + eb * f));
    };
    for (var row = 0; row < rows; row++) {
      var dir = (row % 2 === 0) ? 1 : -1;
      for (var step = 0; step < cols; step++) {
        var cx = dir > 0 ? step : cols - 1 - step;
        var ci = row * cols + cx;
        var cell = work[row][cx];
        if (!cell) { out[row][cx] = null; continue; }
        var bi = ci * 3;
        var old = [buf[bi], buf[bi + 1], buf[bi + 2]];
        var srgb = [linearToSrgb(old[0]), linearToSrgb(old[1]), linearToSrgb(old[2])];
        var k = nearPaletteColor(srgb, pal);
        out[row][cx] = k;
        var pc = pal[k].rgb;
        var er = (old[0] - srgbToLinear(pc[0])) * DAMP;
        var eg = (old[1] - srgbToLinear(pc[1])) * DAMP;
        var eb = (old[2] - srgbToLinear(pc[2])) * DAMP;
        add(cx + dir, row, er, eg, eb, 7 / 16);
        add(cx - dir, row + 1, er, eg, eb, 3 / 16);
        add(cx, row + 1, er, eg, eb, 5 / 16);
        add(cx + dir, row + 1, er, eg, eb, 1 / 16);
      }
    }
    return out;
  }

  /* ---------------- 邻域去斑：只压"平坦区孤点"，保边 ---------------- */
  /*
   * 数据项 = 与真实格心色的 CIEDE2000；
   * 平滑项 = 与 8 邻域不同色的个数 × lambda。
   * lambda 很小（默认 1），只有"改成一个邻居色能大幅降低色差"时才会改，
   * 所以眼睛高光、细描边这类高对比细节不会被抹掉。
   */
  function smoothSpeckles(grid, work, pal, rows, cols, lambda, iters) {
    var labs = new Array(rows);
    for (var y = 0; y < rows; y++) {
      labs[y] = new Array(cols);
      for (var x = 0; x < cols; x++) {
        var c = work[y][x];
        labs[y][x] = c ? rgbToLab(c[0], c[1], c[2]) : null;
      }
    }
    var g = grid.map(function (r) { return r.slice(); });
    var cand = [];
    for (var it = 0; it < iters; it++) {
      var next = g.map(function (r) { return r.slice(); });
      var changed = 0;
      for (var yy = 0; yy < rows; yy++) {
        for (var xx = 0; xx < cols; xx++) {
          var cur = g[yy][xx];
          if (cur === null || labs[yy][xx] === null) continue;
          cand.length = 0;
          cand.push(cur);
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (!dy && !dx) continue;
              var ny = yy + dy, nx = xx + dx;
              if (ny < 0 || nx < 0 || ny >= rows || nx >= cols) continue;
              var v = g[ny][nx];
              if (v !== null && cand.indexOf(v) < 0) cand.push(v);
            }
          }
          var best = cur, bestE = Infinity;
          for (var ci = 0; ci < cand.length; ci++) {
            var idx = cand[ci];
            var de = deltaE2000(pal[idx].lab, labs[yy][xx]);
            var diff = 0;
            for (var dy2 = -1; dy2 <= 1; dy2++) {
              for (var dx2 = -1; dx2 <= 1; dx2++) {
                if (!dy2 && !dx2) continue;
                var ny2 = yy + dy2, nx2 = xx + dx2;
                if (ny2 < 0 || nx2 < 0 || ny2 >= rows || nx2 >= cols) continue;
                if (g[ny2][nx2] !== idx) diff++;
              }
            }
            var E = de + lambda * diff;
            if (E < bestE) { bestE = E; best = idx; }
          }
          if (best !== cur) { next[yy][xx] = best; changed++; }
        }
      }
      g = next;
      if (!changed) break;
    }
    return g;
  }

  /* ---------------- 限制总用色数（"颜色精简"） ---------------- */
  function limitColors(grid, pal, rows, cols, maxColors) {
    var counts = new Array(pal.length).fill(0);
    var i, y, x;
    for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) { var v = grid[y][x]; if (v !== null) counts[v]++; }
    var used = [];
    for (i = 0; i < counts.length; i++) if (counts[i]) used.push(i);
    if (used.length <= maxColors) return { grid: grid, counts: counts };
    var pairDist = {};
    for (i = 0; i < used.length; i++) {
      for (var j = i + 1; j < used.length; j++) {
        pairDist[used[i] + ":" + used[j]] = deltaE2000(pal[used[i]].lab, pal[used[j]].lab);
      }
    }
    var active = {};
    for (i = 0; i < used.length; i++) active[used[i]] = true;
    var activeCount = used.length;
    var mergeMap = {};
    while (activeCount > maxColors) {
      var bestA = -1, bestB = -1, bestD = Infinity;
      for (i = 0; i < used.length; i++) {
        var a = used[i]; if (!active[a]) continue;
        for (var j2 = i + 1; j2 < used.length; j2++) {
          var b = used[j2]; if (!active[b]) continue;
          var d = pairDist[a + ":" + b];
          if (d < bestD) { bestD = d; bestA = a; bestB = b; }
        }
      }
      if (bestA < 0) break;
      /* 用色多的当代表色，用色少的并进去 */
      var keep = counts[bestA] >= counts[bestB] ? bestA : bestB;
      var drop = keep === bestA ? bestB : bestA;
      var rep = mergeMap[keep] !== undefined ? mergeMap[keep] : keep;
      mergeMap[drop] = rep;
      counts[rep] += counts[drop];
      counts[drop] = 0;
      active[drop] = false;
      activeCount--;
    }
    var out = new Array(rows), outCounts = new Array(pal.length).fill(0);
    for (y = 0; y < rows; y++) {
      var row = new Array(cols);
      for (x = 0; x < cols; x++) {
        var val = grid[y][x];
        if (val === null) { row[x] = null; continue; }
        while (mergeMap[val] !== undefined) val = mergeMap[val];
        row[x] = val;
        outCounts[val]++;
      }
      out[y] = row;
    }
    return { grid: out, counts: outCounts };
  }

  /* ---------------- 转换主流程 ---------------- */
  function convertCells(sample, cols, rows, palette, opts) {
    opts = opts || {};
    var pal = compilePalette(palette);
    var adj = opts.adj || { bright: 0, contrast: 0, sat: 0 };
    var removeBg = !!opts.removeBg;
    var bgThresh = opts.bgThresh != null ? opts.bgThresh : 242;
    var edgeLevel = opts.edge || 0;
    var dither = !!opts.dither;
    var maxColors = opts.maxColors || 0;
    var lambda = opts.lambda != null ? opts.lambda : 1;
    var iters = opts.iters != null ? opts.iters : 2;

    var edgeInfo = sample.edge;
    var work = new Array(rows);
    for (var y = 0; y < rows; y++) {
      var row = new Array(cols);
      for (var x = 0; x < cols; x++) {
        var c = adjustColor(sample.colors[y][x], adj);
        if (removeBg && srgbLuma(c[0], c[1], c[2]) >= bgThresh) { row[x] = null; continue; }
        if (edgeLevel > 0 && edgeInfo && edgeInfo[y][x]) {
          var e = edgeInfo[y][x];
          var avgL = srgbLuma(c[0], c[1], c[2]);
          var domL = srgbLuma(e.rgb[0], e.rgb[1], e.rgb[2]);
          /* 细线：格子里只要有一小片接近黑色的像素，就按线色落豆。
             只在"亮底上的暗线"（avgL 够亮）才触发，避免把暗部整片压黑。 */
          var needDark = edgeLevel >= 2 ? 0.10 : 0.45;
          if (avgL >= 110 && e.range >= 60 && e.darkShare >= needDark && e.darkRgb) {
            c = [e.darkRgb[0] | 0, e.darkRgb[1] | 0, e.darkRgb[2] | 0];
          } else {
            /* 粗描边 / 大色块：主色明显比平均色深时取主色 */
            var lim = edgeLevel >= 2
              ? { range: 90, share: 0.30, drop: 24 }
              : { range: 120, share: 0.50, drop: 28 };
            if (e.range >= lim.range && e.share >= lim.share && domL <= avgL - lim.drop) {
              c = [e.rgb[0], e.rgb[1], e.rgb[2]];
            }
          }
        }
        row[x] = c;
      }
      work[y] = row;
    }

    var grid, counts = new Array(pal.length).fill(0);
    if (dither) {
      grid = ditherCells(work, rows, cols, pal);
    } else {
      grid = new Array(rows);
      for (y = 0; y < rows; y++) {
        var grow = new Array(cols);
        for (x = 0; x < cols; x++) {
          grow[x] = work[y][x] ? matchColor(work[y][x], pal) : null;
        }
        grid[y] = grow;
      }
      if (lambda > 0) grid = smoothSpeckles(grid, work, pal, rows, cols, lambda, iters);
    }

    if (maxColors > 0) {
      var limited = limitColors(grid, pal, rows, cols, maxColors);
      grid = limited.grid; counts = limited.counts;
    } else {
      for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) { if (grid[y][x] !== null) counts[grid[y][x]]++; }
    }

    var total = 0, used = 0;
    for (var i = 0; i < counts.length; i++) if (counts[i]) { total += counts[i]; used++; }
    return { grid: grid, counts: counts, totalBeads: total, usedColors: used, palette: pal };
  }

  /* ---------------- CSV / 工程文件 ---------------- */
  function colLabel(i) {
    var s = "";
    i = i + 1;
    while (i > 0) { i--; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); }
    return s;
  }
  function cellText(idx, palette, mode) {
    if (idx === null || idx === undefined) return "";
    var p = palette[idx];
    if (!p) return "";
    if (mode === "idx") return String(idx + 1);
    if (mode === "name") return p.name || p.hex;
    return p.hex;
  }
  function cellCode(idx, palette, mode) {
    if (idx === null || idx === undefined || !mode) return "";
    var p = palette[idx];
    if (!p) return "";
    return mode === "idx" ? String(idx + 1) : (p.name || "");
  }
  function gridToCSV(grid, palette, mode) {
    var lines = [];
    for (var i = 0; i < grid.length; i++) {
      var row = [];
      for (var j = 0; j < grid[i].length; j++) row.push(cellText(grid[i][j], palette, mode));
      lines.push(row.join(","));
    }
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
  }
  function countsToCSV(counts, palette) {
    var lines = [["色号", "色名", "HEX", "R", "G", "B", "用量(颗)"].join(",")];
    for (var i = 0; i < counts.length; i++) {
      if (!counts[i]) continue;
      var p = palette[i];
      if (!p) continue;
      lines.push([i + 1, p.name || "", p.hex, p.rgb[0], p.rgb[1], p.rgb[2], counts[i]].join(","));
    }
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
  }
  function buildProject(state) {
    var used = [], map = {}, i;
    for (i = 0; i < state.palette.length; i++) map[i] = -1;
    state.palette.forEach(function (p, idx) {
      if (!state.counts[idx]) return;
      map[idx] = used.length;
      used.push({ name: p.name, hex: p.hex, rgb: p.rgb, count: state.counts[idx] });
    });
    var grid = state.grid.map(function (row) {
      return row.map(function (v) { return v === null ? -1 : map[v]; });
    });
    return {
      format: "pindou-pattern",
      version: 2,
      cols: state.cols,
      rows: state.rows,
      totalBeads: state.totalBeads,
      colorCount: used.length,
      palette: used,
      grid: grid,
      algorithm: "v15 linear-light sampling + Oklab/CIEDE2000 matching",
      note: "grid 中 -1 表示空豆（不拼），其余数字是 palette 的下标"
    };
  }

  return {
    version: "15",
    // 颜色数学
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    srgbToLinear: srgbToLinear,
    linearToSrgb: linearToSrgb,
    srgbLuma: srgbLuma,
    rgbToOklab: rgbToOklab,
    oklabToRgb: oklabToRgb,
    oklabDistance: oklabDistance,
    rgbToLab: rgbToLab,
    deltaE2000: deltaE2000,
    adjustColor: adjustColor,
    // 色卡
    compilePalette: compilePalette,
    parsePaletteText: parsePaletteText,
    // 流程
    sampleCells: sampleCells,
    convertCells: convertCells,
    // 导出
    colLabel: colLabel,
    cellText: cellText,
    cellCode: cellCode,
    gridToCSV: gridToCSV,
    countsToCSV: countsToCSV,
    buildProject: buildProject
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PindouCore;
