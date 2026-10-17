import http from "node:http"; import { readFile } from "node:fs/promises"; import { extname, join } from "node:path";
const [,, root, port] = process.argv;
const types={".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".json":"application/json",".webmanifest":"application/manifest+json",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp",".jpg":"image/jpeg"};
http.createServer(async (req,res)=>{ let p=decodeURIComponent(req.url.split("?")[0]); if(p.endsWith("/")) p+="index.html"; try{ const b=await readFile(join(root,p)); res.writeHead(200,{"content-type":types[extname(p)]||"application/octet-stream"}); res.end(b);}catch{res.writeHead(404);res.end("nf");} }).listen(+port,"127.0.0.1");
