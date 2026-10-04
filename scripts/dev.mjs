import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import worker from '../worker.js';
import {environment} from './local-worker.mjs';
import {demoAccount,demoPassHash} from './demo-data.mjs';
import {parseSessionToken,sessionToken,sha256Hex} from '../password-auth.js';
const pwa=process.argv.includes('--pwa'),demo=process.argv.includes('--demo')||pwa,port=Number(process.env.KOMUNALKA_PORT)||(pwa?4175:demo?4174:4173);
execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'});
const seed={demo:demoAccount};
if(process.argv.includes('--admin-load')){
 for(let i=0;i<160;i++){const data=structuredClone(demoAccount);data.displayName='Тестовий користувач '+i;data.isPro=i%4===0;data.hasGoogle=i%3===0;seed['fixture-'+String(i).padStart(3,'0')]=data;}
 for(let i=0;i<60;i++){const id=(1759220000000+i)+'-abcdefgh';seed['feedback:'+id]={id,type:i%2?'idea':'problem',status:'new',login:'fixture-'+String(i).padStart(3,'0'),message:i===59?'Корисно додати наступний крок для оплати':'Тестове звернення — усі дані вигадані',createdAt:new Date(1759220000000+i).toISOString()};}
}
const root=path.resolve('dist'),{env}=environment(seed);
env.ALLOWED_ORIGINS=`http://127.0.0.1:${port},http://localhost:${port}`;
// A cached fixture HTML must still sign into the isolated fixture after a server
// restart. This deliberately public test token is never used outside localhost.
const pwaFixtureToken=`s1.ZGVtbw.${'42'.repeat(32)}`;
if(pwa)await env.ACCOUNT_STORE.get('demo').fetch(new Request('https://account.internal',{method:'POST',body:JSON.stringify({login:'demo',action:'session-create',tokenHash:await sha256Hex(pwaFixtureToken),deviceName:'PWA · тест'})}));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf'};
let previewRelease=1,previewOffline=false;
createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(pwa&&url.pathname==='/__demo/pwa/status'&&req.method==='GET'){
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({previewRelease,previewOffline}));
    }
    if(pwa&&['/__demo/pwa/release','/__demo/pwa/network'].includes(url.pathname)){
      const allowedOrigins=[`http://localhost:${port}`,`http://127.0.0.1:${port}`];
      if(req.method!=='POST'||!allowedOrigins.includes(req.headers.origin)){res.writeHead(403);return res.end();}
      if(url.pathname.endsWith('/release'))previewRelease=2;
      else previewOffline=url.searchParams.get('offline')==='1';
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({previewRelease,previewOffline}));
    }
    // Test-only network failure; controls above remain reachable to undo it.
    if(pwa&&previewOffline){res.writeHead(503,{'Cache-Control':'no-store'});return res.end('Local PWA offline test');}
    if(demo&&url.pathname.replace(/\/$/,'')==='/__demo/api'){
      if(process.env.KOMUNALKA_DEBUG==='1')console.log('Fixture API request',req.method);
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const request=new Request('https://local.invalid'+url.search,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
      const response=await worker.fetch(request,env);if(process.env.KOMUNALKA_DEBUG==='1')console.log('Fixture API response',response.status);res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    if((await stat(file)).isDirectory())file=path.join(file,'index.html');
    let data=await readFile(file);
    if(pwa&&path.basename(file)==='sw.js')data=Buffer.from(data.toString().replace(/(const CACHE_NAME = 'komunalka-[^']+)';/,`$1-preview${previewRelease}';`));
    if(demo&&path.basename(file)==='app.js'){
      let script=data.toString().replace(/https:\/\/komunproga\.mikolenko-anton1\.workers\.dev/g,'/__demo/api');
      if(!pwa)script=script.replace("window.addEventListener('load',registerServiceWorker);",'/* Service Worker is tested separately with npm run demo:pwa. */');
      data=Buffer.from(script);
    }
    if(demo&&['admin.html','admin-panel.js'].includes(path.basename(file)))data=Buffer.from(data.toString().replace(/https:\/\/komunproga\.mikolenko-anton1\.workers\.dev/g,'/__demo/api'));
    if(demo&&!pwa&&path.basename(file)==='sw.js'){res.writeHead(404);return res.end();}
    if(demo&&path.basename(file)==='index.html'){
      let html=data.toString().replace(/<script defer src="vendor\/firebase\/[^"]+"><\/script>/g,'').replace(/<script\b[^>]*\bsrc="https:\/\/www.googletagmanager[^>]*><\/script>/g,'');
      // Each demo server has isolated sessions: never reuse a token from an older run.
      const token=pwa?pwaFixtureToken:sessionToken('demo');
      await env.ACCOUNT_STORE.get('demo').fetch(new Request('https://account.internal',{method:'POST',body:JSON.stringify({login:'demo',action:'session-create',tokenHash:await sha256Hex(parseSessionToken(token).token),deviceName:'Демонстрація'})}));
      const bootstrap=`<script>localStorage.setItem('k_login','demo');localStorage.setItem('k_session','${token}');localStorage.removeItem('k_passHash');localStorage.removeItem('k_uid');const demoAuth={currentUser:null,onAuthStateChanged(cb){setTimeout(()=>cb(null),0);return()=>{};},signOut:async()=>{}};window.firebase={initializeApp(){},auth:()=>demoAuth};window.firebase.auth.GoogleAuthProvider=class{};</script>`;
      html=html.replace('<script defer src="app.js"',bootstrap+'<script defer src="app.js"');
      if(pwa){
        if(previewRelease===2)html=html.replace(/(<meta name="app-build" content="[^"]+)"/, '$1-preview2"');
        html=html.replace('</body>',(await readFile('scripts/pwa-preview-controls.html','utf8'))+'</body>');
      }
      html=html.replace('</body>','<div style="position:fixed;top:0;left:0;right:0;z-index:9999;padding:3px 12px;background:#2456bd;color:white;text-align:center;font:12px sans-serif;pointer-events:none">Демонстрація · вигадані дані · зміни лише в цьому перегляді</div></body>');
      data=Buffer.from(html);
    }
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Local${pwa?' PWA demo':demo?' demo':''}: http://127.0.0.1:${port}`));
