/* Account operations use the same validated snapshots and recovery copies as sync. */
(function(){
  'use strict';
  let pendingImport=null,sessionRequest=0;
  const open=dialog=>typeof dialog.showModal==='function'?dialog.showModal():dialog.setAttribute('open','');
  const close=dialog=>typeof dialog.close==='function'?dialog.close():dialog.removeAttribute('open');
  function importedState(){
    const local={addresses,currentAddressId,accountSettings:activeSettings};
    return KomunalkaData.merge(undefined,local,pendingImport.data);
  }
  $('importFileInput')?.addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file||!requireEdit())return;
    const owner=sessionLogin;
    try{
      if(file.size>5*1024*1024)throw new Error('Завеликий файл. Максимум 5 МБ.');
      const data=normalizeImportData(JSON.parse(await file.text()));if(!data||data.addresses.length>10)throw new Error('Непідтримуваний формат або більше 10 адрес.');
      if(owner!==sessionLogin)return;syncCurrentAddress();pendingImport={owner,data};
      const records=data.addresses.flatMap(address=>address.records||[]),merged=importedState();
      $('importPreviewSummary').textContent=`${data.addresses.length} адрес · ${records.length} записів · нараховано ${fmt.format(records.reduce((sum,r)=>sum+Math.round(r.total*100),0)/100)} ₴.`;
      $('importPreviewConflicts').textContent=merged.conflicts.length?`Є ${merged.conflicts.length} відмінностей у наявних даних. При об’єднанні зберігаємо ваші поточні значення; нові адреси й записи додаємо. Для повного відновлення копії оберіть заміну.`:'Нові дані можна додати без заміни наявних записів.';
      $('importStrategy').value='merge';open($('importPreviewDialog'));
    }catch(error){pendingImport=null;showToast(error.message||'Не вдалося прочитати файл','⚠️');}
  });
  $('importPreviewCancel')?.addEventListener('click',()=>{pendingImport=null;close($('importPreviewDialog'));});
  $('importPreviewDialog')?.addEventListener('cancel',()=>{pendingImport=null;});
  $('importPreviewConfirm')?.addEventListener('click',async()=>{
    if(!pendingImport||pendingImport.owner!==sessionLogin||!canEditData())return;
    const owner=sessionLogin,button=$('importPreviewConfirm');button.disabled=true;
    try{
      syncCurrentAddress();const data=$('importStrategy').value==='replace'?pendingImport.data:importedState().value;
      if(data.addresses.length>10)throw new Error('Після об’єднання буде більше 10 адрес.');
      if(!saveDraft()||!backupCurrentState(PRE_IMPORT_BACKUP_KEY))return;
      activeStore.stage(data);applySnapshot(data);addChangeLog('json_imported',{addresses:addresses.length,records:addresses.reduce((sum,a)=>sum+a.records.length,0)});
      close($('importPreviewDialog'));pendingImport=null;await syncToCloud();
      if(owner!==sessionLogin)return;showActionToast('Дані імпортовано','Відновити попередні',()=>{if(owner!==sessionLogin)return;if(restoreFromLocalBackup(PRE_IMPORT_BACKUP_KEY))showToast('Попередні дані відновлено');});
    }catch(error){showToast(error.message||'Імпорт не завершено','⚠️');}finally{button.disabled=false;}
  });
  async function loadSessions(){
    const owner=sessionLogin,request=++sessionRequest,list=$('accountSessionsList');if(!list)return;
    list.textContent='Перевіряємо пристрої…';
    try{
      const response=await secureFetch('POST',{}, {action:'session_list'}),data=await response.json();if(owner!==sessionLogin||request!==sessionRequest)return;
      if(!response.ok||!data.success)throw new Error();
      list.innerHTML=(data.sessions||[]).map(item=>`<div class="session-row"><span><strong>${escapeHtml(item.current?'Цей пристрій':item.deviceName||'Інший пристрій')}</strong><small>Вхід ${escapeHtml(new Date(item.createdAt).toLocaleString('uk-UA'))} · до ${escapeHtml(new Date(item.expiresAt).toLocaleDateString('uk-UA'))}</small></span>${item.current?'<span class="session-current">Активний</span>':`<button type="button" data-session-revoke="${escapeAttr(item.id)}">Завершити</button>`}</div>`).join('')||'<p>Для входу через Google доступом також керує ваш Google-акаунт.</p>';
      $('revokeOtherSessionsBtn').disabled=!(data.sessions||[]).some(item=>!item.current)||!sessionToken;
    }catch{if(owner===sessionLogin&&request===sessionRequest)list.textContent='Не вдалося перевірити сесії. Натисніть «Оновити».';}
  }
  $('refreshSessionsBtn')?.addEventListener('click',loadSessions);
  $('accountSessionsList')?.addEventListener('click',async event=>{
    const button=event.target.closest('[data-session-revoke]');if(!button)return;
    const owner=sessionLogin,token=sessionToken;
    if(!await showAppConfirm('На вибраному пристрої потрібно буде ввійти знову.',{title:'Завершити сесію?',confirmLabel:'Завершити'}))return;
    if(owner!==sessionLogin||token!==sessionToken)return;button.disabled=true;try{const response=await secureFetch('POST',{}, {action:'session_revoke',id:button.dataset.sessionRevoke});if(!response.ok)throw new Error();showToast('Сесію завершено');await loadSessions();}catch{button.disabled=false;showToast('Не вдалося завершити сесію','⚠️');}
  });
  $('revokeOtherSessionsBtn')?.addEventListener('click',async()=>{
    const owner=sessionLogin,token=sessionToken;
    if(!await showAppConfirm('Інші пристрої втратять доступ. Поточна сесія залишиться.',{title:'Завершити інші сесії?',confirmLabel:'Завершити'}))return;
    if(owner!==sessionLogin||token!==sessionToken)return;try{const response=await secureFetch('POST',{}, {action:'session_revoke_others'});if(!response.ok)throw new Error();showToast('Інші сесії завершено');await loadSessions();}catch{showToast('Не вдалося завершити сесії','⚠️');}
  });
  window.KomunalkaAccountTools=Object.freeze({loadSessions});
})();
