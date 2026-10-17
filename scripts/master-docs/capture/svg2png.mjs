import puppeteer from "puppeteer-core"; import { readdirSync, readFileSync } from "node:fs";
const dir=process.argv[2], out=process.argv[3];
const b=await puppeteer.launch({executablePath:"/usr/bin/google-chrome",headless:true,args:["--no-sandbox"]});
for (const f of readdirSync(dir).filter(f=>f.endsWith(".svg"))) { const s=readFileSync(`${dir}/${f}`,"utf8"); const [,w,h]=/viewBox="0 0 (\d+) (\d+)"/.exec(s); const p=await b.newPage(); await p.setViewport({width:+w,height:+h,deviceScaleFactor:1}); await p.setContent(`<body style="margin:0">${s}</body>`); await p.screenshot({path:`${out}/${f.replace(".svg",".png")}`}); await p.close(); }
await b.close();
