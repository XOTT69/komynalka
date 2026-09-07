/* Account-scoped, atomic local envelopes. Never mutates a legacy backup. */
(function (global) {
  'use strict';
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const canonical = value => JSON.stringify(value, function (_, item) {
    if (!object(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  });
  const equal = (a,b) => canonical(a) === canonical(b);
  // Three-way merge: absence in a stale snapshot is not an instruction to delete.
  function merge(base, local, remote, path = '', conflicts = []) {
    if (equal(local, remote)) return {value:copy(local), conflicts};
    if (equal(base, local)) return {value:copy(remote), conflicts};
    if (equal(base, remote)) return {value:copy(local), conflicts};
    if (object(local) && object(remote) && (object(base) || base === undefined)) {
      const value = {};
      for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])) {
        const next = merge(base?.[key], local[key], remote[key], `${path}/${key}`, conflicts).value;
        if (next !== undefined) value[key] = next;
      }
      return {value, conflicts};
    }
    if (Array.isArray(local) && Array.isArray(remote) && /\/(addresses|records|customServices)$/.test(path)) {
      const arrays = [base || [], local, remote];
      if (arrays.every(array => Array.isArray(array) && array.every(item => object(item) && item.id != null) && new Set(array.map(item => String(item.id))).size === array.length)) {
        const maps = arrays.map(array => new Map(array.map(item => [String(item.id), item])));
        const value = [];
        for (const id of new Set([...maps[1].keys(), ...maps[2].keys(), ...maps[0].keys()])) {
          const item = merge(maps[0].get(id), maps[1].get(id), maps[2].get(id), `${path}/${id}`, conflicts).value;
          if (item !== undefined) value.push(item);
        }
        return {value, conflicts};
      }
    }
    conflicts.push(path || '/');
    return {value:copy(local), conflicts};
  }
  function create(storage, owner) {
    if (!owner) throw new Error('ACCOUNT_REQUIRED');
    const key = `komynalka_account_v1:${encodeURIComponent(owner)}`;
    function read() {
      const raw = storage.getItem(key);
      if (!raw) return null;
      let state;
      try { state = JSON.parse(raw); } catch { throw new Error('LOCAL_DATA_INVALID'); }
      if (state.owner !== owner || state.schemaVersion !== 1 || !Array.isArray(state.local?.addresses)) throw new Error('LOCAL_DATA_INVALID');
      return state;
    }
    function write(state) {
      const raw = JSON.stringify(state);
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new Error('LOCAL_WRITE_FAILED');
      return copy(state);
    }
    function mutation() { return {id:global.KomunalkaSyncQueue.createId(), queuedAt:Date.now()}; }
    function initialize(remote, revision = null) {
      const state = read();
      if (!state) return write({schemaVersion:1,owner,local:copy(remote),base:copy(remote),revision,pending:null,updatedAt:Date.now()});
      if (state.pending || state.conflict) {
        const result = merge(state.base, state.local, remote);
        if (result.conflicts.length) return write({...state,conflict:{remote:copy(remote),revision,paths:result.conflicts}});
        return write({...state,local:result.value,base:copy(remote),revision,conflict:null,pending:equal(result.value,remote)?null:mutation()});
      }
      return write({...state,local:copy(remote),base:copy(remote),revision,conflict:null,pending:null});
    }
    function stage(local) {
      const state = read();
      if (!state) throw new Error('ACCOUNT_NOT_LOADED');
      if (equal(state.local,local)) return state;
      return write({...state,local:copy(local),pending:mutation(),updatedAt:Date.now()});
    }
    function acknowledge(id, sent, revision) {
      const state = read();
      if (!state) throw new Error('ACCOUNT_NOT_LOADED');
      return write({...state,base:copy(sent),revision,conflict:null,pending:state.pending?.id===id?null:state.pending});
    }
    function resolve(choice) {
      const state = read();
      if (!state?.conflict) return state;
      // A durable recovery copy must succeed before either branch is applied.
      saveBackup('conflict',state);
      const local=choice==='remote'?state.conflict.remote:state.local;
      return write({...state,base:state.conflict.remote,revision:state.conflict.revision,local,conflict:null,pending:choice==='remote'?null:mutation()});
    }
    function saveBackup(name, value) {
      const backupKey=`${key}:backup:${name}`;
      const raw=JSON.stringify({owner,savedAt:Date.now(),value:copy(value)});
      storage.setItem(backupKey,raw);
      if(storage.getItem(backupKey)!==raw)throw new Error('BACKUP_FAILED');
      return true;
    }
    function backup(name) { const raw=storage.getItem(`${key}:backup:${name}`); return raw?JSON.parse(raw).value:null; }
    function draftKey(address,month) { return `${key}:draft:${encodeURIComponent(String(address))}:${month}`; }
    function saveDraft(address,month,value) { const k=draftKey(address,month);const raw=JSON.stringify(value);storage.setItem(k,raw);if(storage.getItem(k)!==raw)throw new Error('DRAFT_WRITE_FAILED'); }
    function draft(address,month) { const raw=storage.getItem(draftKey(address,month));return raw?JSON.parse(raw):null; }
    function clearDraft(address,month) { storage.removeItem(draftKey(address,month)); }
    return Object.freeze({owner,key,read,initialize,stage,acknowledge,resolve,saveBackup,backup,saveDraft,draft,clearDraft});
  }
  global.KomunalkaData = Object.freeze({create,merge,equal,copy});
})(typeof window !== 'undefined' ? window : globalThis);
