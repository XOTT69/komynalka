import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../service-archive.js',import.meta.url),'utf8');
const context=vm.createContext({});vm.runInContext(source,context);
const services=context.KomunalkaServices;
test('custom services archive and restore without losing settings',()=>{
  const original=[{id:'water-delivery',name:'Доставка води',defaultSum:'250',future:{keep:true}}];
  const archived=services.archive(original,'water-delivery','2026-09-30T08:00:00.000Z');
  assert.equal(services.active(archived).length,0);assert.equal(services.archived(archived).length,1);
  assert.equal(original[0].archivedAt,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(services.restore(archived,'water-delivery'))),original);
});
