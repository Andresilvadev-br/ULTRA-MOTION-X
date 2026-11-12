#!/usr/bin/env node
/** Safe local static server for Ultra Motion X Studio and its built Web SDK. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const host="127.0.0.1", port=Number(process.env.UMX_STUDIO_PORT||4173);
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".wasm":"application/wasm",".svg":"image/svg+xml"};
const server=createServer(async(req,res)=>{
  if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405);res.end();return;}
  try {
    const url=new URL(req.url||"/","http://localhost");
    const path=url.pathname==="/"?"/studio/index.html":decodeURIComponent(url.pathname);
    const target=resolve(root,"."+path);
    if(!(target===root||target.startsWith(root+sep))){res.writeHead(403);res.end();return;}
    const info=await stat(target);
    if(!info.isFile()){res.writeHead(404);res.end();return;}
    const data=await readFile(target);
    res.writeHead(200,{"Content-Type":types[extname(target)]||"application/octet-stream","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
    res.end(req.method==="HEAD"?undefined:data);
  }catch{res.writeHead(404,{"Content-Type":"text/plain"});res.end("Not found");}
});
server.listen(port,host,()=>console.log(`Ultra Motion Studio: http://${host}:${port}\nRun npm ci && npm run build before opening Studio.`));
