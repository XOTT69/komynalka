import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createReleaseBuildId} from '../scripts/release-build-id.mjs';

test('production CSP permits the Google popup bootstrap used by the shipped Firebase SDK',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  const policy=config.headers.find(rule=>rule.source==='/(.*)').headers.find(header=>header.key==='Content-Security-Policy').value;
  const directives=new Map(policy.split(';').map(part=>{const [name,...sources]=part.trim().split(/\s+/);return[name,sources];}));
  const sdk=await readFile(new URL('../vendor/firebase/firebase-auth-compat.js',import.meta.url),'utf8');
  const bootstrap=sdk.match(/gapiScript:"([^"]+)"/);
  assert.ok(bootstrap,'Firebase Google bootstrap URL must be identifiable before deploying');
  assert.ok(directives.get('script-src').includes(new URL(bootstrap[1]).origin),'CSP blocks Firebase Google login with auth/internal-error');
  assert.deepEqual(directives.get('script-src').filter(source=>!source.startsWith("'")),['https://www.googletagmanager.com','https://apis.google.com'],'do not permit arbitrary remote scripts to repair login');
  assert.deepEqual(directives.get('frame-ancestors'),["'none'"]);
  assert.deepEqual(directives.get('object-src'),["'none'"]);
  assert.ok(directives.get('frame-src').includes('https://pwakomun.firebaseapp.com'));
});

test('a header-only deployment change invalidates cached PWA HTML without altering account assets',()=>{
  const sw='same service worker',assets=['unchanged application','unchanged HTML'];
  const before=JSON.stringify({headers:[{value:"script-src 'self'"}]});
  const after=JSON.stringify({headers:[{value:"script-src 'self' https://apis.google.com"}]});
  const oldBuild=createReleaseBuildId(sw,before,assets);
  const newBuild=createReleaseBuildId(sw,after,assets);
  assert.notEqual(newBuild,oldBuild,'header changes must create a waiting update with fresh cached response headers');
  assert.equal(createReleaseBuildId(sw,after,[...assets]),newBuild,'an unchanged release must never advertise another update');
});

test('deployment formatting and unrelated build metadata cannot advertise false PWA updates',()=>{
  const config={headers:[{source:'/(.*)',headers:[{key:'Content-Security-Policy',value:"script-src 'self'"}]}]};
  const reformatted={name:'platform-generated-name',buildCommand:'npm run build',headers:[{headers:[{value:"script-src 'self'",key:'Content-Security-Policy'}],source:'/(.*)'}]};
  const build=createReleaseBuildId('same SW',JSON.stringify(config),['same assets']);
  assert.equal(createReleaseBuildId('same SW',JSON.stringify(reformatted,null,2),['same assets']),build);
  assert.notEqual(createReleaseBuildId('same SW',JSON.stringify({...config,rewrites:[{source:'/example',destination:'/index.html'}]}),['same assets']),build);
});

test('Google redirect helpers use a transparent project-specific proxy with uncached same-origin frames',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 const proxy=config.rewrites.find(rule=>rule.source==='/__/auth/:path*');
 assert.equal(proxy.destination,'https://pwakomun.firebaseapp.com/__/auth/:path*');
 const headers=config.headers.find(rule=>rule.source==='/__/auth/:path*').headers;
 assert.equal(headers.find(h=>h.key==='X-Frame-Options').value,'SAMEORIGIN');
 assert.equal(headers.find(h=>h.key==='Cache-Control').value,'no-store');
 assert.match(headers.find(h=>h.key==='Content-Security-Policy').value,/frame-ancestors 'self'/);
 const root=config.headers.find(rule=>rule.source==='/(.*)').headers;
 assert.equal(root.find(h=>h.key==='X-Frame-Options').value,'DENY');
 assert.match(root.find(h=>h.key==='Content-Security-Policy').value,/frame-src 'self'/);
});
