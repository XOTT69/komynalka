(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let context=null;
  const definitions=[['wPrev','Вода','showWater'],['hwPrev','Гаряча вода','showHotWater'],['dPrev','Світло · день','showElectro'],['nPrev','Світло · ніч','showElectro'],['gPrev','Газ','showGas']];
  const close=()=>{context=null;const dialog=$('meterReplacementDialog');if(dialog.close)dialog.close();else dialog.removeAttribute('open');};
  function fill(){
    const key=$('replacementMeter').value,event=formMeterEvents()[key];
    $('replacementOldPrevious').value=event?.oldPrevious??$(key)?.value??'';
    $('replacementOldFinal').value=event?.oldFinal??'';$('replacementNewInitial').value=event?.newInitial??'0';
    $('replacementDate').value=event?.date||($('monthInput').value===kyivDateKey().slice(0,7)?kyivDateKey():$('monthInput').value+'-01');
    $('replacementError').textContent='';
    $('replacementRemove').classList.toggle('hidden',!event);
  }
  $('meterReplacementBtn')?.addEventListener('click',()=>{
    if(!requireEdit()||!saveDraft())return;
    context={owner:sessionLogin,address:currentAddressId,month:$('monthInput').value};
    $('replacementMeter').innerHTML=definitions.filter(([key,,pref])=>prefs[pref]&&(key!=='nPrev'||prefs.electroTwoZone)).map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
    if(!$('replacementMeter').options.length){context=null;return showToast('Спочатку увімкніть послугу в налаштуваннях адреси.');}fill();const dialog=$('meterReplacementDialog');if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
  });
  $('replacementMeter')?.addEventListener('change',fill);
  $('replacementCancel')?.addEventListener('click',close);
  $('meterReplacementDialog')?.addEventListener('cancel',()=>{context=null;});
  $('meterReplacementForm')?.addEventListener('submit',event=>{
    event.preventDefault();if(!context||context.owner!==sessionLogin||String(context.address)!==String(currentAddressId)||context.month!==$('monthInput').value)return close();
    try{
      const key=$('replacementMeter').value,value=KomunalkaMeters.validate({date:$('replacementDate').value,oldPrevious:$('replacementOldPrevious').value,oldFinal:$('replacementOldFinal').value,newInitial:$('replacementNewInitial').value},context.month);
      const events=formMeterEvents();events[key]=value;$('meterEventsInput').value=JSON.stringify(events);$(key).value=value.newInitial;$(key.replace('Prev','Cur')).value='';
      $('meterEventsInput').dispatchEvent(new Event('input',{bubbles:true}));calculatePreview();updateSmartBadges();close();showToast('Заміна додана до чернетки. Внесіть поточний показник нового лічильника.');
    }catch{$('replacementError').textContent='Перевірте дату в обраному місяці й показники: кінцевий старого не менший за попередній.';}
  });
  $('replacementRemove')?.addEventListener('click',async()=>{
    if(!context||context.owner!==sessionLogin||context.month!==$('monthInput').value)return;
    const key=$('replacementMeter').value,events=formMeterEvents(),previous=events[key];if(!previous)return;
    if(!await showAppConfirm('Повернемо попередній показник старого лічильника. Поточний потрібно внести заново.',{title:'Прибрати заміну з цього місяця?',confirmLabel:'Прибрати'}))return;
    if(!context||context.owner!==sessionLogin||String(context.address)!==String(currentAddressId)||context.month!==$('monthInput').value)return;
    delete events[key];$('meterEventsInput').value=JSON.stringify(events);$(key).value=previous.oldPrevious;$(key.replace('Prev','Cur')).value='';$('meterEventsInput').dispatchEvent(new Event('input',{bubbles:true}));calculatePreview();close();
  });
})();
