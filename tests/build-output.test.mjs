import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';

test('production build injects one release version and keeps optional assets out of the install cache',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const index=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(index,new RegExp(`<meta name="app-version" content="${pkg.version.replaceAll('.','\\.')}"`));
  assert.equal(index.includes('vendor/jspdf/jspdf.umd.min.js'),false);
  const sw=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
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
