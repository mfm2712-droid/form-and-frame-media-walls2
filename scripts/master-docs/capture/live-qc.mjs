// Live Master viewport QC. Needs puppeteer-core (installed outside the repo) and Chrome. Usage: node live-qc.mjs
import puppeteer from "puppeteer-core";
const url="file://"+new URL("../../../docs/master/live/index.html", import.meta.url).pathname;
const b=await puppeteer.launch({executablePath:"/usr/bin/google-chrome",headless:true,args:["--no-sandbox","--allow-file-access-from-files"]});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for (const [name,w,h,mob] of [["desktop-1440",1440,900,0],["laptop-1024",1024,768,0],["tablet-768",768,1024,1],["mobile-390",390,844,1],["mobile-360",360,740,1]]) {
  const p=await b.newPage(); const ext=[],errs=[];
  await p.setViewport({width:w,height:h,isMobile:!!mob&&w<500,hasTouch:!!mob});
  p.on("request",r=>{const u=r.url();if(!u.startsWith("file:")&&!u.startsWith("data:"))ext.push(u)});p.on("pageerror",e=>errs.push(String(e)));p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
  await p.goto(url);await sleep(600);
  const r={};
  r.overflowPx=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  r.wideElems=await p.evaluate(()=>[...document.querySelectorAll("main *, article *, body > *")].filter(e=>{const b=e.getBoundingClientRect();return b.right>innerWidth+2&&!e.closest(".tablewrap,pre,#nav,#lb")&&b.width>0}).slice(0,5).map(e=>e.tagName+"."+e.className));
  const menuVis=await p.evaluate(()=>{const n=document.getElementById("nav").getBoundingClientRect();return n.right>0&&n.left<innerWidth&&n.width>0});
  r.menuVisibleInitially=menuVis;
  if(w<=900){ const hasBtn=await p.evaluate(()=>{const m=document.getElementById("menu");return !!m&&getComputedStyle(m).display!=="none"}); r.menuButtonShown=hasBtn; if(hasBtn){await p.click("#menu");await sleep(400);r.menuOpensNav=await p.evaluate(()=>{const n=document.getElementById("nav").getBoundingClientRect();return n.right>0&&n.left<innerWidth&&n.width>50});}}
  const navLinks=await p.evaluate(()=>document.querySelectorAll("#nav a").length); r.navLinks=navLinks;
  // click 3 nav links
  r.navClicks=[];
  for (const i of [5,40,navLinks-1]) {
    if(w<=900 && !(await p.evaluate(()=>document.getElementById("nav").getBoundingClientRect().right>0))) {await p.click("#menu");await sleep(300)}
    const res=await p.evaluate(i=>{const a=document.querySelectorAll("#nav a")[i];const h=a.getAttribute("href");a.click();return h},i);await sleep(500);
    r.navClicks.push(await p.evaluate(h=>{const t=document.getElementById(h.slice(1));return {h,found:!!t,top:t?Math.round(t.getBoundingClientRect().top):null}},res));
  }
  // search
  if(w<=900){const open=await p.evaluate(()=>document.getElementById("nav").getBoundingClientRect().right>0); if(!open){await p.click("#menu");await sleep(300)}}
  await p.evaluate(()=>{const q=document.getElementById("q");q.value="invoice";q.dispatchEvent(new Event("input"))});await sleep(300);
  r.searchResults=await p.evaluate(()=>document.querySelectorAll("#results a").length);
  r.searchNav=null; if(r.searchResults){const href=await p.evaluate(()=>{const a=document.querySelector("#results a");const h=a.getAttribute("href");a.click();return h});await sleep(400);r.searchNav=await p.evaluate(h=>({href:h,hash:location.hash,found:!!document.getElementById(h.slice(1))}),href)}
  await p.evaluate(()=>{const q=document.getElementById("q");q.value="";q.dispatchEvent(new Event("input"))});
  // lightbox
  await p.evaluate(()=>{const i=document.querySelector("img.zoomable");i.scrollIntoView();i.click()});await sleep(500);
  r.lightboxOpen=await p.evaluate(()=>document.getElementById("lb").classList.contains("on"));
  await p.keyboard.press("Escape");await sleep(300);
  r.lightboxClosesOnEsc=await p.evaluate(()=>!document.getElementById("lb").classList.contains("on"));
  // all images load (force eager)
  await p.evaluate(()=>document.querySelectorAll("img").forEach(i=>i.loading="eager"));await sleep(1500);
  r.images=await p.evaluate(()=>({total:document.images.length,broken:[...document.images].filter(i=>i.complete&&i.naturalWidth===0).length}));
  r.tablesWider=await p.evaluate(()=>[...document.querySelectorAll(".tablewrap")].filter(t=>t.scrollWidth>t.clientWidth+1).length);
  await p.screenshot({path:`/tmp/live-${name}.png`});
  console.log(name,JSON.stringify(r),"external:",ext.length,"errors:",errs.length?errs:0);
  await p.close();
}
await b.close();
