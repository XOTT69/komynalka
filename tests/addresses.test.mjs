import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../addresses.js';

const A=globalThis.KomunalkaAddresses;
const fixture=()=>[
  {id:'home',name:'Дім',records:[{id:1,total:100,proof:{reference:'abc'}}],tariffs:{water:30},future:{keep:true}},
  {id:'office',name:'Офіс',records:[{id:2,total:200}],prefs:{remindersEnabled:true}}
];

test('archive is immutable and preserves every nested address field',()=>{
  const original=fixture(),result=A.archive(original,'office','2026-09-29T08:00:00.000Z');
  assert.equal(original[1].archivedAt,undefined);
  assert.equal(result[1].archivedAt,'2026-09-29T08:00:00.000Z');
  assert.deepEqual(result[1].records,original[1].records);
  assert.notEqual(result[1].records,original[1].records);
  assert.deepEqual(result[0].future,{keep:true});
});

test('last active address cannot be archived and current always falls back to an active one',()=>{
  assert.throws(()=>A.archive([fixture()[0]],'home'),/LAST_ACTIVE_ADDRESS/);
  const list=A.archive(fixture(),'home','2026-09-29T08:00:00.000Z');
  assert.equal(A.current(list,'home'),'office');
  assert.deepEqual(A.active(list).map(a=>a.id),['office']);
  assert.deepEqual(A.archived(list).map(a=>a.id),['home']);
});

test('restore removes only archive metadata and permanent removal accepts archived addresses only',()=>{
  const archived=A.archive(fixture(),'office','2026-09-29T08:00:00.000Z'),restored=A.restore(archived,'office');
  assert.equal('archivedAt' in restored[1],false);
  assert.deepEqual(restored[1].records,fixture()[1].records);
  assert.throws(()=>A.removeArchived(restored,'office'),/ADDRESS_NOT_ARCHIVED/);
  const removed=A.removeArchived(archived,'office');
  assert.deepEqual(removed.map(a=>a.id),['home']);
});
