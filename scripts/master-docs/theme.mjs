// CSS and browser JavaScript for the two renderings. Brand colours come from the staff app tokens documented in design-system.md.
export const baseCss = `
:root{--paper:#F1ECDF;--card:#FBF8F0;--ink:#1D211C;--green:#0E342C;--green2:#123B32;--gold:#C99B55;--oak:#B4823F;--muted:#5d655c;--line:#d9d2c0;
--ok:#1E7B4F;--blue:#3F6E9A;--amber:#B7791F;--bad:#B3261E;--violet:#7A5AA6;--grey:#6B6B6B}
*{box-sizing:border-box}
body{margin:0;font-family:"DM Sans","Inter",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--paper);line-height:1.55;font-size:16px}
h1,h2,h3,h4{font-family:"Bricolage Grotesque","DM Sans",system-ui,sans-serif;color:var(--green);line-height:1.15;letter-spacing:-.01em}
h1{font-size:2.1rem;margin:0 0 .6em}h2{font-size:1.45rem;margin:1.8em 0 .5em;border-top:1px solid var(--line);padding-top:.7em}h3{font-size:1.15rem;margin:1.4em 0 .4em}h4{font-size:1rem}
code,pre{font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;font-size:.86em}
code{background:#e8e2d1;padding:.08em .32em;border-radius:3px;overflow-wrap:anywhere}
pre{background:#1D211C;color:#F1ECDF;padding:12px 14px;border-radius:6px;overflow:auto}pre code{background:none;padding:0}
a{color:#0b5a49}a.ext::after{content:" \\2197";font-size:.8em}a.ev{font-family:"IBM Plex Mono",monospace;font-size:.78em;text-decoration:none;background:#e8e2d1;border-radius:3px;padding:0 .3em;color:var(--green)}
p{margin:.6em 0}ul,ol{padding-left:1.3em}li{margin:.2em 0}
.tablewrap{overflow-x:auto;margin:1em 0}
table{border-collapse:collapse;width:100%;font-size:.88em;background:var(--card)}
th{background:var(--green);color:#F1ECDF;text-align:left;font-weight:600;padding:7px 9px;font-family:"DM Sans",sans-serif}
td{padding:6px 9px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
tr:nth-child(even) td{background:#f6f2e7}
td.m-yes{background:#dcebdd!important}td.m-no{background:#f2d4d0!important;color:#7b1c15;font-weight:600}td.m-part{background:#f6e6c3!important}
.badge{display:inline-block;font:600 .72em "IBM Plex Mono",monospace;letter-spacing:.02em;padding:.18em .55em;border-radius:99px;color:#fff;white-space:nowrap}
.s-implemented{background:var(--blue)}.s-verified{background:var(--ok)}.s-partial{background:var(--amber)}.s-broken{background:var(--bad)}
.s-planned{background:#fff;color:var(--violet);border:1.5px dashed var(--violet)}.s-not-implemented{background:var(--grey)}.s-blocked{background:#3a2a10}
.fig{margin:1.2em 0;text-align:center;break-inside:avoid}
.fig img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:#fff}
.fig figcaption{font-size:.82em;color:var(--muted);margin-top:.4em}
.callout{border-left:5px solid var(--oak);background:var(--card);padding:.6em 1em;margin:1em 0;border-radius:0 6px 6px 0;break-inside:avoid}
.callout p:first-child{margin-top:0}.callout p:last-child{margin-bottom:0}
.callout.demo{border-color:var(--blue);background:#e6eef5}.callout.warn{border-color:var(--bad);background:#f8e4e1}
.callout.pending{border-color:var(--amber);background:#f9edd2}.callout.notverifiable{border-color:var(--grey);background:#ecebe7;border-style:dashed none dashed solid}
.callout.note{border-color:var(--green)}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin:1em 0}
.swatch{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px;display:grid;gap:2px;break-inside:avoid}
.swatch .chip{height:38px;border-radius:4px;border:1px solid rgba(0,0,0,.15)}.swatch small{color:var(--muted);font-size:.75em}
hr{border:0;border-top:1px solid var(--line)}
img{max-width:100%;height:auto}td img{display:block;margin:auto;border:1px solid var(--line);border-radius:4px}
`;

export const liveCss = `
body{display:flex;min-height:100vh}
#side{position:fixed;inset:0 auto 0 0;width:310px;background:var(--green);color:#F1ECDF;overflow-y:auto;padding:16px 14px 40px;z-index:20}
#side h1{color:#F1ECDF;font-size:1.15rem;margin:0}#side .ver{font-size:.75rem;color:#c9d6cf;margin:.2em 0 .8em}
#side input{width:100%;padding:9px 10px;border-radius:6px;border:0;font:inherit;background:#F1ECDF}
#side nav a{display:block;color:#e7efe9;text-decoration:none;padding:5px 8px;border-radius:5px;font-size:.9rem}
#side nav a:hover,#side nav a.on{background:rgba(255,255,255,.12)}
#side nav .ch{font-weight:700;margin-top:6px}#side nav .sub{padding-left:20px;font-size:.8rem;color:#c9d6cf;display:none}
#side nav .open .sub,#side nav .sub.open{display:block}
#results{margin-top:10px}#results a{color:#F1ECDF;font-weight:600;background:rgba(255,255,255,.07);margin:4px 0;white-space:normal}#results small{display:block;color:#c9d6cf;font-size:.75rem}
#results mark{background:var(--gold);color:#1D211C;border-radius:2px}
main{margin-left:310px;max-width:1080px;padding:0 40px 80px;width:calc(100% - 310px);box-sizing:border-box}
.cover{background:var(--green);color:#F1ECDF;margin:0 -40px 30px;padding:46px 40px}
.cover h1{color:#F1ECDF;font-size:2.8rem}.cover p{color:#d6e0da;max-width:46em}.cover .tag{display:inline-block;background:var(--gold);color:#1D211C;font:600 .75rem "IBM Plex Mono",monospace;padding:.25em .7em;border-radius:99px}
section.chapter{padding-top:20px;border-top:6px solid var(--gold);margin-top:44px}
#top{display:none;position:fixed;top:0;left:0;right:0;background:var(--green);color:#F1ECDF;padding:10px 14px;z-index:30;align-items:center;gap:10px}
#top button{background:none;border:1px solid #F1ECDF;color:#F1ECDF;border-radius:6px;font-size:1.1rem;padding:2px 10px}
#lb{display:none;position:fixed;inset:0;background:#0c120f;z-index:100;overflow:hidden;touch-action:none}
#lb.on{display:block}#lb img{position:absolute;left:50%;top:50%;transform-origin:0 0;max-width:none;cursor:grab;user-select:none;-webkit-user-drag:none;background:#fff}
#lb .bar{position:fixed;top:10px;right:10px;display:flex;gap:6px;z-index:101}#lb .bar button{font-size:1.1rem;padding:6px 12px;border-radius:6px;border:0;background:#F1ECDF}
#lb .cap{position:fixed;left:10px;bottom:10px;right:10px;color:#F1ECDF;font-size:.85rem;z-index:101;text-align:center}
img.zoomable{cursor:zoom-in}
@media(max-width:900px){#top{display:flex}#side{transform:translateX(-100%);transition:transform .2s;width:84%}#side.open{transform:none}main{margin-left:0;width:100%;padding:60px 16px 60px}.cover{margin:0 -16px 24px;padding:30px 16px}.cover h1{font-size:2rem}}
`;

export const liveJs = `
(function(){
var idx=JSON.parse(document.getElementById('sidx').textContent);
var side=document.getElementById('side'),q=document.getElementById('q'),res=document.getElementById('results'),nav=document.getElementById('nav');
document.getElementById('menu').onclick=function(){side.classList.toggle('open')};
nav.addEventListener('click',function(e){if(e.target.tagName==='A'&&innerWidth<=900)side.classList.remove('open')});
function esc(s){return s.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
function search(){var t=q.value.trim().toLowerCase();if(t.length<2){res.innerHTML='';nav.style.display='';return}
 nav.style.display='none';var words=t.split(/\\s+/);var out=[];
 idx.forEach(function(b){var low=b.t.toLowerCase(),hl=b.h.toLowerCase();var score=0;for(var i=0;i<words.length;i++){var w=words[i];var n=low.split(w).length-1;if(!n&&hl.indexOf(w)<0){return}score+=n+(hl.indexOf(w)>=0?3:0)}out.push({b:b,s:score})});
 out.sort(function(a,b){return b.s-a.s});var html=out.length?'':'<p>No match.</p>';
 out.slice(0,40).forEach(function(o){var b=o.b,low=b.t.toLowerCase();var p=low.indexOf(words[0]);var st=Math.max(0,p-40);var sn=esc(b.t.slice(st,st+150));words.forEach(function(w){sn=sn.replace(new RegExp('('+w.replace(/[.*+?^$()|[\\]\\\\{}]/g,'\\\\$&')+')','ig'),'<mark>$1</mark>')});
  html+='<a href="#'+b.hid+'">'+esc(b.h)+'<small>'+(st?'…':'')+sn+'…</small></a>'});
 res.innerHTML=(out.length?'<p style="font-size:.8rem">'+out.length+' result'+(out.length>1?'s':'')+'</p>':'')+html}
q.addEventListener('input',search);
res.addEventListener('click',function(e){if(e.target.closest('a')&&innerWidth<=900)side.classList.remove('open')});
document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q&&!document.getElementById('lb').classList.contains('on')){e.preventDefault();side.classList.add('open');q.focus()}});
/* scroll spy */
var chs=[].slice.call(document.querySelectorAll('section.chapter'));var links={};[].forEach.call(nav.querySelectorAll('a[data-ch]'),function(a){links[a.getAttribute('data-ch')]=a});
function spy(){var cur=chs[0];chs.forEach(function(c){if(c.getBoundingClientRect().top<120)cur=c});for(var k in links){var on=k===cur.getAttribute('data-chapter');links[k].classList.toggle('on',on);links[k].parentNode.classList.toggle('open',on)}}
addEventListener('scroll',spy,{passive:true});spy();
/* lightbox */
var lb=document.getElementById('lb'),im=lb.querySelector('img'),cap=lb.querySelector('.cap');var sc=1,tx=0,ty=0,bw=0,bh=0;
function apply(){im.style.transform='translate('+tx+'px,'+ty+'px) scale('+sc+')'}
function fit(){var w=im.naturalWidth||1000,h=im.naturalHeight||700;var vw=innerWidth*.94,vh=innerHeight*.86;sc=Math.min(vw/w,vh/h);if(sc>1&&!/\\.svg/.test(im.src))sc=Math.min(sc,1);bw=w;bh=h;tx=-w*sc/2;ty=-h*sc/2;im.style.left='50%';im.style.top='50%';apply()}
function zoom(f,cx,cy){var ns=Math.max(.05,Math.min(8,sc*f));var k=ns/sc;var ox=(cx===undefined?innerWidth/2:cx)-innerWidth/2,oy=(cy===undefined?innerHeight/2:cy)-innerHeight/2;tx=ox-(ox-tx)*k;ty=oy-(oy-ty)*k;sc=ns;apply()}
document.addEventListener('click',function(e){var t=e.target;if(t.classList&&t.classList.contains('zoomable')){im.onload=fit;im.src=t.src;im.style.width='';cap.textContent=t.alt;lb.classList.add('on');if(im.complete)fit()}});
lb.querySelector('.in').onclick=function(){zoom(1.3)};lb.querySelector('.out').onclick=function(){zoom(1/1.3)};lb.querySelector('.fit').onclick=fit;
function close(){lb.classList.remove('on');im.src=''}
lb.querySelector('.x').onclick=close;document.addEventListener('keydown',function(e){if(!lb.classList.contains('on'))return;if(e.key==='Escape')close();if(e.key==='+'||e.key==='=')zoom(1.3);if(e.key==='-')zoom(1/1.3);if(e.key==='0')fit()});
lb.addEventListener('wheel',function(e){e.preventDefault();zoom(e.deltaY<0?1.15:1/1.15,e.clientX,e.clientY)},{passive:false});
var drag=null;im.addEventListener('pointerdown',function(e){drag={x:e.clientX,y:e.clientY,tx:tx,ty:ty};im.setPointerCapture(e.pointerId)});
im.addEventListener('pointermove',function(e){if(!drag)return;tx=drag.tx+e.clientX-drag.x;ty=drag.ty+e.clientY-drag.y;apply()});
im.addEventListener('pointerup',function(){drag=null});
lb.addEventListener('click',function(e){if(e.target===lb)close()});
})();
`;

export const printCss = `
@page{size:A4;margin:18mm 16mm 20mm;@bottom-left{content:"Form & Frame Master Book v" var(--v,"1.0.0") " · commit 31a08f6";font:7.5pt "DM Sans",sans-serif;color:#5d655c}@bottom-right{content:counter(page);font:8pt "IBM Plex Mono",monospace;color:#5d655c}}
@page cover{margin:0;@bottom-left{content:none}@bottom-right{content:none}}
@page wide{size:A4 landscape;margin:14mm 10mm 16mm}
body{background:#fff;font-size:9.6pt;line-height:1.45}
.cover{page:cover;background:#0E342C;color:#F1ECDF;height:297mm;padding:26mm 20mm;position:relative;break-after:page}
.cover .kick{font:600 9pt "IBM Plex Mono",monospace;color:#C99B55;letter-spacing:.12em}
.cover h1{color:#F1ECDF;font-size:44pt;line-height:1;margin:14mm 0 6mm;border:0;padding:0}
.cover .sub{font-size:14pt;max-width:140mm;color:#d6e0da}
.cover .meta{position:absolute;left:20mm;bottom:22mm;right:20mm;font-size:9pt;color:#c9d6cf;border-top:1px solid #C99B55;padding-top:5mm}
.cover .meta b{color:#F1ECDF}.cover code{background:rgba(255,255,255,.12);color:#F1ECDF}
.cover .shot{position:absolute;right:20mm;top:104mm;width:112mm;border:2px solid #C99B55;border-radius:3mm;box-shadow:0 6px 18px rgba(0,0,0,.4)}
.cover .tag{display:inline-block;background:#C99B55;color:#1D211C;font:600 8pt "IBM Plex Mono",monospace;padding:.3em .8em;border-radius:99px}
.tocpage{break-after:page}.tocpage h1{border:0}
.toc a{color:inherit;text-decoration:none}
.toc .r{display:flex;gap:6px;align-items:baseline;padding:1.2px 0}.toc .r i{flex:1;border-bottom:1px dotted #9a9484;transform:translateY(-3px)}
.toc .c{font-weight:700;margin-top:6px;color:#0E342C;font-family:"Bricolage Grotesque",sans-serif}.toc .s{padding-left:14px;font-size:8.2pt;color:#2d332c}
.toc .figs{margin-top:10px}
.chapter{break-before:page}
.chapter .kick{font:600 8pt "IBM Plex Mono",monospace;color:#B4823F;letter-spacing:.14em;margin-bottom:2mm}
.chapter>h1{font-size:25pt;border-bottom:3px solid #C99B55;padding-bottom:3mm}
h2{font-size:14pt;break-after:avoid}h3{font-size:11pt;break-after:avoid}
table{font-size:8.3pt;break-inside:auto}tr{break-inside:avoid}thead{display:table-header-group}th,td{padding:4px 6px}
.wide{page:wide}.wide table{font-size:6.8pt}.wide th,.wide td{padding:3px 4px}.wide td:last-child{white-space:nowrap}
.fig img{max-height:200mm;width:auto;max-width:100%}.fig.tall img{max-height:225mm}
.fig.diagram img{max-height:215mm;width:100%}
a.ext::after{content:none}a{color:#0b5a49}
.tablewrap{overflow:visible}td img{max-height:115mm;width:auto}td:has(img){text-align:center}
pre{white-space:pre-wrap}
`;
