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

  global.KomunalkaSyncQueue = Object.freeze({ KEY, createId, read, enqueue, clearIfCurrent });
})(window);
