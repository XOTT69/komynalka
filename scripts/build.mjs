import {mkdir, cp, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
process.chdir(root);
execFileSync(process.execPath,['scripts/build-vendor.mjs'],{stdio:'inherit'});
await rm('dist',{recursive:true,force:true});
await mkdir('dist/assets',{recursive:true});
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','styles/tailwind.css','-o','dist/assets/tailwind.css','--minify'],{stdio:'inherit'});
const entries=['index.html','landing.html','admin.html','app.js','ai-chat.js','year-report-image.js','sync-queue.js','reminders.js','pwa-updates.js','push-client.js','manifest.json','icon.png','icon-192.png','icon-512.png','og-image.png','styles','vendor'];
for(const optional of ['data-store.js','data-model.js']){try{await readFile(optional);entries.push(optional);}catch{}}
for(const entry of entries)await cp(entry,path.join('dist',entry),{recursive:true});
async function files(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const name=path.join(dir,entry.name);if(entry.isDirectory())result.push(...await files(name));else result.push(name);}return result;}
const assets=(await files('dist')).filter(p=>!p.endsWith('admin.html')&&!p.endsWith('landing.html')).sort();
const hash=createHash('sha256');hash.update(await readFile('sw.js'));for(const file of assets)hash.update(await readFile(file));
const buildId=hash.digest('hex').slice(0,12);
let worker=await readFile('sw.js','utf8');
worker=worker.replace(/const CACHE_NAME = .*;/,`const CACHE_NAME = 'komunalka-${buildId}';`).replace(/const PRECACHE_URLS = .*;/,`const PRECACHE_URLS = ${JSON.stringify(assets.map(p=>'./'+p.slice(5)))};`);
await writeFile('dist/sw.js',worker);
console.log(`Built ${assets.length} offline assets (${buildId})`);
