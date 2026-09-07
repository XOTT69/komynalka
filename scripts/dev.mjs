import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import worker from '../worker.js';
import {environment} from './local-worker.mjs';
import {demoAccount,demoPassHash} from './demo-data.mjs';
const demo=process.argv.includes('--demo'),port=demo?4174:4173;
execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
const root=path.resolve('dist'),{env}=environment({demo:demoAccount});
env.ALLOWED_ORIGINS='http://127.0.0.1:4174';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf'};
createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(demo&&url.pathname==='/__demo/api'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const request=new Request('https://local.invalid'+url.search,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
      const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    if((await stat(file)).isDirectory())file=path.join(file,'index.html');
    let data=await readFile(file);
    if(demo&&path.basename(file)==='app.js')data=Buffer.from(data.toString().replace(/https:\/\/komunproga\.mikolenko-anton1\.workers\.dev/g,`http://127.0.0.1:${port}/__demo/api`));
    if(demo&&path.basename(file)==='sw.js'){res.writeHead(404);return res.end();}
    if(demo&&path.basename(file)==='index.html'){
      let html=data.toString().replace(/<script async src="https:\/\/www.googletagmanager[^>]*><\/script>/g,'');
      const bootstrap=`<script>localStorage.setItem('k_login','demo');localStorage.setItem('k_passHash','${demoPassHash}');const demoAuth={currentUser:null,onAuthStateChanged(cb){setTimeout(()=>cb(null),0);return()=>{};},signOut:async()=>{}};window.firebase={initializeApp(){},auth:()=>demoAuth};window.firebase.auth.GoogleAuthProvider=class{};</script>`;
      html=html.replace('<script src="app.js"',bootstrap+'<script src="app.js"');
      html=html.replace('</body>','<div style="position:fixed;top:0;left:0;right:0;z-index:9999;padding:3px 12px;background:#2456bd;color:white;text-align:center;font:12px sans-serif;pointer-events:none">Демонстрація · вигадані дані · зміни лише в цьому перегляді</div></body>');
      data=Buffer.from(html);
    }
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Local${demo?' demo':''}: http://127.0.0.1:${port}`));
