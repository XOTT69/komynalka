(function(global){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const services=[['showWater','Вода','water','wPrev','м³'],['showHotWater','Гаряча вода','hotWater','hwPrev','м³'],['showElectro','Світло','electroBase','dPrev','кВт·год'],['showGas','Газ','gas','gPrev','м³']];
  const number=value=>{const text=String(value??'').trim().replace(',','.');if(!text)return null;const result=Number(text);return Number.isFinite(result)&&result>=0?result:null;};
  function validate(draft,step){
    if(step===0){if(!String(draft.name||'').trim())return 'Вкажіть назву адреси.';if(!services.some(([key])=>draft.prefs?.[key]))return 'Оберіть хоча б одну послугу.';}
    if(step===1){for(const [key,label,tariff] of services)if(draft.prefs?.[key]&&number(draft.tariffs?.[tariff])===null)return `Перевірте тариф: ${label.toLowerCase()}.`;if(draft.prefs?.showElectro&&draft.prefs?.electroWinter&&number(draft.tariffs?.electroWinter)===null)return 'Перевірте зимовий тариф.';}
    if(step===2){const fields=services.filter(([key])=>draft.prefs?.[key]).map(([, , ,previous])=>previous);if(draft.prefs?.showElectro&&draft.prefs?.electroTwoZone)fields.push('nPrev');for(const key of fields){const value=draft.previous?.[key];if(String(value??'').trim()&&number(value)===null)return 'Попередні показники мають бути невід’ємними числами.';}}
    return null;
  }
  function create(api){
    const dialog=document.createElement('dialog');dialog.id='onboardingDialog';dialog.className='action-dialog onboarding-dialog';dialog.setAttribute('aria-labelledby','onboardingTitle');
    dialog.innerHTML='<form id="onboardingForm" novalidate><div class="onboarding-heading"><span class="onboarding-mark" aria-hidden="true">⌂</span><div><p id="onboardingStep"></p><h2 id="onboardingTitle"></h2></div></div><div class="onboarding-progress" aria-hidden="true"><span></span><span></span><span></span></div><p id="onboardingDescription"></p><div id="onboardingFields"></div><p id="onboardingError" role="alert"></p><div class="dialog-actions"><button type="button" id="onboardingBack" class="button-secondary">Назад</button><button type="submit" id="onboardingNext" class="button-primary">Далі</button></div><button type="button" id="onboardingLater" class="onboarding-later">Продовжити пізніше</button></form>';
    document.body.append(dialog);
    const el=id=>dialog.querySelector('#'+id);let draft,step=0,context;
    const valid=()=>context&&api.owner()===context.owner&&String(api.address()?.id)===String(context.address);
    function field(label,name,value,options={}){
      const wrap=document.createElement('label');wrap.className='onboarding-field';const text=document.createElement('span');text.textContent=label;const input=document.createElement('input');input.name=name;input.value=value??'';input.type=options.type||'text';input.maxLength=options.type==='number'?32:120;
      if(options.type==='number'){input.min='0';input.step='any';input.inputMode='decimal';}if(options.placeholder)input.placeholder=options.placeholder;
      wrap.append(text,input);return wrap;
    }
    function capture(){
      const form=el('onboardingForm');if(step===0){draft.name=form.elements.namedItem('name')?.value||'';for(const [key] of services)draft.prefs[key]=Boolean(form.elements.namedItem(key)?.checked);draft.prefs.electroTwoZone=Boolean(form.elements.namedItem('electroTwoZone')?.checked);draft.prefs.electroWinter=Boolean(form.elements.namedItem('electroWinter')?.checked);}
      if(step===1){for(const [key,,tariff] of services)if(draft.prefs[key])draft.tariffs[tariff]=form.elements.namedItem(tariff)?.value??'';if(draft.prefs.showElectro&&draft.prefs.electroWinter)draft.tariffs.electroWinter=form.elements.namedItem('electroWinter')?.value??'';}
      if(step===2)for(const input of el('onboardingFields').querySelectorAll('input'))draft.previous[input.name]=input.value;
    }
    function persist(captureFields=true){if(!valid())return false;if(captureFields)capture();return api.saveProgress({address:context.address,step,draft,completed:false});}
    function close(){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
    function render(){
      el('onboardingStep').textContent=`Крок ${step+1} із 3`;
      el('onboardingTitle').textContent=['Ваш дім','Ваші тарифи','Початкові показники'][step];
      el('onboardingDescription').textContent=['Оберіть послуги, які хочете обліковувати. Усе можна змінити в налаштуваннях.','Звірте ціни з квитанцією постачальника. Значення за замовчуванням — приклади, а не підтверджені тарифи.','Вкажіть попередні показники з квитанції. Якщо не знаєте — залиште порожнім; ми не рахуватимемо від нуля.'][step];
      dialog.querySelectorAll('.onboarding-progress span').forEach((item,i)=>item.classList.toggle('complete',i<=step));el('onboardingFields').replaceChildren();el('onboardingError').textContent='';el('onboardingBack').hidden=step===0;el('onboardingNext').textContent=step===2?'Перейти до показників':'Далі';
      if(step===0){el('onboardingFields').append(field('Назва адреси','name',draft.name,{placeholder:'Наприклад, квартира на Покровській'}));const grid=document.createElement('div');grid.className='onboarding-services';for(const [key,label] of [...services,['electroTwoZone','День / ніч'],['electroWinter','Зимовий режим']]){const wrap=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.name=key;input.checked=Boolean(draft.prefs[key]);if(['electroTwoZone','electroWinter'].includes(key)){wrap.dataset.electricOption='true';wrap.hidden=!draft.prefs.showElectro;}const text=document.createElement('span');text.textContent=label;wrap.append(input,text);grid.append(wrap);}el('onboardingFields').append(grid);}
      if(step===1){for(const [key,label,tariff] of services)if(draft.prefs[key])el('onboardingFields').append(field(label+' · ₴ / '+(key==='showElectro'?'кВт·год':'м³'),tariff,draft.tariffs[tariff],{type:'number'}));if(draft.prefs.showElectro&&draft.prefs.electroWinter)el('onboardingFields').append(field('Світло · зимовий тариф · ₴ / кВт·год','electroWinter',draft.tariffs.electroWinter,{type:'number'}));}
      if(step===2){for(const [key,label,,previous,unit] of services)if(draft.prefs[key])el('onboardingFields').append(field(label+(key==='showElectro'&&draft.prefs.electroTwoZone?' · день':'')+' · '+unit,previous,draft.previous[previous],{type:'number',placeholder:'Не знаю — залишаю порожнім'}));if(draft.prefs.showElectro&&draft.prefs.electroTwoZone)el('onboardingFields').append(field('Світло · ніч · кВт·год','nPrev',draft.previous.nPrev,{type:'number',placeholder:'Попередній нічний показник'}));}
      el('onboardingFields').querySelector('input')?.focus();
    }
    dialog.addEventListener('input',()=>{if(step===0){capture();dialog.querySelectorAll('[data-electric-option]').forEach(item=>item.hidden=!draft.prefs.showElectro);}if(!persist())el('onboardingError').textContent='Не вдалося зберегти прогрес на пристрої. Залиште цю сторінку відкритою.';});
    el('onboardingForm').addEventListener('submit',async event=>{
      event.preventDefault();if(!valid()){close();return;}capture();const error=step===2?[0,1,2].map(i=>validate(draft,i)).find(Boolean):validate(draft,step);if(error){el('onboardingError').textContent=error;return;}if(!persist()){el('onboardingError').textContent='Не вдалося зберегти прогрес. Спробуйте ще раз.';return;}
      if(step<2){step++;persist(false);render();return;}
      const button=el('onboardingNext');button.disabled=true;
      try{await api.apply(copy(draft),context);if(!valid()){close();return;}if(!api.saveProgress({address:context.address,step:2,draft,completed:true}))throw new Error('Налаштування збережено, але прогрес не вдалося запам’ятати. Спробуйте ще раз.');close();api.navigate();}
      catch(error){if(valid())el('onboardingError').textContent=error.message||'Не вдалося зберегти налаштування.';}
      finally{button.disabled=false;}
    });
    el('onboardingBack').addEventListener('click',()=>{if(!valid()){close();return;}capture();step=Math.max(0,step-1);persist(false);render();});
    el('onboardingLater').addEventListener('click',()=>{if(persist())close();else el('onboardingError').textContent='Не вдалося зберегти прогрес. Спробуйте ще раз.';});
    dialog.addEventListener('cancel',event=>{if(!persist()){event.preventDefault();el('onboardingError').textContent='Не вдалося зберегти прогрес. Спробуйте ще раз.';}});
    return{open(){const address=api.address();if(!address)return;context={owner:api.owner(),address:address.id,base:copy(address)};const progress=api.progress();draft=progress?.address===address.id&&progress.draft?copy(progress.draft):{name:address.name||'',prefs:{...address.prefs},tariffs:{...address.tariffs},previous:api.previous?.()||{}};step=progress?.address===address.id&&!progress.completed?Math.max(0,Math.min(2,Number(progress.step)||0)):0;render();if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');el('onboardingFields').querySelector('input')?.focus();},close};
  }
  global.KomunalkaOnboarding=Object.freeze({create,validate,number});
})(globalThis);
