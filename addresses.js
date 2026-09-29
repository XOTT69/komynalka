(function(global){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const isArchived=address=>typeof address?.archivedAt==='string'&&address.archivedAt.length>0;
  const active=addresses=>(Array.isArray(addresses)?addresses:[]).filter(address=>!isArchived(address));
  const archived=addresses=>(Array.isArray(addresses)?addresses:[]).filter(isArchived);
  function current(addresses,id){
    const available=active(addresses);return available.find(address=>String(address.id)===String(id))?.id??available[0]?.id??addresses?.[0]?.id??null;
  }
  function archive(addresses,id,at=new Date().toISOString()){
    if(!Number.isFinite(Date.parse(at)))throw new Error('INVALID_ARCHIVE_DATE');
    const list=Array.isArray(addresses)?addresses:[],target=list.find(address=>String(address.id)===String(id));
    if(!target||isArchived(target))throw new Error('ADDRESS_NOT_ACTIVE');
    if(active(list).length<=1)throw new Error('LAST_ACTIVE_ADDRESS');
    return list.map(address=>String(address.id)===String(id)?{...copy(address),archivedAt:at}:copy(address));
  }
  function restore(addresses,id){
    let found=false;const result=(Array.isArray(addresses)?addresses:[]).map(address=>{if(String(address.id)!==String(id)||!isArchived(address))return copy(address);found=true;const next=copy(address);delete next.archivedAt;return next;});
    if(!found)throw new Error('ADDRESS_NOT_ARCHIVED');return result;
  }
  function removeArchived(addresses,id){
    const list=Array.isArray(addresses)?addresses:[],target=list.find(address=>String(address.id)===String(id));
    if(!target||!isArchived(target))throw new Error('ADDRESS_NOT_ARCHIVED');
    if(list.length<=1)throw new Error('LAST_ADDRESS');return list.filter(address=>String(address.id)!==String(id)).map(copy);
  }
  global.KomunalkaAddresses=Object.freeze({isArchived,active,archived,current,archive,restore,removeArchived});
})(globalThis);
