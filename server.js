"use strict";
/* 拼豆豆图生成器 —— 极简本地网页服务
   作用：把这台电脑变成一个"网址"，让同一 Wi-Fi 下的平板/手机用浏览器打开，
   从而绕开 iOS 无法直接打开本地 .html 文件的限制。
   用法：双击同目录下的「启动服务.bat」，或在本目录执行  node server.js   */

var http = require("http");
var fs = require("fs");
var path = require("path");
var os = require("os");
var exec = require("child_process").exec;

var ROOT = __dirname;
var START_PORT = 8080;
var MAX_TRIES = 8;

var MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};

function lanAddresses(){
  var list = [];
  var ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function(name){
    (ifs[name] || []).forEach(function(a){
      if (a.family === "IPv4" && !a.internal) list.push(a.address);
    });
  });
  return list;
}

function reply(res, code, type, text){
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(text);
}

var server = http.createServer(function(req, res){
  var urlPath = "/";
  try {
    urlPath = decodeURIComponent(String(req.url || "/").split("?")[0].split("#")[0]);
  } catch (e) {
    reply(res, 400, "text/plain; charset=utf-8", "400 Bad Request");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath.indexOf("..") >= 0 || urlPath.indexOf("\0") >= 0){
    reply(res, 403, "text/plain; charset=utf-8", "403 Forbidden");
    return;
  }

  var filePath = path.resolve(path.join(ROOT, urlPath));
  var rel = path.relative(ROOT, filePath);
  if (rel.indexOf("..") === 0 || path.isAbsolute(rel)){
    reply(res, 403, "text/plain; charset=utf-8", "403 Forbidden");
    return;
  }

  fs.stat(filePath, function(err, st){
    if (err || !st.isFile()){
      reply(res, 404, "text/plain; charset=utf-8", "404 Not Found");
      return;
    }
    var type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Cache-Control": "no-store"
    });
    if (req.method === "HEAD"){ res.end(); return; }
    fs.createReadStream(filePath).on("error", function(){ res.end(); }).pipe(res);
  });
});

function banner(port){
  var line = "================================================================";
  var list = lanAddresses();
  console.log("");
  console.log(line);
  console.log("  拼豆豆图生成器 —— 平板/手机访问服务已启动");
  console.log(line);
  console.log("");
  console.log("  在 平板 / 手机 的 Safari 里打开下面任一地址：");
  console.log("");
  if (list.length === 0){
    console.log("     （没检测到局域网地址，先连上 Wi-Fi 再重开本程序）");
  }
  list.forEach(function(ip){
    console.log("         http://" + ip + ":" + port);
  });
  console.log("");
  console.log("  这台电脑上用浏览器打开：  http://localhost:" + port);
  console.log("");
  console.log("  ★ 手机/平板必须和这台电脑连同一个 Wi-Fi");
  console.log("  ★ 用手机相机扫一下旁边的 qr.png 也能直接打开");
  console.log("  ★ 这个黑窗口关掉 = 服务停止");
  console.log(line);
  console.log("");
  openHelpers(port);
}

/* 启动后顺手：① 在本机弹二维码 ② 在本机浏览器打开一份（都不重要，失败也不影响服务） */
function openHelpers(port){
  if (process.env.PINDOU_NO_OPEN) return;
  if (process.platform !== "win32") return;
  var qr = path.join(ROOT, "qr.png");
  try {
    if (fs.existsSync(qr)) exec('start "" "' + qr + '"');
  } catch (e) {}
  try {
    exec('start "" "http://localhost:' + port + '"');
  } catch (e) {}
}

function boot(port, attempt){
  server.once("error", function(e){
    if (e && (e.code === "EADDRINUSE" || e.code === "EACCES") && attempt + 1 < MAX_TRIES){
      console.log("端口 " + port + " 用不了（" + e.code + "），换成 " + (port + 1) + " 再试…");
      boot(port + 1, attempt + 1);
    } else {
      console.log("启动失败：" + (e && e.message ? e.message : e));
      console.log("按 Ctrl+C 退出。");
    }
  });
  server.listen(port, "0.0.0.0", function(){ banner(port); });
}

boot(START_PORT, 0);
