import puppeteer from "puppeteer-core";
const out="/workspace/frame-scratch/mb/shots/staff-demo"; const wait=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({executablePath:"/usr/bin/google-chrome",headless:true,args:["--no-sandbox","--hide-scrollbars"]});
async function pg(w,h,m){const p=await browser.newPage();await p.setViewport({width:w,height:h,deviceScaleFactor:m?2:1,isMobile:!!m,hasTouch:!!m});await p.setRequestInterception(true);p.on("request",r=>/supabase\.co/.test(r.url())?r.abort():r.continue());return p;}
const OPS="http://127.0.0.1:8802/operations/";
{const p=await pg(1440,900);await p.goto(OPS,{waitUntil:"networkidle2"});await wait(2000);
 const g=await p.$(".workgrid");await g.scrollIntoView();await wait(300);await g.screenshot({path:`${out}/desktop-1440-workgrid.png`});
 await p.evaluate(()=>{document.querySelector("#business details.invoice-create").open=true});
 const b=await p.$("#business");await b.scrollIntoView();await wait(300);await b.screenshot({path:`${out}/desktop-1440-money-invoice-form.png`});
 await p.close();}
{const p=await pg(390,844,true);await p.goto(OPS,{waitUntil:"networkidle2"});await wait(2000);
 await p.evaluate(()=>document.querySelector('.mobile-nav button[data-mobile-view="work"]').click());await wait(600);
 await p.evaluate(()=>{const b=document.querySelector(".lead .ws-open, .lead");b.click()});await wait(1200);
 await p.screenshot({path:`${out}/mobile-390-enquiry-workspace.png`});await p.close();}
await browser.close();
