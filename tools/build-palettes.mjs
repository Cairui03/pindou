import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERIES = ['mard','hama','hama_maxi','hama_mini','perler','perler_caps','perler_mini','artkal_s','artkal_a','artkal_c','artkal_m','artkal_r','yant','nabbi'];
const clamp255 = v => Math.max(0, Math.min(255, v));
const srgbToLinear = v => { const c=v/255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
function rgbToOklab(r,g,b){
  const rl=srgbToLinear(r), gl=srgbToLinear(g), bl=srgbToLinear(b);
  const l=Math.cbrt(0.4122214708*rl+0.5363325363*gl+0.0514459929*bl);
  const m=Math.cbrt(0.2119034982*rl+0.6806995451*gl+0.1073969566*bl);
  const s=Math.cbrt(0.0883024619*rl+0.2817188376*gl+0.6299787005*bl);
  return [0.2104542553*l+0.793617785*m-0.0040720468*s, 1.9779984951*l-2.428592205*m+0.4505937099*s, 0.0259040371*l+0.7827717662*m-0.808675766*s];
}
const oklabDist = (a,b) => { const dl=a[0]-b[0], da=a[1]-b[1], db=a[2]-b[2]; return Math.sqrt(dl*dl+da*da+db*db); };
const hex = (r,g,b) => '#'+[r,g,b].map(v=>clamp255(Math.round(v)).toString(16).padStart(2,'0')).join('').toUpperCase();

const all = [];
for (const s of SERIES) {
  const csv = fs.readFileSync(path.join(ROOT,'data/beadcolors',s+'.csv'),'utf8');
  for (const line of csv.split(/\r?\n/)) {
    const p=line.split(','); if(p.length<6) continue;
    const r=+p[3], g=+p[4], b=+p[5];
    if(!(r>=0&&r<=255&&g>=0&&g<=255&&b>=0&&b<=255)) continue;
    all.push({code:p[0], name:p[1], brand:s, hex:hex(r,g,b), rgb:[r,g,b]});
  }
}
const unique = new Map();
for (const c of all) if (!unique.has(c.hex)) unique.set(c.hex, c);
const colors = [...unique.values()];
for (const c of colors) c.oklab = rgbToOklab(c.rgb[0],c.rgb[1],c.rgb[2]);
console.error('bead colours: rows', all.length, 'unique', colors.length);

function medoids(K, iters) {
  if (colors.length <= K) return colors.slice();
  let mean=[0,0,0]; for(const c of colors){mean[0]+=c.oklab[0];mean[1]+=c.oklab[1];mean[2]+=c.oklab[2];} mean=mean.map(v=>v/colors.length);
  const sel=[]; let far=0, fd=-1;
  for(let i=0;i<colors.length;i++){ const d=oklabDist(mean,colors[i].oklab); if(d>fd){fd=d;far=i;} }
  sel.push(far);
  while(sel.length<K){
    let best=-1, bd=-1;
    for(let i=0;i<colors.length;i++){
      let md=Infinity;
      for(const j of sel){ const d=oklabDist(colors[i].oklab,colors[j].oklab); if(d<md) md=d; }
      if(md>bd){bd=md;best=i;}
    }
    sel.push(best);
  }
  let cents=sel.map(i=>colors[i].oklab.slice());
  const labels=new Int16Array(colors.length); labels.fill(-1);
  for(let it=0;it<iters;it++){
    let changed=0;
    for(let i=0;i<colors.length;i++){
      let bj=0,bd=Infinity;
      for(let k=0;k<cents.length;k++){ const d=oklabDist(colors[i].oklab,cents[k]); if(d<bd){bd=d;bj=k;} }
      if(labels[i]!==bj){labels[i]=bj;changed++;}
    }
    const sums=cents.map(()=>[0,0,0,0]);
    for(let i=0;i<colors.length;i++){ const s=sums[labels[i]]; s[0]+=colors[i].oklab[0];s[1]+=colors[i].oklab[1];s[2]+=colors[i].oklab[2];s[3]++; }
    for(let k=0;k<cents.length;k++) if(sums[k][3]) cents[k]=[sums[k][0]/sums[k][3],sums[k][1]/sums[k][3],sums[k][2]/sums[k][3]];
    if(!changed) break;
  }
  const picked=new Set(); const out=[];
  for(const c of cents){
    let bi=0,bd=Infinity;
    for(let i=0;i<colors.length;i++){ const d=oklabDist(c,colors[i].oklab); if(d<bd){bd=d;bi=i;} }
    if(!picked.has(bi)){ picked.add(bi); out.push(colors[bi]); }
  }
  // fill to K if snapping collapsed some centroids
  if(out.length<K){
    for(let i=0;i<colors.length && out.length<K;i++){ if(!picked.has(i)){ picked.add(i); out.push(colors[i]); } }
  }
  return out.slice(0,K);
}

const HUE_NAMES = [[15,'红'],[38,'朱红'],[62,'橙'],[86,'橙黄'],[108,'黄'],[132,'黄绿'],[158,'草绿'],[182,'青绿'],[202,'青'],[228,'天蓝'],[258,'蓝'],[288,'蓝紫'],[315,'紫'],[334,'紫红'],[360,'玫红']];
function nameOf(c){
  const [L,a,b]=c.oklab;
  const C=Math.sqrt(a*a+b*b);
  let h=Math.atan2(b,a)*180/Math.PI; if(h<0) h+=360;
  let hue='红'; for(const [max,n] of HUE_NAMES){ if(h<max){ hue=n; break; } }
  if(L>0.965 && C<0.03) return '白';
  if(L<0.16 && C<0.03) return '黑';
  if(C<0.03) return L<0.34?'深灰':L<0.5?'暗灰':L<0.68?'中灰':L<0.84?'浅灰':'灰白';
  if(C<0.055){ const t=L<0.34?'深':L>0.82?'浅':''; return t+'灰'+hue; }
  if(C>0.17){ const t=L<0.32?'深':L<0.46?'暗':L>0.8?'亮':''; return t+'艳'+hue; }
  const tone = L<0.32?'深':L<0.46?'暗':L>0.84?'浅':L>0.72?'亮':'';
  return tone+hue;
}
function makeList(list){
  const used={};
  return list.map(c=>{
    let n=nameOf(c);
    if(used[n]){ used[n]++; n=n+(used[n]); } else used[n]=1;
    return [n, c.hex];
  });
}
const sizes=[424,96,48,24];
const out={};
for(const K of sizes){
  const list=medoids(K, 10);
  out['common'+K]=makeList(list);
  console.error('common'+K, list.length);
}
out.dbk221 = JSON.parse(fs.readFileSync(path.join(ROOT,'data/dbk221.json'),'utf8'));

const lines=[
  '/* 自动生成：node tools/build-palettes.mjs  — 请勿手改。 */',
  '/* 通用色卡的真实豆色数据来自 maxcleme/beadcolors (MIT License)，按 Oklab 距离聚类到 424/96/48/24 色。 */',
  'var PINDOU_PALETTES = {'
];
for(const [k,v] of Object.entries(out)){
  lines.push('  '+JSON.stringify(k)+': [');
  for(let i=0;i<v.length;i+=6){
    lines.push('    '+v.slice(i,i+6).map(p=>JSON.stringify(p)).join(', ') + (i+6<v.length?',':''));
  }
  lines.push('  ],');
}
lines.push('};');
lines.push('if (typeof module !== "undefined" && module.exports) module.exports = PINDOU_PALETTES;');
fs.writeFileSync(path.join(ROOT,'src/palettes.js'), lines.join('\n')+'\n');
console.error('wrote src/palettes.js', fs.statSync(path.join(ROOT,'src/palettes.js')).size, 'bytes');