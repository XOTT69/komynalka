/*
 * Small, dependency-free persistence layer for cloud synchronization.
 * The Worker receives a complete account snapshot, so retaining the newest
 * snapshot is safer than replaying a long list of stale mutations.
 */
(function initKomunalkaSyncQueue(global) {
  'use strict';

  const KEY = 'komynalka_sync_queue_v1';

  function createId() {
    return `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function read(storage = global.localStorage) {
    try {
      const value = storage.getItem(KEY);
      const entry = value ? JSON.parse(value) : null;
      return entry && typeof entry === 'object' && entry.id && entry.payload ? entry : null;
    } catch (error) {
      return null;
    }
  }

  function enqueue(payload, storage = global.localStorage) {
    const entry = {
      id: payload?.clientMutationId || createId(),
      payload,
      queuedAt: Date.now(),
    };
    try {
      storage.setItem(KEY, JSON.stringify(entry));
      return entry;
    } catch (error) {
      return null;
    }
  }

  function clearIfCurrent(id, storage = global.localStorage) {
    const current = read(storage);
    if (!current || current.id !== id) return false;
    try {
      storage.removeItem(KEY);
      return true;
    } catch (error) {
      return false;
    }
  }

  // The account store holds snapshot + pending ID in one atomic local write.
  // One drain per account, including edits arriving while a request is in flight.
  function createDrain(store, send, changed = () => {}) {
    let running = null;
    function drain() {
      if (running) return running;
      running = (async () => {
        let conflicts=0;
        for (;;) {
          const state = store.read();
          if (!state?.pending || state.conflict) return state;
          changed('syncing');
          const result = await send(state);
          if (result.conflict) { if(++conflicts>4)throw new Error('CONFLICT_RETRY_REQUIRED'); const next=store.initialize(result.remote,result.revision);changed(next.conflict?'conflict':'pending');if(next.conflict)return next;continue; }
          if (!result.success || result.protected) throw new Error(result.error || 'SAVE_NOT_CONFIRMED');
          const next = store.acknowledge(state.pending.id,state.local,result.revision ?? null);
          changed(next.pending?'pending':'synced');
        }
      })().finally(() => { running = null; });
      return running;
    }
    return drain;
  }
  global.KomunalkaSyncQueue = Object.freeze({ KEY, createId, read, enqueue, clearIfCurrent, createDrain });
})(window);
