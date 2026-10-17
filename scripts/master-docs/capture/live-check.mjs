import puppeteer from "puppeteer-core";
const url="file:///workspace/frame-work/docs/master/live/index.html";
const b=await puppeteer.launch({executablePath:"/usr/bin/google-chrome",headless:true,args:["--no-sandbox","--allow-file-access-from-files"]});
const reqs=[];const errs=[];
for (const [name,w,h] of [["desktop",1440,900],["mobile",390,844]]) {
  const p=await b.newPage(); await p.setViewport({width:w,height:h,deviceScaleFactor:1});
  p.on("request",r=>{if(!r.url().startsWith("file:")&&!r.url().startsWith("data:"))reqs.push(r.url())}); p.on("pageerror",e=>errs.push(String(e)));
  await p.goto(url); await new Promise(r=>setTimeout(r,800));
  const over=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  await p.screenshot({path:`/workspace/frame-scratch/live-${name}.png`});
  if(name==="mobile") await p.click("#menu");
  await p.type("#q","stripe"); await new Promise(r=>setTimeout(r,300));
  const n=await p.evaluate(()=>document.querySelectorAll("#results a").length);
  await p.screenshot({path:`/workspace/frame-scratch/live-${name}-search.png`});
  // click first result -> navigates
  await p.click("#results a"); await new Promise(r=>setTimeout(r,300));
  const hash=await p.evaluate(()=>location.hash);
  await p.evaluate(()=>{document.getElementById("q").value="";document.getElementById("q").dispatchEvent(new Event("input"))});
  // lightbox
  await p.evaluate(()=>{document.querySelector("img.zoomable").scrollIntoView()}); await new Promise(r=>setTimeout(r,300));
  await p.evaluate(()=>document.querySelector("img.zoomable").click()); await new Promise(r=>setTimeout(r,500));
  const lbOp=await p.evaluate(()=>Number(getComputedStyle(document.getElementById("lb")).opacity)); const lb=await p.evaluate(()=>document.getElementById("lb").classList.contains("on")); 
  await p.screenshot({path:`/workspace/frame-scratch/live-${name}-lightbox.png`});
  const broken=await p.evaluate(()=>[...document.images].filter(i=>i.loading!=="lazy"&&i.complete&&i.naturalWidth===0).length);
  const wrap=await p.evaluate(()=>{const o=[];document.querySelectorAll("table").forEach(t=>{if(/IMPLEMENTED|VERIFIED/.test(t.innerText)&&/Feature/i.test(t.innerText.slice(0,200)))o.push(t)});const badges=[...document.querySelectorAll(".st,.status,[class*=badge]")].filter(e=>/^(IMPLEMENTED|VERIFIED|PARTIAL|BROKEN|PLANNED|NOT IMPLEMENTED|BLOCKED)$/.test(e.textContent.trim()));return {matrixTables:o.length,badges:badges.length,wrapped:badges.filter(e=>e.getBoundingClientRect().height>e.ownerDocument.defaultView.getComputedStyle(e).lineHeight.replace("px","")*1.6).length}});console.log(name,{lbOpacity:lbOp,wrap,overflowPx:over,searchResults:n,hash,lightbox:lb,brokenImgs:broken});
}
console.log("external requests:",reqs.length,"page errors:",errs);
await b.close();
