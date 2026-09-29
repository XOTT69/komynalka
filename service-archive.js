(function(global){
  'use strict';
  const list=value=>Array.isArray(value)?value:[];
  const copy=value=>JSON.parse(JSON.stringify(value));
  const isArchived=service=>Boolean(service&&typeof service.archivedAt==='string'&&service.archivedAt.trim());
  const active=services=>list(services).filter(service=>!isArchived(service));
  const archived=services=>list(services).filter(isArchived);
  function archive(services,id,archivedAt=new Date().toISOString()){
    if(!Number.isFinite(Date.parse(archivedAt)))throw new Error('INVALID_ARCHIVE_DATE');
    let changed=false;
    const result=list(services).map(service=>{
      if(String(service?.id)!==String(id)||isArchived(service))return copy(service);
      changed=true;return {...copy(service),archivedAt};
    });
    if(!changed)throw new Error('SERVICE_NOT_ACTIVE');
    return result;
  }
  function restore(services,id){
    let changed=false;
    const result=list(services).map(service=>{
      if(String(service?.id)!==String(id)||!isArchived(service))return copy(service);
      changed=true;const restored=copy(service);delete restored.archivedAt;return restored;
    });
    if(!changed)throw new Error('SERVICE_NOT_ARCHIVED');
    return result;
  }
  global.KomunalkaServices=Object.freeze({isArchived,active,archived,archive,restore});
})(globalThis);
