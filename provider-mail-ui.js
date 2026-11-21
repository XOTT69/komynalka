'use strict';

(function(){
let providerEmailDraftContext=null;
function updateProviderMailLink(){
  const link=$('providerOpenMail'),copy=$('providerCopyFullMail'),choice=$('providerMailDestination'),help=$('providerMailDestinationHelp');
  if(!link||!choice)return;
  const destination=choice.value;
  link.classList.toggle('hidden',destination==='copy');copy?.classList.toggle('hidden',destination!=='copy');
  help.textContent=destination==='gmail'?'Заповнена чернетка відкриється у Gmail.':destination==='copy'?'Скопіюйте лист повністю або окремими полями.':'Відкриється пошта за замовчуванням на пристрої.';
  if(destination==='copy')return;
  const draft={to:$('providerEmailTo').value,subject:$('providerEmailSubjectText').value,body:$('providerEmailBodyText').value};
  try{
    link.href=destination==='gmail'?KomunalkaProviders.gmail(draft):KomunalkaProviders.mailto(draft);
    link.textContent=destination==='gmail'?'Відкрити Gmail':'Відкрити пошту';
    if(destination==='gmail'){link.target='_blank';link.rel='noopener noreferrer';}else{link.removeAttribute('target');link.removeAttribute('rel');}
    link.removeAttribute('aria-disabled');
  }catch{link.removeAttribute('href');link.setAttribute('aria-disabled','true');}
}
function renderTemplatePreview(){
  if(!providerEditor)return;
  const address=currentAddressSnapshot();
  const service=KomunalkaProviders.services(address).find(item=>item.id===providerEditor.id);
  if(!service?.meter){$('providerTemplatePreview').textContent='';$('providerTemplateNotice').textContent='';return;}
  const month=providerEditor.month;
  const card={account:$('providerAccount').value,email:'preview@example.invalid',emailSubject:$('providerEmailSubject').value,emailBody:$('providerEmailBody').value};
  const values=KomunalkaProviders.meterValues(address,service.id,month);
  const preview=$('providerTemplatePreview');
  $('providerTemplatePreviewTitle').textContent='Перегляд листа · '+providerPeriodLabel(month);
  $('providerTemplateNotice').textContent=KomunalkaProviders.templateNeedsReadings(card.emailBody,values?.length||1)
    ?'У шаблоні бракує поля з поточними показниками. Поки його не додано, лист використовує стандартний текст із збереженими цифрами.':'';
  try{
    const draft=KomunalkaProviders.emailDraft(address,service,card,month);
    preview.textContent=draft?draft.subject+'\n\n'+draft.body:'Перегляд з’явиться після збереження показників за цей місяць.';
  }catch{preview.textContent='Перевірте текст шаблону.';}
}
for(const id of ['providerAccount','providerEmailSubject','providerEmailBody'])$(id)?.addEventListener('input',renderTemplatePreview);
document.querySelectorAll('[data-provider-token]').forEach(button=>button.addEventListener('click',()=>{
  const body=$('providerEmailBody'),token='{'+button.dataset.providerToken+'}';
  if(body.value.length-body.selectionEnd+body.selectionStart+token.length>body.maxLength)return;
  body.setRangeText(token,body.selectionStart,body.selectionEnd,'end');
  body.focus();
  renderTemplatePreview();
}));
$('providerUseStandard')?.addEventListener('click',()=>{
  $('providerEmailBody').value='';
  renderTemplatePreview();
});
function openEmail(id,month=$('providerMonth')?.value||getMonthKey(),recordId){
  if(isGuest)return;
  const address=currentAddressSnapshot(),service=KomunalkaProviders.services(address).find(item=>item.id===id);if(!service)return;
  const card=KomunalkaProviders.get(activeSettings,address.id,id);
  if(!card.email){openProviderEditor(id,true,month);return;}
  if(recordId==null&&KomunalkaProviders.periodRecords(address,month).length>1){openProviderHistory(month);return;}
  const values=KomunalkaProviders.meterValues(address,id,month,recordId);
  let draft;try{draft=KomunalkaProviders.emailDraft(address,service,card,month,recordId);}catch{showToast('Перевірте email і шаблон у картці постачальника','⚠️');return;}
  if(!draft){openMonthlyEntry(providerReadingFields[id],month);return;}
  providerEmailDraftContext={id,month,recordId,owner:sessionLogin,address:currentAddressId,card:KomunalkaData.copy(card),snapshot:KomunalkaProviders.readingSnapshot(values)};
  $('providerEmailContext').textContent=[service.label,providerPeriodLabel(month),address.name].join(' · ');
  $('providerEmailTo').value=draft.to;$('providerEmailSubjectText').value=draft.subject;$('providerEmailBodyText').value=draft.body;
  $('providerReadingsSummary').replaceChildren(...values.map(value=>{
    const group=document.createElement('dl');group.setAttribute('aria-label',value.label);
    for(const [name,number] of [['Попередній',value.previous],['Поточний',value.current],['Різниця',value.difference]]){
      const item=document.createElement('div'),title=document.createElement('dt'),amount=document.createElement('dd');
      title.textContent=name;amount.textContent=number===''?'—':number+' '+value.unit;item.append(title,amount);group.append(item);
    }
    return group;
  }));
  const savedDestination=localStorage.getItem(MAIL_DESTINATION_KEY);
  $('providerMailDestination').value=['system','gmail','copy'].includes(savedDestination)?savedDestination:'system';
  $('providerCopyStatus').classList.add('hidden');
  const notices=[];
  if(KomunalkaProviders.templateNeedsReadings(card.emailBody,values.length))notices.push('У власному шаблоні бракує поля показників. Використано стандартний текст із цього запису.');
  if(values.some(value=>!value.previous))notices.push('У записі бракує попереднього показника. У листі залишено лише відомі значення.');
  if(values.some(value=>value.replacement))notices.push('У цьому місяці замінено лічильник. Перевірте обидва показники перед надсиланням.');
  $('providerEmailNotice').classList.toggle('hidden',notices.length===0);
  $('providerEmailNotice').textContent=notices.join(' ');
  renderProviderDeliveryStatus();
  updateProviderMailLink();const dialog=$('providerEmailDialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
}
function renderProviderDeliveryStatus(){
  const context=providerEmailDraftContext,button=$('providerMarkSent'),status=$('providerDeliveryStatus');if(!context||!button||!status)return;
  const email=KomunalkaProviders;
  const values=email.meterValues(currentAddressSnapshot(),context.id,context.month,context.recordId);
  const delivery=email.delivery(activeSettings,context.address,context.id,context.month);
  const state=email.deliveryState(activeSettings,context.address,context.id,context.month,values);
  const stale=email.readingSnapshot(values)!==context.snapshot;
  status.textContent=stale?'Запис оновився. Відкрийте лист знову.':state==='changed'?'Показники змінено після передачі. Підготовлено актуальний лист.':delivery?'Надіслано '+new Date(delivery.sentAt).toLocaleString('uk-UA',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):'Лист готовий · очікує передачі';
  button.textContent=state==='changed'?'Позначити повторну передачу':'Позначити переданим';
  button.hidden=state==='sent';
  button.disabled=stale||!canEditData();
  $('providerUndoSent').hidden=!delivery||!canEditData();
  button.closest('.provider-delivery-confirm')?.classList.toggle('is-sent',state==='sent');
}
function updateProviderDelivery(undo){
  const context=providerEmailDraftContext;
  if(!context||context.owner!==sessionLogin||String(context.address)!==String(currentAddressId)||!requireEdit())return;
  const providers=KomunalkaProviders,address=currentAddressSnapshot(),{id,month,recordId}=context;
  const values=providers.meterValues(address,id,month,recordId);
  if(!undo&&(!values||!providerDraftIsCurrent())){renderProviderDeliveryStatus();return;}
  const previous=activeSettings,completions=prefs.reminderCompletions;
  try{
    activeSettings=undo?providers.clearDelivered(activeSettings,address.id,id,month):providers.markDelivered(activeSettings,address.id,id,month,undefined,values);
    const reminderId=id==='hotWater'?'water':id;
    const related=providers.services(address).filter(service=>service.id===reminderId||(reminderId==='water'&&service.id==='hotWater'));
    const complete=related.every(service=>providers.deliveryState(activeSettings,address.id,service.id,month,providers.meterValues(address,service.id,month,service.id===id?recordId:undefined))==='sent');
    prefs.reminderCompletions={...completions};
    const cycle=KomunalkaMonth.reminders(address,activeSettings).find(reminder=>reminder.id===reminderId)?.cycle||getMonthKey();
    if(complete&&(month===cycle||!prefs.reminderCompletions[reminderId]))prefs.reminderCompletions[reminderId]=month;
    else if(!complete&&prefs.reminderCompletions[reminderId]===month)delete prefs.reminderCompletions[reminderId];
    syncCurrentAddress();if(!saveToLocal())throw new Error('SAVE_FAILED');
    renderProviderDeliveryStatus();renderMonthlyTasks();renderProviders();syncToCloud();
    showToast(undo?'Позначку скасовано':'Передачу позначено','✓');
  }catch{activeSettings=previous;prefs.reminderCompletions=completions;syncCurrentAddress();showToast('Не вдалося зберегти позначку','⚠️');}
}
function providerDraftIsCurrent(){
  const context=providerEmailDraftContext;
  if(!context||context.owner!==sessionLogin||context.address!==currentAddressId)return false;
  const providers=KomunalkaProviders;
  const values=providers.meterValues(currentAddressSnapshot(),context.id,context.month,context.recordId);
  const card=providers.get(activeSettings,context.address,context.id);
  if(providers.readingSnapshot(values)===context.snapshot&&KomunalkaData.equal(card,context.card))return true;
  showToast('Показники або реквізити змінилися. Відкрийте лист знову.','⚠️');
  return false;
}
$('providerOpenMail')?.addEventListener('click',event=>{if(!providerDraftIsCurrent())event.preventDefault();});
$('providerMarkSent')?.addEventListener('click',()=>updateProviderDelivery(false));
$('providerUndoSent')?.addEventListener('click',()=>updateProviderDelivery(true));
for(const id of ['providerEmailTo','providerEmailSubjectText','providerEmailBodyText'])$(id)?.addEventListener('input',()=>{if(id==='providerEmailSubjectText')$(id).value=$(id).value.replace(/[\r\n]+/g,' ');updateProviderMailLink();});
$('providerMailDestination')?.addEventListener('change',e=>{localStorage.setItem(MAIL_DESTINATION_KEY,e.target.value);updateProviderMailLink();});
document.querySelectorAll('[data-provider-email-copy]').forEach(button=>button.addEventListener('click',()=>{
  if(!providerDraftIsCurrent())return;
  const target={to:'providerEmailTo',subject:'providerEmailSubjectText',body:'providerEmailBodyText'}[button.dataset.providerEmailCopy];
  if(target)copyProviderText($(target).value,button,'Скопійовано');
}));
$('providerCopyFullMail')?.addEventListener('click',event=>{
  if(!providerDraftIsCurrent())return;
  const text=`Кому: ${$('providerEmailTo').value}\nТема: ${$('providerEmailSubjectText').value}\n\n${$('providerEmailBodyText').value}`;
  copyProviderText(text,event.currentTarget,'Увесь лист скопійовано');
});
$('providerEmailClose')?.addEventListener('click',()=>{const dialog=$('providerEmailDialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');providerEmailDraftContext=null;if($('settings-providers')&&!$('settings-providers').classList.contains('hidden'))renderProviders();});

window.KomunalkaProviderMail=Object.freeze({openEmail,renderTemplatePreview});
})();
