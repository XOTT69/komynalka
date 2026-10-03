import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile,readdir} from 'node:fs/promises';
import {createReleaseBuildId} from '../scripts/release-build-id.mjs';

test('production build injects one release version and keeps optional assets out of the install cache',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const index=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(index,new RegExp(`<meta name="app-version" content="${pkg.version.replaceAll('.','\\.')}"`));
  const admin=await readFile(new URL('../dist/admin.html',import.meta.url),'utf8');
  assert.match(admin,new RegExp(`<meta name="app-version" content="${pkg.version.replaceAll('.','\\.')}"`));
  assert.ok(index.indexOf('id="reminderBanner"')<index.indexOf('id="overviewDetails"'),'active reminder is hidden inside collapsed details');
  assert.equal(index.includes('vendor/jspdf/jspdf.umd.min.js'),false);
  const sw=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
  assert.match(sw,/\.\/consumption-insights\.js/);
  assert.match(sw,/\.\/addresses\.js/);
  assert.equal(await readFile(new URL('../dist/consumption-insights.js',import.meta.url),'utf8').then(Boolean),true);
  assert.equal(await readFile(new URL('../dist/addresses.js',import.meta.url),'utf8').then(Boolean),true);
  assert.equal(await readFile(new URL('../dist/service-archive.js',import.meta.url),'utf8').then(Boolean),true);
  const match=sw.match(/const PRECACHE_URLS = (\[[^;]+\]);/);
  assert.ok(match,'built service worker has no precache manifest');
  const assets=JSON.parse(match[1]);
  for(const required of ['./index.html','./app.js','./data-store.js','./icon-192.png','./icon-512.png'])assert.ok(assets.includes(required),`missing offline core asset: ${required}`);
  assert.equal(assets.some(asset=>asset.includes('/jspdf/')),false);
  assert.equal(assets.some(asset=>asset.endsWith('.ttf')),false);
  assert.equal(assets.includes('./og-image.png'),false);
  assert.equal(assets.includes('./styles/quiet-ui.css'),false);
  for(const asset of assets)await access(new URL('../dist/'+asset.slice(2),import.meta.url));
});

test('the published HTML and SW use the build identity of assets and deployment response policy',async()=>{
  const root=new URL('../',import.meta.url);
  async function files(directory){
    const result=[];
    for(const entry of await readdir(new URL(directory,root),{withFileTypes:true})){
      const name=directory+entry.name;
      if(entry.isDirectory())result.push(...await files(name+'/'));else result.push(name);
    }
    return result;
  }
  const assets=(await files('dist/')).filter(name=>!['dist/admin.html','dist/landing.html','dist/sw.js'].includes(name)).sort();
  const bytes=await Promise.all(assets.map(async name=>{
    const source=await readFile(new URL(name,root));
    return name==='dist/index.html'?Buffer.from(source.toString().replace(/<meta name="app-build" content="[^"]+">/,'')):source;
  }));
  const swSource=await readFile(new URL('sw.js',root));
  const expected=createReleaseBuildId(swSource,await readFile(new URL('vercel.json',root)),bytes);
  const index=await readFile(new URL('dist/index.html',root),'utf8');
  const sw=await readFile(new URL('dist/sw.js',root),'utf8');
  assert.ok(index.includes(`<meta name="app-build" content="${expected}">`));
  assert.ok(sw.includes(`const CACHE_NAME = 'komunalka-${expected}';`));
  assert.notEqual(createReleaseBuildId(swSource,'{}',bytes),expected,'cached response headers must participate in the deployed build identity');
});
