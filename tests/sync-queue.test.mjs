import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'sync-queue.js'), 'utf8');
const store = new Map();
const localStorage = {
  getItem: key => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};
const context = { window: { localStorage }, Date, Math, JSON };
vm.runInNewContext(source, context, { filename: 'sync-queue.js' });

const queue = context.window.KomunalkaSyncQueue;
assert.ok(queue, 'queue API must be attached to window');
assert.equal(queue.read(), null, 'queue starts empty');

const first = queue.enqueue({ clientMutationId: 'first', addresses: [{ id: 'a' }] });
assert.equal(queue.read().id, first.id, 'queued snapshot can be restored');

const second = queue.enqueue({ clientMutationId: 'second', addresses: [{ id: 'b' }] });
assert.equal(queue.read().id, second.id, 'newest snapshot replaces stale snapshot');
assert.deepEqual(queue.read().payload.addresses, [{ id: 'b' }], 'newest payload is preserved');
assert.equal(queue.clearIfCurrent(first.id), false, 'stale completion cannot clear newer data');
assert.equal(queue.clearIfCurrent(second.id), true, 'current completion clears queued data');
assert.equal(queue.read(), null, 'queue is empty after a matching clear');

console.log('sync queue unit checks passed');
