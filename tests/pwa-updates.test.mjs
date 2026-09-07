import {test} from 'node:test';import assert from 'node:assert/strict';import '../pwa-updates.js';
function setup(activeVersion='v1',nextVersion='v2'){
  let shown=0,cleared=0;const active={version:activeVersion},waiting={version:nextVersion,state:'installed'};let control=active;
  const manager=globalThis.KomunalkaUpdates.create({controller:()=>control,readVersion:async w=>w.version,onReady:()=>{shown++;},onClear:()=>{cleared++;}});
  return{manager,registration:{waiting},waiting,setControl:v=>{control=v;},shown:()=>shown,cleared:()=>cleared};
}
test('no waiting release, a first install and identical builds never show update',async()=>{const r=setup('same','same');assert.equal(await r.manager.check(r.registration),false);r.registration.waiting=null;assert.equal(await r.manager.check(r.registration),false);r.registration.waiting=r.waiting;r.setControl(null);assert.equal(await r.manager.check(r.registration),false);assert.equal(r.shown(),0);});
test('a genuine waiting update is discovered after reopening and disappears after activation',async()=>{const r=setup();assert.equal(await r.manager.check(r.registration),true);assert.equal(r.manager.current(),r.waiting);r.waiting.state='activated';r.registration.waiting=null;await r.manager.check(r.registration);assert.equal(r.manager.current(),null);assert.ok(r.cleared());});
test('unknown candidate versions and redundant workers cannot advertise updates',async()=>{const r=setup('old',null);await r.manager.check(r.registration);assert.equal(r.shown(),0);r.waiting.version='new';r.waiting.state='redundant';await r.manager.check(r.registration);assert.equal(r.shown(),0);});
