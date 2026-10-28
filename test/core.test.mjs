import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../src/core.js');
const PAL = require('../src/palettes.js');

test('CIEDE2000 matches Sharma reference pairs', () => {
  const pairs = [
    [[50,2.6772,-79.7751],[50,0,-82.7485],2.0425],
    [[50,3.1571,-77.2803],[50,0,-82.7485],2.8615],
    [[50,2.8361,-74.0200],[50,0,-82.7485],3.4412],
    [[50,-1.3802,-84.2814],[50,0,-82.7485],1.0000],
    [[50,0,0],[50,-1,2],2.3669]
  ];
  for (const [a,b,want] of pairs) assert.ok(Math.abs(Core.deltaE2000(a,b)-want) < 0.005, JSON.stringify([a,b,Core.deltaE2000(a,b),want]));
});

test('linear-light downsample is not sRGB average', () => {
  // 1x1 target from a 2x2 source: two black + two white pixels
  const data = new Uint8ClampedArray([0,0,0,255, 255,255,255,255, 0,0,0,255, 255,255,255,255]);
  const out = Core.sampleCells({data,width:2,height:2}, 2, 2, 1, 1, {fit:'cover'});
  const c = out.colors[0][0];
  // linear average = 0.5 -> sRGB ~188; naive sRGB average would be 128
  assert.ok(c[0] >= 186 && c[0] <= 190, 'got ' + c[0]);
  assert.equal(c[0], c[1]); assert.equal(c[1], c[2]);
});

test('alpha composites over white', () => {
  const data = new Uint8ClampedArray([255,0,0,0]); // transparent red -> white
  const out = Core.sampleCells({data,width:1,height:1}, 1, 1, 1, 1, {fit:'cover'});
  assert.deepEqual(out.colors[0][0], [255,255,255]);
});

test('cover/contain geometry', () => {
  // 40x10 source: contain into 10x10 leaves white top/bottom
  const w=40,h=10, data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){ data[i*4]=255; data[i*4+1]=0; data[i*4+2]=0; data[i*4+3]=255; }
  const contain = Core.sampleCells({data,width:w,height:h}, w, h, 10, 10, {fit:'contain'});
  assert.deepEqual(contain.colors[0][0], [255,255,255]);
  assert.equal(contain.colors[5][5][0], 255);
  assert.equal(contain.colors[5][5][1], 0);
});

test('palettes compile and stay in range', () => {
  for (const key of ['common424','common96','common48','common24','dbk221']) {
    const pal = Core.compilePalette(PAL[key]);
    assert.ok(pal.length > 0);
    for (const p of pal) {
      assert.ok(p.hex.startsWith('#') && p.hex.length === 7);
      assert.ok(p.rgb.every(v => v >= 0 && v <= 255));
      assert.ok(p.lab.every(Number.isFinite) && p.oklab.every(Number.isFinite));
    }
  }
  assert.equal(PAL.common424.length, 424);
  assert.equal(PAL.common96.length, 96);
  assert.equal(PAL.common48.length, 48);
  assert.equal(PAL.common24.length, 24);
  assert.equal(PAL.dbk221.length, 221);
});

test('flat colour maps to nearest bead; counts add up', () => {
  const w=8,h=8, data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){ data[i*4]=215; data[i*4+1]=32; data[i*4+2]=32; data[i*4+3]=255; }
  const img={data,width:w,height:h};
  const pal=Core.compilePalette(PAL.common424);
  const sample=Core.sampleCells(img,w,h,4,4,{fit:'cover'});
  const res=Core.convertCells(sample,4,4,pal,{adj:{bright:0,contrast:0,sat:0}});
  assert.equal(res.totalBeads, 16);
  assert.equal(res.usedColors, 1);
  assert.equal(res.counts[res.grid[0][0]], 16);
  const bead=pal[res.grid[0][0]].rgb;
  assert.ok(Core.deltaE2000(Core.rgbToLab(215,32,32), Core.rgbToLab(...bead)) < 8);
});

test('background removal empties bright cells', () => {
  const w=6,h=6, data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const i=(y*w+x)*4; const white = y<3; data[i]=data[i+1]=data[i+2]=white?255:20; data[i+3]=255; }
  const img={data,width:w,height:h};
  const pal=Core.compilePalette(PAL.common24);
  const sample=Core.sampleCells(img,w,h,6,6,{fit:'cover'});
  const res=Core.convertCells(sample,6,6,pal,{removeBg:true,bgThresh:242});
  assert.equal(res.grid[0][0], null);
  assert.notEqual(res.grid[5][0], null);
});

test('maxColors limits used colours', () => {
  const w=24,h=24, data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const i=(y*w+x)*4; data[i]=x*11; data[i+1]=y*11; data[i+2]=(x*y)%255; data[i+3]=255; }
  const img={data,width:w,height:h};
  const pal=Core.compilePalette(PAL.common424);
  const sample=Core.sampleCells(img,w,h,8,8,{fit:'cover'});
  const free=Core.convertCells(sample,8,8,pal,{});
  assert.ok(free.usedColors > 8);
  const limited=Core.convertCells(sample,8,8,pal,{maxColors:6});
  assert.ok(limited.usedColors <= 6, 'used ' + limited.usedColors);
  assert.equal(limited.totalBeads, 64);
});

test('dither is deterministic and stays in palette', () => {
  const w=20,h=20, data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){ data[i*4]=i%255; data[i*4+1]=128; data[i*4+2]=255-(i%255); data[i*4+3]=255; }
  const img={data,width:w,height:h};
  const pal=Core.compilePalette(PAL.common96);
  const sample=Core.sampleCells(img,w,h,10,10,{fit:'cover'});
  const a=Core.convertCells(sample,10,10,pal,{dither:true});
  const b=Core.convertCells(sample,10,10,pal,{dither:true});
  assert.deepEqual(a.grid, b.grid);
  for (const row of a.grid) for (const v of row) assert.ok(v === null || (v >= 0 && v < pal.length));
});

test('CSV and project export', () => {
  const pal=Core.compilePalette(PAL.common24);
  const grid=[[0,1],[null,2]];
  const counts=new Array(pal.length).fill(0); counts[0]=1; counts[1]=1; counts[2]=1;
  const csv=Core.gridToCSV(grid,pal,'hex');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.split('\r\n')[0].split(',').length === 2);
  const proj=Core.buildProject({palette:pal,grid:grid,counts:counts,cols:2,rows:2,totalBeads:3});
  assert.equal(proj.version,2);
  assert.equal(proj.colorCount,3);
  assert.deepEqual(proj.grid,[[0,1],[-1,2]]);
});

test('palette text parser', () => {
  const pal=Core.parsePaletteText('大红,#D72C2C\n天蓝,127,200,240\n#FFFFFF\n坏行,zzz');
  assert.equal(pal.length,3);
  assert.equal(pal[0].hex,'#D72C2C');
  assert.deepEqual(pal[1].rgb,[127,200,240]);
  assert.equal(pal[2].hex,'#FFFFFF');
});