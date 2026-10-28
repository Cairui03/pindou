
document.addEventListener("DOMContentLoaded", function(){
  "use strict";
  var Core = window.PindouCore;
  var PALETTES = window.PINDOU_PALETTES;
  var colLabel = Core.colLabel, cellText = Core.cellText, cellCode = Core.cellCode,
      gridToCSV = Core.gridToCSV, countsToCSV = Core.countsToCSV, buildProject = Core.buildProject,
      srgbLuma = Core.srgbLuma;
  var parsePaletteText = function (text) { return Core.parsePaletteText(text); };
  function paletteByKey(key){ return Core.compilePalette(PALETTES[key]); }
  var $ = function(id){ return document.getElementById(id); };
  var pickBtn = $("pickBtn"), cameraBtn = $("cameraBtn"), fileInput = $("fileInput"), cameraInput = $("cameraInput"),
      dropZone = $("dropZone"), srcPreview = $("srcPreview"), srcImg = $("srcImg"),
      srcName = $("srcName"), srcInfo = $("srcInfo"), changeImgBtn = $("changeImgBtn"),
      sizeBtns = $("sizeBtns"), moreSize = $("moreSize"), cwInput = $("cw"), chInput = $("ch"), applyCustom = $("applyCustom"),
      paletteSelect = $("paletteSelect"), paletteInfo = $("paletteInfo"), paletteSwatches = $("paletteSwatches"),
      importPaletteBtn = $("importPaletteBtn"), paletteImportBox = $("paletteImportBox"),
      paletteText = $("paletteText"), paletteFile = $("paletteFile"), applyPalette = $("applyPalette"),
      adjBright = $("adjBright"), vBright = $("vBright"), adjContrast = $("adjContrast"), vContrast = $("vContrast"),
      adjSat = $("adjSat"), vSat = $("vSat"), adjReset = $("adjReset"),
      removeBgChk = $("removeBg"), bgThresh = $("bgThresh"), vBg = $("vBg"),
      simplifySel = $("simplify"),
      sharpenSel = $("sharpen"),
      cropBox = $("cropBox"), cropX = $("cropX"), cropY = $("cropY"), cropZoom = $("cropZoom"),
      vCropX = $("vCropX"), vCropY = $("vCropY"), vCropZoom = $("vCropZoom"),
      convertBtn = $("convertBtn"),
      previewWrap = $("previewWrap"), canvasSizer = $("canvasSizer"), previewCanvas = $("previewCanvas"),
      previewPlaceholder = $("previewPlaceholder"), zoom = $("zoom"), previewGridChk = $("previewGrid"),
      previewCodesChk = $("previewCodes"),
      fitBtn = $("fitBtn"), gridInfo = $("gridInfo"),
      toolBtns = [$("toolView"), $("toolPen"), $("toolErase")], undoBtn = $("undoBtn"), clearBtn = $("clearBtn"),
      brushSwatch = $("brushSwatch"), brushName = $("brushName"),
      countsBox = $("counts"),
      pixelScale = $("pixelScale"), sheetCellPx = $("sheetCellPx"), exportGridChk = $("exportGrid"),
      exportLabelsChk = $("exportLabels"), fillEmptyChk = $("fillEmpty"), csvMode = $("csvMode"),
      codeSkipBgChk = $("codeSkipBg"),
      cellCodesSel = $("cellCodes"),
      shareBtn = $("shareBtn"), exportPixelBtn = $("exportPixel"), exportSheetBtn = $("exportSheet"),
      exportCsvBtn = $("exportCsv"), exportJsonBtn = $("exportJson"), exportCountsBtn = $("exportCounts"),
      exportResult = $("exportResult"), exportImg = $("exportImg"), exportLink = $("exportLink"), exportTip = $("exportTip"),
      toast = $("toast");

  if (document.body.clientWidth > 0 && document.body.clientWidth <= 900) { previewWrap.style.maxHeight = "min(520px,58vh)"; }

  var state = {
    cols: 52, rows: 52,
    palette: paletteByKey("common424"), paletteKey: "common424",
    img: null, srcName: "", srcUrl: null, imageData: null, imageW: 0, imageH: 0, sample: null,
    grid: null, counts: null, totalBeads: 0, usedColors: 0,
    brush: 0, tool: "view", undoStack: [],
    lastBlob: null, lastName: "", resultUrl: null
  };
  var ditherMode = "smooth", fitMode = "cover";
  /* 颜色精简档位：
     passes = 去杂色遍数；merge = 相近色合并阈值（Lab 色差）；
     region = 区域统一的容差与最小格数（把被劈成两色的整片区域并回一色） */
  /* 颜色精简：值为 0=关闭，或允许的最大用色数 */

  var autoTimer = null, needsFit = true, renderPending = false;

  /* ---------------- 小工具 ---------------- */
  function toastMsg(msg){
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(function(){ toast.classList.remove("show"); }, 2400);
  }
  function fmtSize(){ return state.cols + "×" + state.rows; }
  function stamp(){
    var d = new Date();
    return d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0");
  }
  function baseName(){
    var n = String(state.srcName || "拼豆图").replace(/\.[^.]+$/, "");
    n = n.replace(/[\\/:*?"<>|\r\n\t]+/g, "_").slice(0, 36);
    return n || "拼豆图";
  }

  /* ---------------- 选图 ---------------- */
  function acceptImage(file){
    if (!file) return false;
    if (file.type && file.type.indexOf("image/") === 0) return true;
    return /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?)$/i.test(file.name || "");
  }
  function loadImage(file){
    if (!acceptImage(file)){ toastMsg("请选择图片文件"); return; }
    var url = null;
    try { url = URL.createObjectURL(file); } catch (e) { url = null; }
    if (!url){ loadViaReader(file); return; }
    var img = new Image();
    img.onload = function(){ applyImage(img, file.name, url); };
    img.onerror = function(){ URL.revokeObjectURL(url); failHint(file); };
    img.src = url;
  }
  function loadViaReader(file){
    var reader = new FileReader();
    reader.onload = function(e){
      var img = new Image();
      img.onload = function(){ applyImage(img, file.name, e.target.result); };
      img.onerror = function(){ failHint(file); };
      img.src = e.target.result;
    };
    reader.onerror = function(){ toastMsg("读取文件失败，请换一张图"); };
    reader.readAsDataURL(file);
  }
  function failHint(file){
    var heic = /heic|heif/i.test(file.type || "") || /\.heic$|\.heif$/i.test(file.name || "");
    toastMsg(heic ? "这张图是 HEIC 格式，浏览器打不开。请先在相册里改成 JPG，或截图后再用。" : "图片读不出来，换一张试试");
  }
  function applyImage(img, name, url){
    if (state.srcUrl && state.srcUrl !== url && state.srcUrl.indexOf("blob:") === 0){
      try { URL.revokeObjectURL(state.srcUrl); } catch (e) {}
    }
    state.img = img;
    state.imageData = null;
    state.imageW = 0;
    state.imageH = 0;
    state.sample = null;
    state.srcName = name || "图片";
    state.srcUrl = url;
    srcImg.src = url;
    srcName.textContent = state.srcName;
    srcInfo.textContent = img.naturalWidth + " × " + img.naturalHeight + " 像素";
    srcPreview.classList.remove("hidden");
    dropZone.classList.add("hidden");
    needsFit = true;
    convertAsync();
  }

  pickBtn.addEventListener("click", function(){ fileInput.click(); });
  changeImgBtn.addEventListener("click", function(){ fileInput.click(); });
  cameraBtn.addEventListener("click", function(){ cameraInput.click(); });
  fileInput.addEventListener("change", function(){
    if (fileInput.files && fileInput.files[0]) loadImage(fileInput.files[0]);
    fileInput.value = "";
  });
  cameraInput.addEventListener("change", function(){
    if (cameraInput.files && cameraInput.files[0]) loadImage(cameraInput.files[0]);
    cameraInput.value = "";
  });
  dropZone.addEventListener("click", function(){ fileInput.click(); });
  ["dragover","dragenter"].forEach(function(ev){
    dropZone.addEventListener(ev, function(e){ e.preventDefault(); dropZone.classList.add("dragover"); });
  });
  ["dragleave","drop"].forEach(function(ev){
    dropZone.addEventListener(ev, function(e){ e.preventDefault(); dropZone.classList.remove("dragover"); });
  });
  dropZone.addEventListener("drop", function(e){
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadImage(f);
  });
  document.addEventListener("paste", function(e){
    var items = (e.clipboardData || {}).items || [];
    for (var i = 0; i < items.length; i++){
      if (items[i].type && items[i].type.indexOf("image") === 0){
        var f = items[i].getAsFile();
        if (f){ e.preventDefault(); loadImage(f); return; }
      }
    }
  });

  /* ---------------- 板子尺寸 ---------------- */
  function syncSizeUI(){
    var btns = sizeBtns.querySelectorAll("button[data-c]");
    for (var i = 0; i < btns.length; i++){
      var b = btns[i];
      b.classList.toggle("active", parseInt(b.getAttribute("data-c"),10) === state.cols &&
                                    parseInt(b.getAttribute("data-r"),10) === state.rows);
    }
    cwInput.value = state.cols;
    chInput.value = state.rows;
  }
  function setSize(cols, rows){
    cols = Math.round(cols); rows = Math.round(rows);
    if (!isFinite(cols) || !isFinite(rows)) return;
    cols = Math.max(4, Math.min(300, cols));
    rows = Math.max(4, Math.min(300, rows));
    if (cols === state.cols && rows === state.rows) return;
    state.cols = cols; state.rows = rows;
    syncSizeUI();
    needsFit = true;
    autoConvert();
  }
  sizeBtns.addEventListener("click", function(e){
    var btn = e.target && e.target.closest ? e.target.closest("button[data-c]") : null;
    if (!btn) return;
    setSize(parseInt(btn.getAttribute("data-c"),10), parseInt(btn.getAttribute("data-r"),10));
  });
  moreSize.addEventListener("change", function(){
    var v = moreSize.value;
    moreSize.value = "";
    if (!v) return;
    var p = v.split("x");
    setSize(parseInt(p[0],10), parseInt(p[1],10));
    syncSizeUI();
  });
  applyCustom.addEventListener("click", function(){
    var c = parseInt(cwInput.value, 10), r = parseInt(chInput.value, 10);
    if (!c || !r || c < 4 || r < 4 || c > 300 || r > 300){
      toastMsg("宽和高请填 4 ~ 300 之间的整数");
      syncSizeUI();
      return;
    }
    setSize(c, r);
    syncSizeUI();
  });

  /* ---------------- 色板 ---------------- */
  var customPalette = null;
  /* 记住色板选择（存本地，下次打开还是它） */
  function savePref(k, v){ try { localStorage.setItem("pindou." + k, v); } catch (e) {} }
  function readPref(k){ try { return localStorage.getItem("pindou." + k); } catch (e) { return null; } }
  function renderPaletteInfo(){
    var p = state.palette;
    var tail;
    if (state.paletteKey === "custom") tail = "（你的自定义色卡）";
    else if (state.paletteKey === "dbk221") tail = "（大嘴巴拼豆现货色号，用豆统计会直接告诉你用哪几个号）";
    else tail = "（色卡越细，渐变越顺；用「导入我手上的豆子色卡」可换成你真实买的颜色）";
    paletteInfo.textContent = "已加载 " + p.length + " 色" + tail;
    paletteSwatches.innerHTML = "";
    var shown = Math.min(p.length, 48);
    for (var i = 0; i < shown; i++){
      var s = document.createElement("span");
      s.className = "swatch";
      s.style.background = p[i].hex;
      s.title = p[i].name + " " + p[i].hex;
      paletteSwatches.appendChild(s);
    }
    if (p.length > shown){
      var more = document.createElement("span");
      more.className = "swatch";
      more.style.cssText = "background:repeating-linear-gradient(45deg,#eee 0 4px,#fff 4px 8px); display:flex; align-items:center; justify-content:center; font-size:9px; color:#666; width:44px;";
      more.textContent = "+" + (p.length - shown);
      paletteSwatches.appendChild(more);
    }
  }
  paletteSelect.addEventListener("change", function(){
    var key = paletteSelect.value;
    if (key === "custom"){
      if (!customPalette){ toastMsg("还没有自定义色卡，先点下面的按钮导入"); paletteSelect.value = state.paletteKey; return; }
      state.palette = customPalette;
    } else {
      state.palette = paletteByKey(key);
    }
    state.paletteKey = key;
    savePref("palette", key);
    state.grid = null;
    state.counts = null;
    renderPaletteInfo();
    if (state.img) convert(); else autoConvert();
  });
  importPaletteBtn.addEventListener("click", function(){ paletteImportBox.classList.toggle("hidden"); });
  paletteFile.addEventListener("change", function(){
    var f = paletteFile.files && paletteFile.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function(e){ paletteText.value = String(e.target.result || ""); };
    reader.readAsText(f, "utf-8");
  });
  applyPalette.addEventListener("click", function(){
    try {
      customPalette = parsePaletteText(paletteText.value);
      paletteSelect.value = "custom";
      state.palette = customPalette;
      state.paletteKey = "custom";
      savePref("palette", "custom");
      savePref("custompalette", paletteText.value);
      state.grid = null;
      state.counts = null;
      renderPaletteInfo();
      toastMsg("色卡已载入：" + customPalette.length + " 色");
      if (state.img) convert(); else autoConvert();
    } catch (err) {
      toastMsg(err && err.message ? err.message : "色卡格式不对");
    }
  });

  /* ---------------- 转换设置 ---------------- */
  var ditherRadios = document.querySelectorAll('input[name="dither"]');
  for (var di = 0; di < ditherRadios.length; di++){
    ditherRadios[di].addEventListener("change", function(){ ditherMode = this.value; autoConvert(); });
  }
  var fitRadios = document.querySelectorAll('input[name="fit"]');
  for (var fi = 0; fi < fitRadios.length; fi++){
    fitRadios[fi].addEventListener("change", function(){
      fitMode = this.value;
      cropBox.classList.toggle("hidden", fitMode !== "cover");
      autoConvert();
    });
  }
  /* 裁切位置 / 缩放 */
  function syncCropLabels(){
    vCropX.textContent = cropX.value;
    vCropY.textContent = cropY.value;
    vCropZoom.textContent = cropZoom.value + "%";
  }
  [cropX, cropY, cropZoom].forEach(function(el){
    el.addEventListener("input", function(){ syncCropLabels(); autoConvert(); });
  });
  syncCropLabels();
  function bindSlider(input, out, fn){
    input.addEventListener("input", function(){
      out.textContent = input.value;
      if (fn) fn();
      autoConvert();
    });
  }
  bindSlider(adjBright, vBright);
  bindSlider(adjContrast, vContrast);
  bindSlider(adjSat, vSat);
  adjReset.addEventListener("click", function(){
    adjBright.value = 0; adjContrast.value = 0; adjSat.value = 0;
    vBright.textContent = "0"; vContrast.textContent = "0"; vSat.textContent = "0";
    autoConvert();
  });
  removeBgChk.addEventListener("change", function(){
    bgThresh.disabled = !removeBgChk.checked;
    autoConvert();
  });
  simplifySel.addEventListener("change", autoConvert);
  sharpenSel.addEventListener("change", autoConvert);
  bgThresh.addEventListener("input", function(){ vBg.textContent = bgThresh.value; });
  bgThresh.addEventListener("change", function(){ autoConvert(); });

  /* ---------------- 采样 + 量化（v15 新算法） ---------------- */
  var MAX_SOURCE = 2048;
  /* 把图片转成受内存限制的 ImageData：长边最多 2048，避免 iPad 上大图爆内存 */
  function ensureImageData(){
    if (state.imageData) return;
    var img = state.img;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) throw new Error("图片尺寸读取失败");
    var scale = Math.min(1, MAX_SOURCE / Math.max(iw, ih));
    var sw = iw, sh = ih, src = img;
    while (Math.max(sw, sh) > MAX_SOURCE * 2 && Math.max(sw, sh) > 8){
      var nw = Math.max(1, Math.round(sw / 2)), nh = Math.max(1, Math.round(sh / 2));
      var t = document.createElement("canvas");
      t.width = nw; t.height = nh;
      var tc = t.getContext("2d");
      tc.imageSmoothingEnabled = true;
      tc.imageSmoothingQuality = "high";
      tc.drawImage(src, 0, 0, nw, nh);
      src = t; sw = nw; sh = nh;
    }
    var cw = Math.max(1, Math.round(sw * scale)), ch = Math.max(1, Math.round(sh * scale));
    var cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    var c2 = cv.getContext("2d", { willReadFrequently: true });
    c2.imageSmoothingEnabled = true;
    c2.imageSmoothingQuality = "high";
    c2.fillStyle = "#FFFFFF";
    c2.fillRect(0, 0, cw, ch);
    c2.drawImage(src, 0, 0, cw, ch);
    state.imageData = c2.getImageData(0, 0, cw, ch);
    state.imageW = cw; state.imageH = ch;
  }
  function sampleOptions(){
    return {
      fit: fitMode,
      posX: parseInt(cropX.value, 10) / 100,
      posY: parseInt(cropY.value, 10) / 100,
      zoom: (parseInt(cropZoom.value, 10) || 100) / 100
    };
  }
  function convert(){
    if (!state.img){
      canvasSizer.classList.add("hidden");
      previewCanvas.classList.add("hidden");
      previewPlaceholder.classList.remove("hidden");
      return null;
    }
    ensureImageData();
    var geo = sampleOptions();
    var key = state.cols + "x" + state.rows + "|" + geo.fit + "|" + geo.posX + "|" + geo.posY + "|" + geo.zoom;
    if (!state.sample || state.sample.key !== key){
      state.sample = {
        key: key,
        data: Core.sampleCells(state.imageData, state.imageW, state.imageH, state.cols, state.rows, geo)
      };
    }
    var adj = { bright: +adjBright.value, contrast: +adjContrast.value, sat: +adjSat.value };
    var result = Core.convertCells(state.sample.data, state.cols, state.rows, state.palette, {
      adj: adj,
      removeBg: removeBgChk.checked,
      bgThresh: +bgThresh.value,
      edge: +sharpenSel.value || 0,
      dither: ditherMode === "dither",
      maxColors: parseInt(simplifySel.value, 10) || 0,
      lambda: 1,
      iters: 2
    });
    state.grid = result.grid;
    state.counts = result.counts;
    state.convId = (state.convId || 0) + 1;
    recalcTotals();
    state.undoStack = [];
    if (state.brush >= state.palette.length || !state.counts[state.brush]) pickDefaultBrush();
    renderPreview();
    renderCounts();
    renderBrush();
    updateInfo();
    if (needsFit){ needsFit = false; fitZoom(true); }
    return state.grid;
  }
  function recalcTotals(){
    var total = 0, used = 0;
    for (var i = 0; i < state.counts.length; i++){
      if (state.counts[i] > 0){ total += state.counts[i]; used++; }
    }
    state.totalBeads = total;
    state.usedColors = used;
  }
  function updateInfo(){
    gridInfo.textContent = fmtSize() + " 钉 · " + state.usedColors + " 色 · " + state.totalBeads + " 颗豆";
  }
  function pickDefaultBrush(){
    var best = -1, bestN = 0;
    for (var i = 0; i < state.counts.length; i++){
      if (state.counts[i] > bestN){ bestN = state.counts[i]; best = i; }
    }
    state.brush = best >= 0 ? best : 0;
  }
  function convertAsync(){
    if (!state.img){ toastMsg("先选一张图片"); fileInput.click(); return; }
    convertBtn.disabled = true;
    convertBtn.textContent = "正在生成…";
    setTimeout(function(){
      try { convert(); }
      catch (err) { toastMsg("转换失败：" + (err && err.message ? err.message : "未知错误")); }
      convertBtn.disabled = false;
      convertBtn.textContent = "生成豆图";
    }, 30);
  }
  function autoConvert(){
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(function(){
      autoTimer = null;
      if (state.img) convert();
    }, 140);
  }
  convertBtn.addEventListener("click", convertAsync);

  /* ---------------- 预览与绘制 ---------------- */
  function previewCell(){
    var n = Math.max(state.cols, state.rows);
    /* 要印色号就得给文字留出格子，自动放大每格 */
    if (previewCodesChk.checked) return Math.max(9, Math.min(22, Math.round(2200 / n)));
    return Math.max(3, Math.min(20, Math.round(520 / n)));
  }
  /* 预览里印什么：色卡名都比较短（如 A14）就用名字，否则用编号 */
  function autoCodeMode(){
    var maxLen = 0;
    for (var i = 0; i < state.palette.length; i++){
      var n = (state.palette[i].name || "").length;
      if (n > maxLen) maxLen = n;
    }
    return maxLen <= 4 ? "name" : "idx";
  }
  function renderPreview(){
    if (!state.grid) return;
    previewPlaceholder.classList.add("hidden");
    canvasSizer.classList.remove("hidden");
    previewCanvas.classList.remove("hidden");
    var cell = previewCell();
    var w = state.cols * cell, h = state.rows * cell;
    if (previewCanvas.width !== w || previewCanvas.height !== h){
      previewCanvas.width = w; previewCanvas.height = h;
    }
    var ctx = previewCanvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    /* 画笔拖动过程中不印色号（重新排版文字很费时），松手后再补上 */
    var codeMode = (previewCodesChk.checked && !painting) ? autoCodeMode() : null;
    drawGridToCtx(ctx, state.grid, state.palette, cell, previewGridChk.checked, false, false, codeMode);
    applyZoom();
  }
  function scheduleRender(){
    if (renderPending) return;
    renderPending = true;
    var raf = window.requestAnimationFrame || function(fn){ return setTimeout(fn, 16); };
    raf(function(){ renderPending = false; renderPreview(); });
  }
  /*
   * 背景区域识别：从最外圈出发，只沿着"和边框上最主流的那个颜色相同"的格子蔓延。
   * 得到的就是整片背景，标色号时可以把它跳过去（大面积纯色不需要每格都印同一个号）。
   */
  function backgroundMask(grid, rows, cols){
    var tally = {}, x, y, k;
    for (x = 0; x < cols; x++){ tally[grid[0][x]] = (tally[grid[0][x]] || 0) + 1; tally[grid[rows-1][x]] = (tally[grid[rows-1][x]] || 0) + 1; }
    for (y = 0; y < rows; y++){ tally[grid[y][0]] = (tally[grid[y][0]] || 0) + 1; tally[grid[y][cols-1]] = (tally[grid[y][cols-1]] || 0) + 1; }
    var bg = -1, bgN = 0;
    for (k in tally){ if (tally[k] > bgN){ bgN = tally[k]; bg = parseInt(k, 10); } }
    var mask = new Uint8Array(rows * cols);
    if (isNaN(bg)) return mask;
    var stack = [];
    for (x = 0; x < cols; x++){
      if (grid[0][x] === bg) stack.push(x);
      if (grid[rows-1][x] === bg) stack.push((rows-1) * cols + x);
    }
    for (y = 0; y < rows; y++){
      if (grid[y][0] === bg) stack.push(y * cols);
      if (grid[y][cols-1] === bg) stack.push(y * cols + cols - 1);
    }
    while (stack.length){
      var p = stack.pop();
      if (mask[p]) continue;
      mask[p] = 1;
      var py = Math.floor(p / cols), px = p % cols;
      if (px > 0 && grid[py][px-1] === bg && !mask[p-1]) stack.push(p-1);
      if (px < cols-1 && grid[py][px+1] === bg && !mask[p+1]) stack.push(p+1);
      if (py > 0 && grid[py-1][px] === bg && !mask[p-cols]) stack.push(p-cols);
      if (py < rows-1 && grid[py+1][px] === bg && !mask[p+cols]) stack.push(p+cols);
    }
    return mask;
  }

  /* codeMode 非空时，每格中央印上色号（"name" 用色卡名如 A14，"idx" 用编号）；
     skipMask 里标记为 1 的格子（背景）跳过不印 */
  function drawGridToCtx(ctx, grid, palette, cellPx, showGrid, labels, whiteEmpty, codeMode, skipMask){
    var rows = grid.length, cols = grid[0].length;
    var labelW = 0, labelH = 0, fontSize = 11;
    if (labels){
      fontSize = Math.max(9, Math.min(13, Math.floor(cellPx * 0.68)));
      labelH = fontSize + 8;
      labelW = colLabel(cols - 1).length * Math.ceil(fontSize * 0.64) + 12;
      ctx.font = fontSize + "px -apple-system, sans-serif";
      ctx.fillStyle = "#333";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (var c = 0; c < cols; c++) ctx.fillText(colLabel(c), labelW + c * cellPx + cellPx / 2, labelH / 2);
      ctx.textAlign = "right";
      for (var r = 0; r < rows; r++) ctx.fillText(String(r + 1), labelW - 6, labelH + r * cellPx + cellPx / 2);
    }
    /* 色号文字：先量出每个色号的实际宽度（中英混排宽度差别很大），再定字号，
       保证每个色号都完整装在格子里不压边 */
    var CODE_FONT = 'px -apple-system, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif';
    var codeFonts = null, codeBaseFs = 0, kk, lastCodeFs = -1;
    if (codeMode){
      codeBaseFs = Math.max(5, Math.min(cellPx * 0.6, 34));
      ctx.font = "600 " + codeBaseFs.toFixed(1) + CODE_FONT;
      var seen = {};
      for (var yy = 0; yy < rows; yy++){
        for (var xx = 0; xx < cols; xx++){
          var t0 = cellCode(grid[yy][xx], palette, codeMode);
          if (t0) seen[t0] = 1;
        }
      }
      codeFonts = {};
      var limitW = cellPx * 0.84;
      for (kk in seen){
        var wpx = ctx.measureText(kk).width;
        codeFonts[kk] = wpx > limitW ? Math.max(4, codeBaseFs * limitW / wpx) : codeBaseFs;
      }
      ctx.font = "600 " + codeBaseFs.toFixed(1) + CODE_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    }
    for (var y = 0; y < rows; y++){
      for (var x = 0; x < cols; x++){
        var idx = grid[y][x];
        if (idx === null){
          if (whiteEmpty){
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(labelW + x * cellPx, labelH + y * cellPx, cellPx, cellPx);
          } else if (labels){
            ctx.fillStyle = "rgba(0,0,0,.07)";
            ctx.fillRect(labelW + x * cellPx, labelH + y * cellPx, cellPx, cellPx);
          }
          continue;
        }
        var palColor = palette[idx];
        if (!palColor) continue;
        ctx.fillStyle = palColor.hex;
        ctx.fillRect(labelW + x * cellPx, labelH + y * cellPx, cellPx, cellPx);
        if (codeMode){
          var txt = cellCode(idx, palette, codeMode);
          if (txt && !(skipMask && skipMask[y * cols + x])){
            var wantFs = codeFonts[txt] || codeBaseFs;
            if (wantFs !== lastCodeFs){
              ctx.font = "600 " + wantFs.toFixed(1) + CODE_FONT;
              lastCodeFs = wantFs;
            }
            var cc = palette[idx].rgb;
            ctx.fillStyle = srgbLuma(cc[0], cc[1], cc[2]) > 145 ? "#1C1C1C" : "#FFFFFF";
            ctx.fillText(txt, labelW + x * cellPx + cellPx / 2, labelH + y * cellPx + cellPx / 2 + cellPx * 0.03);
          }
        }
      }
    }
    if (showGrid){
      ctx.strokeStyle = "rgba(0,0,0,.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var g = 1; g < cols; g++){
        var px = labelW + g * cellPx + 0.5;
        ctx.moveTo(px, labelH); ctx.lineTo(px, labelH + rows * cellPx);
      }
      for (var g2 = 1; g2 < rows; g2++){
        var py = labelH + g2 * cellPx + 0.5;
        ctx.moveTo(labelW, py); ctx.lineTo(labelW + cols * cellPx, py);
      }
      ctx.stroke();
    }
  }
  function applyZoom(){
    var v = parseFloat(zoom.value) || 1;
    previewCanvas.style.transform = "scale(" + v + ")";
    canvasSizer.style.width = (previewCanvas.width * v + 20) + "px";
    canvasSizer.style.height = (previewCanvas.height * v + 20) + "px";
  }
  function fitZoom(silent){
    if (!state.grid) return;
    var availW = previewWrap.clientWidth - 26;
    var availH = Math.min(previewWrap.clientHeight || 0, window.innerHeight * 0.6) - 26;
    if (availH < 120) availH = Math.min(520, window.innerHeight * 0.6) - 26;
    var v = Math.min(availW / previewCanvas.width, availH / previewCanvas.height);
    if (!isFinite(v) || v <= 0) v = 1;
    v = Math.max(0.2, Math.min(4, Math.round(v * 10) / 10));
    zoom.value = v;
    applyZoom();
    if (!silent) toastMsg("已适应窗口");
  }
  zoom.addEventListener("input", applyZoom);
  previewGridChk.addEventListener("change", renderPreview);
  previewCodesChk.addEventListener("change", function(){
    renderPreview();
    fitZoom(true);
    if (previewCodesChk.checked) toastMsg("预览已显示色号，放大就能看清");
  });
  fitBtn.addEventListener("click", function(){ fitZoom(false); });

  function cellFromEvent(e){
    var rect = previewCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var x = Math.floor((e.clientX - rect.left) / rect.width * state.cols);
    var y = Math.floor((e.clientY - rect.top) / rect.height * state.rows);
    if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return null;
    return { x: x, y: y };
  }
  function snapshot(){
    state.undoStack.push(state.grid.map(function(r){ return r.slice(); }));
    if (state.undoStack.length > 20) state.undoStack.shift();
  }
  function paintAt(x, y){
    var prev = state.grid[y][x];
    var next = (state.tool === "erase") ? null : state.brush;
    if (prev === next) return;
    state.grid[y][x] = next;
    if (prev !== null) state.counts[prev]--;
    if (next !== null) state.counts[next]++;
    recalcTotals();
    updateInfo();
    scheduleRender();
  }
  var painting = false, lastCell = null;
  previewCanvas.addEventListener("pointerdown", function(e){
    if (state.tool === "view" || !state.grid) return;
    var c = cellFromEvent(e);
    if (!c) return;
    e.preventDefault();
    painting = true; lastCell = c;
    try { previewCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    snapshot();
    paintAt(c.x, c.y);
  });
  previewCanvas.addEventListener("pointermove", function(e){
    if (!painting) return;
    e.preventDefault();
    var c = cellFromEvent(e);
    if (!c) return;
    if (lastCell && c.x === lastCell.x && c.y === lastCell.y) return;
    lineTo(lastCell, c);
    lastCell = c;
  });
  function lineTo(from, to){
    if (!from){ paintAt(to.x, to.y); return; }
    var dx = Math.abs(to.x - from.x), dy = Math.abs(to.y - from.y);
    var sx = from.x < to.x ? 1 : -1, sy = from.y < to.y ? 1 : -1;
    var err = dx - dy, x = from.x, y = from.y, guard = 0;
    while (guard++ < 4000){
      paintAt(x, y);
      if (x === to.x && y === to.y) break;
      var e2 = 2 * err;
      if (e2 > -dy){ err -= dy; x += sx; }
      if (e2 < dx){ err += dx; y += sy; }
    }
  }
  function endPaint(){
    if (!painting) return;
    painting = false; lastCell = null;
    renderCounts();
    renderBrush();
    scheduleRender();   // 松手后把色号补画回来
  }
  previewCanvas.addEventListener("pointerup", endPaint);
  previewCanvas.addEventListener("pointercancel", endPaint);
  window.addEventListener("pointerup", endPaint);

  function setTool(tool){
    state.tool = tool;
    for (var i = 0; i < toolBtns.length; i++){
      toolBtns[i].classList.toggle("active", toolBtns[i].getAttribute("data-tool") === tool);
    }
    previewCanvas.classList.toggle("paintable", tool !== "view");
    if (tool === "pen") toastMsg("画笔已开启：在图上点一下或拖动改颜色");
    if (tool === "erase") toastMsg("橡皮擦已开启：点一下把豆子擦掉");
  }
  for (var ti = 0; ti < toolBtns.length; ti++){
    (function(btn){ btn.addEventListener("click", function(){ setTool(btn.getAttribute("data-tool")); }); })(toolBtns[ti]);
  }
  undoBtn.addEventListener("click", function(){
    if (!state.undoStack.length){ toastMsg("没有可撤销的修改了"); return; }
    state.grid = state.undoStack.pop();
    recalcCountsFromGrid();
    renderPreview(); renderCounts(); updateInfo();
  });
  clearBtn.addEventListener("click", function(){
    if (!state.grid){ toastMsg("先选图片生成豆图"); return; }
    snapshot();
    for (var y = 0; y < state.rows; y++) for (var x = 0; x < state.cols; x++) state.grid[y][x] = null;
    recalcCountsFromGrid();
    renderPreview(); renderCounts(); updateInfo();
    toastMsg("已清空，可用「撤销」恢复");
  });
  function recalcCountsFromGrid(){
    var counts = new Array(state.palette.length).fill(0);
    for (var y = 0; y < state.rows; y++){
      for (var x = 0; x < state.cols; x++){
        var v = state.grid[y][x];
        if (v !== null) counts[v]++;
      }
    }
    state.counts = counts;
    recalcTotals();
  }
  function renderBrush(){
    var p = state.palette[state.brush];
    if (!p) return;
    brushSwatch.style.background = p.hex;
    brushName.textContent = p.name + " · " + (state.brush + 1) + "号";
  }

  /* ---------------- 用豆统计 ---------------- */
  function renderCounts(){
    if (!state.counts) return;
    countsBox.innerHTML = "";
    var items = [];
    for (var i = 0; i < state.counts.length; i++){
      if (state.counts[i] > 0) items.push({ idx: i, count: state.counts[i] });
    }
    items.sort(function(a, b){ return b.count - a.count; });
    if (!items.length){
      countsBox.innerHTML = '<div class="placeholder" style="grid-column:1/-1;">这张豆图没有用到任何颜色</div>';
      return;
    }
    items.forEach(function(it){
      var p = state.palette[it.idx];
      var div = document.createElement("div");
      div.className = "count-item" + (it.idx === state.brush ? " sel" : "");
      var sw = document.createElement("span");
      sw.className = "c-swatch"; sw.style.background = p.hex;
      var nm = document.createElement("span");
      nm.className = "c-name"; nm.textContent = p.name + " · " + (it.idx + 1) + "号";
      nm.title = p.hex;
      var num = document.createElement("span");
      num.className = "c-num"; num.textContent = it.count + " 颗";
      div.appendChild(sw); div.appendChild(nm); div.appendChild(num);
      div.addEventListener("click", function(){
        state.brush = it.idx;
        renderBrush();
        renderCounts();
        if (state.tool === "erase") setTool("pen");
        toastMsg("笔色换成 " + p.name);
      });
      countsBox.appendChild(div);
    });
  }

  /* ---------------- 导出 ---------------- */
  function ensureGrid(){
    if (state.grid) return state.grid;
    if (!state.img){ toastMsg("先选一张图片"); fileInput.click(); return null; }
    return convert();
  }
  function canvasToBlob(canvas, cb){
    if (canvas.toBlob){
      canvas.toBlob(function(b){ cb(b); }, "image/png");
      return;
    }
    try { cb(dataUrlToBlob(canvas.toDataURL("image/png"))); }
    catch (e) { cb(null); }
  }
  function dataUrlToBlob(dataUrl){
    var parts = dataUrl.split(","), mime = /:(.*?);/.exec(parts[0])[1];
    var bin = atob(parts[1]), len = bin.length, u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }
  function buildPixelCanvas(scale){
    var base = document.createElement("canvas");
    base.width = state.cols; base.height = state.rows;
    var bctx = base.getContext("2d");
    var id = bctx.createImageData(state.cols, state.rows);
    var d = id.data, white = fillEmptyChk.checked;
    for (var y = 0; y < state.rows; y++){
      for (var x = 0; x < state.cols; x++){
        var idx = state.grid[y][x], o = (y * state.cols + x) * 4;
        if (idx === null || idx === undefined){
          if (white){ d[o] = 255; d[o+1] = 255; d[o+2] = 255; d[o+3] = 255; }
          else { d[o] = 0; d[o+1] = 0; d[o+2] = 0; d[o+3] = 0; }
        } else {
          var c = state.palette[idx].rgb;
          d[o] = c[0]; d[o+1] = c[1]; d[o+2] = c[2]; d[o+3] = 255;
        }
      }
    }
    bctx.putImageData(id, 0, 0);
    if (scale <= 1) return base;
    var big = document.createElement("canvas");
    big.width = state.cols * scale; big.height = state.rows * scale;
    var g = big.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(base, 0, 0, big.width, big.height);
    return big;
  }
  function buildSheetCanvas(){
    var cellPx = parseInt(sheetCellPx.value, 10) || 16;
    var labels = exportLabelsChk.checked;
    var rows = state.rows, cols = state.cols;
    var labelW = 0, labelH = 0;
    if (labels){
      var fontSize = Math.max(9, Math.min(13, Math.floor(cellPx * 0.68)));
      labelH = fontSize + 8;
      labelW = colLabel(cols - 1).length * Math.ceil(fontSize * 0.64) + 12;
    }
    var cv = document.createElement("canvas");
    cv.width = labelW + cols * cellPx;
    cv.height = labelH + rows * cellPx;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cv.width, cv.height);
    var codeMode = cellCodesSel.value === "none" ? null : cellCodesSel.value;
    var skipMask = (codeMode && codeSkipBgChk.checked) ? backgroundMask(state.grid, rows, cols) : null;
    drawGridToCtx(ctx, state.grid, state.palette, cellPx, exportGridChk.checked, labels, false, codeMode, skipMask);
    return cv;
  }
  function showResult(blob, filename, tip){
    if (state.resultUrl){ try { URL.revokeObjectURL(state.resultUrl); } catch (e) {} }
    state.lastBlob = blob; state.lastName = filename;
    state.resultUrl = URL.createObjectURL(blob);
    if (/^image\//.test(blob.type || "")){
      exportImg.src = state.resultUrl;
      exportImg.classList.remove("hidden");
    } else {
      exportImg.removeAttribute("src");
      exportImg.classList.add("hidden");
    }
    exportLink.href = state.resultUrl;
    exportLink.setAttribute("download", filename);
    exportLink.textContent = "下载 " + filename;
    exportTip.innerHTML = tip;
    exportResult.classList.remove("hidden");
    try { exportResult.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
  }
  function downloadBlob(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }

  function tipPixel(){
    return '<b>这就是拼豆 App 最认的图：</b>1 个像素 = 1 颗豆，整张图正好 ' + fmtSize() + ' 像素（' +
      state.totalBeads + ' 颗豆、' + state.usedColors + ' 种色），没有网格线和坐标，导入后不会识别错位。<br>' +
      '<b>iPad / iPhone：</b>长按下面这张图 →「存储到相册」；或点上面的「分享 / 存到相册」直接分享给拼豆 App。';
  }
  function tipSheet(){
    var codes = cellCodesSel.value !== "none";
    return (codes
        ? '<b>带色号图纸：</b>每格都印上色号（' + (cellCodesSel.value === "idx" ? "编号" : "色名") + '），照着摆豆不用比对颜色，也不怕相近色看岔。<br>'
        : '<b>打印用图纸：</b>带网格和行列坐标，打印出来照着摆豆；空豆（不拼的地方）用浅灰标出。<br>') +
      '<b>电脑：</b>右键另存，或点下面的下载按钮。';
  }
  /* 选了色号就自动把每格调大一点，否则字看不清 */
  cellCodesSel.addEventListener("change", function(){
    if (cellCodesSel.value !== "none" && (parseInt(sheetCellPx.value, 10) || 16) < 24){
      sheetCellPx.value = "24";
      toastMsg("已把「图纸每格」调到 24px，色号才看得清");
    }
  });
  var TIP_FILE = '文件已开始下载，在浏览器的「下载」里就能找到；iPad / iPhone 会存到「文件」App 的下载文件夹。';
  var TIP_SHARE_FALLBACK =
    '<b>这台设备不支持直接分享文件。</b>长按下面这张图 →「存储到相册」，然后打开拼豆 App 从相册导入；' +
    '或点下面的下载按钮把文件保存到「文件」App。';

  shareBtn.addEventListener("click", function(){
    if (!ensureGrid()) return;
    var scale = parseInt(pixelScale.value, 10) || 1;
    var name = baseName() + "_" + fmtSize() + "_豆图" + (scale > 1 ? "_" + scale + "x" : "") + ".png";
    shareBtn.disabled = true;
    canvasToBlob(buildPixelCanvas(scale), function(blob){
      shareBtn.disabled = false;
      if (!blob){ toastMsg("生成失败，换个浏览器试试"); return; }
      var file = null;
      try { file = new File([blob], name, { type: "image/png" }); } catch (e) { file = null; }
      var canShareFile = false;
      if (file && navigator.share){
        try { canShareFile = !navigator.canShare || navigator.canShare({ files: [file] }); }
        catch (e) { canShareFile = false; }
      }
      if (canShareFile){
        navigator.share({ files: [file], title: name }).then(function(){
          toastMsg("已分享");
        }).catch(function(err){
          if (err && err.name === "AbortError") return;
          showResult(blob, name, TIP_SHARE_FALLBACK);
        });
        return;
      }
      showResult(blob, name, TIP_SHARE_FALLBACK);
      downloadBlob(blob, name);
    });
  });
  exportPixelBtn.addEventListener("click", function(){
    if (!ensureGrid()) return;
    var scale = parseInt(pixelScale.value, 10) || 1;
    var name = baseName() + "_" + fmtSize() + "_像素图" + (scale > 1 ? "_" + scale + "x" : "") + ".png";
    canvasToBlob(buildPixelCanvas(scale), function(blob){
      if (!blob){ toastMsg("生成失败，换个浏览器试试"); return; }
      showResult(blob, name, tipPixel());
    });
  });
  exportSheetBtn.addEventListener("click", function(){
    if (!ensureGrid()) return;
    var cv = buildSheetCanvas();
    var name = baseName() + "_" + fmtSize() + "_图纸.png";
    canvasToBlob(cv, function(blob){
      if (!blob){ toastMsg("生成失败，换个浏览器试试"); return; }
      showResult(blob, name, tipSheet());
    });
  });
  exportCsvBtn.addEventListener("click", function(){
    if (!ensureGrid()) return;
    var text = gridToCSV(state.grid, state.palette, csvMode.value);
    var name = baseName() + "_" + fmtSize() + "_色号表.csv";
    downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), name);
    showResult(new Blob([text], { type: "text/plain;charset=utf-8" }), name, TIP_FILE +
      '<br>用 Excel / WPS / 表格 App 打开；支持「按格导入」的拼豆软件也能直接读这个表。');
  });
  exportJsonBtn.addEventListener("click", function(){
    if (!ensureGrid()) return;
    var proj = buildProject(state);
    var text = JSON.stringify(proj);
    var name = baseName() + "_" + fmtSize() + "_工程.json";
    downloadBlob(new Blob([text], { type: "application/json;charset=utf-8" }), name);
    showResult(new Blob([text], { type: "text/plain;charset=utf-8" }), name, TIP_FILE +
      '<br>工程文件里记录了每颗豆的颜色和位置，方便以后再打开或二次加工。');
  });
  exportCountsBtn.addEventListener("click", function(){
    if (!ensureGrid()) return;
    var text = countsToCSV(state.counts, state.palette);
    var name = baseName() + "_" + fmtSize() + "_用豆清单.csv";
    downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), name);
    showResult(new Blob([text], { type: "text/plain;charset=utf-8" }), name, TIP_FILE +
      '<br>这张表列出每种颜色要买几颗豆，照着备货就行。');
  });

  /* ---------------- 初始化 ---------------- */
  /* 上次用的色板 / 自定义色卡，直接从本地读回来 */
  (function restorePalette(){
    var savedCustom = readPref("custompalette");
    if (savedCustom){
      try { customPalette = parsePaletteText(savedCustom); paletteText.value = savedCustom; }
      catch (e) { customPalette = null; }
    }
    var savedKey = readPref("palette");
    if (savedKey === "custom" && customPalette){
      state.palette = customPalette; state.paletteKey = "custom"; paletteSelect.value = "custom";
    } else if (savedKey && PALETTES[savedKey] && savedKey !== "custom"){
      if (savedKey === "common256") savedKey = "common424";
      state.palette = paletteByKey(savedKey); state.paletteKey = savedKey; paletteSelect.value = savedKey;
    }
  })();
  renderPaletteInfo();
  syncSizeUI();
  renderBrush();
  canvasSizer.classList.add("hidden");
  previewCanvas.classList.add("hidden");
  /* 作为网页（http/https）打开时，补上「添加到主屏幕」需要的图标和清单；
     作为本地文件打开时跳过，免得发无效请求报错。 */
  if (/^https?:$/.test(location.protocol)){
    var touchIcon = document.createElement("link");
    touchIcon.rel = "apple-touch-icon";
    touchIcon.setAttribute("sizes", "180x180");
    touchIcon.href = "apple-touch-icon.png";
    document.head.appendChild(touchIcon);
    var touchPre = document.createElement("link");
    touchPre.rel = "apple-touch-icon-precomposed";
    touchPre.href = "apple-touch-icon.png";
    document.head.appendChild(touchPre);
    var mf = document.createElement("link");
    mf.rel = "manifest";
    mf.href = "manifest.webmanifest";
    document.head.appendChild(mf);
  }
  /* 调试钩子：方便自动化测试读取内部状态，不影响正常使用 */
  window.PindouDebug = { state: state, convert: convert, Core: Core, PALETTES: PALETTES };
  window.addEventListener("resize", function(){
    if (!state.grid) return;
    applyZoom();
  });
});
