import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
const out = "/workspace/frame-scratch/mb/shots";
for (const d of ["public","staff-demo","staff-login"]) mkdirSync(`${out}/${d}`, {recursive:true});
const browser = await puppeteer.launch({ executablePath:"/usr/bin/google-chrome", headless:true, args:["--no-sandbox","--hide-scrollbars"] });
const log = [];
async function page(w,h,mobile){
  const p = await browser.newPage();
  await p.setViewport({width:w,height:h,deviceScaleFactor:mobile?2:1,isMobile:!!mobile,hasTouch:!!mobile});
  await p.setRequestInterception(true);
  p.on("request", r => { const u=r.url(); if (/supabase\.co/.test(u)) { log.push("BLOCKED "+u); r.abort(); } else r.continue(); });
  return p;
}
const wait = ms => new Promise(r=>setTimeout(r,ms));
async function shot(p,name,opts={}){ await p.screenshot({path:`${out}/${name}.png`,...opts}); console.log(name); }
async function sectionShots(p,prefix,ids){
  await p.addStyleTag({content:".nav{position:static!important}.chat-launch{display:none!important}"});
  for (const id of ids){ const el = await p.$(id); if(!el) { console.log("missing",id); continue;} await el.scrollIntoView(); await wait(400); await el.screenshot({path:`${out}/${prefix}-${id.replace(/[^a-z0-9]/gi,"")}.png`}); console.log(prefix,id); }
}
const PUB = "http://127.0.0.1:8801/";
const secs = ["#drawing","#survey","#specify","#process","#works","#testimonials","#request","footer.foot"];
for (const [tag,w,h,m] of [["desktop-1440",1440,900,false],["mobile-390",390,844,true]]){
  const p = await page(w,h,m);
  await p.goto(PUB,{waitUntil:"networkidle2"}); await wait(1500);
  await shot(p,`public/full-${tag}`,{fullPage:true});
  await shot(p,`public/fold-${tag}`);
  await sectionShots(p,`public/sec-${tag}`,secs);
  await p.close();
}
// public extras: mobile nav open, chat open
{ const p = await page(390,844,true); await p.goto(PUB,{waitUntil:"networkidle2"}); await wait(800);
  await p.click("#navToggle"); await wait(500); await shot(p,"public/mobile-390-nav-open");
  await p.evaluate(()=>document.getElementById("chatLaunch").click()); await wait(600); await shot(p,"public/mobile-390-chat-open"); await p.close(); }
{ const p = await page(1440,900); await p.goto(PUB,{waitUntil:"networkidle2"}); await wait(800);
  await p.evaluate(()=>document.getElementById("chatLaunch").click()); await wait(600); await shot(p,"public/desktop-1440-chat-open");
  await p.close(); }
// public form validation + dark theme
{ const p = await page(1440,900); await p.goto(PUB,{waitUntil:"networkidle2"}); await wait(800);
  await p.addStyleTag({content:".nav{position:static!important}.chat-launch{display:none!important}"}); await p.evaluate(()=>document.getElementById("request").scrollIntoView()); await p.click("#formSubmit"); await wait(500);
  await (await p.$("#request")).screenshot({path:`${out}/public/form-validation-desktop-1440.png`});
  await p.emulateMediaFeatures([{name:"prefers-color-scheme",value:"dark"}]); await p.reload({waitUntil:"networkidle2"}); await wait(1200);
  await shot(p,"public/fold-dark-desktop-1440"); await p.close(); }

// staff demo (no config.js -> built-in demo mode)
const OPS = "http://127.0.0.1:8802/operations/";
{ const p = await page(1440,900); await p.goto(OPS,{waitUntil:"networkidle2"}); await wait(2500);
  console.log(await p.evaluate(()=>document.getElementById("demoTag").hidden+" | "+document.body.innerText.slice(0,200)));
  await shot(p,"staff-demo/desktop-1440-full",{fullPage:true});
  await shot(p,"staff-demo/desktop-1440-fold");
  for (const [id,n] of [["#todayMoney","today-money"],[".today-panel","today-plan"],["#stats","metrics"],["#leads","enquiries"],["#availability","calendar"],["#business","money"]]){ const el=await p.$(id); if(el){ await el.scrollIntoView(); await wait(300); await el.screenshot({path:`${out}/staff-demo/desktop-1440-${n}.png`}); console.log(n);} }
  // enquiry workspace
  const open = await p.$(".lead .ws-open, .lead");
  if (open){ await open.scrollIntoView(); await open.click(); await wait(1200); await shot(p,"staff-demo/desktop-1440-enquiry-workspace");
    const wsFull = await p.$("#workspace"); if (wsFull) await wsFull.screenshot({path:`${out}/staff-demo/desktop-1440-enquiry-workspace-full.png`}); }
  await p.close(); }
{ const p = await page(390,844,true); await p.goto(OPS,{waitUntil:"networkidle2"}); await wait(2500);
  for (const v of ["today","work","calendar","money"]){ await p.evaluate(v=>{ const b=document.querySelector(`.mobile-nav button[data-mobile-view="${v}"]`); b&&b.click(); },v); await wait(700); await p.evaluate(()=>scrollTo(0,0)); await shot(p,`staff-demo/mobile-390-${v}-full`,{fullPage:true}); await shot(p,`staff-demo/mobile-390-${v}-fold`); }
  await p.close(); }
// staff login screen: built site with fictional config, Supabase requests aborted by this script
{ const p = await page(1440,900); await p.goto("http://127.0.0.1:8801/operations/",{waitUntil:"networkidle2"}); await wait(2500);
  await shot(p,"staff-login/desktop-1440"); await p.close(); }
{ const p = await page(390,844,true); await p.goto("http://127.0.0.1:8801/operations/",{waitUntil:"networkidle2"}); await wait(2500);
  await shot(p,"staff-login/mobile-390"); await p.close(); }
console.log(log.length+" supabase requests blocked", [...new Set(log)].slice(0,5));
await browser.close();
