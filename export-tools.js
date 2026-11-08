'use strict';

// =================== EXPORT ===================
function csvCell(value){let text=String(value??'');if(typeof value==='string'&&/^[=+@\t\r]|^-\D/.test(text))text="'"+text;return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function downloadBlob(content,filename,type){const blob=new Blob([content],{type}),link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=filename;link.hidden=true;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const optionalScriptLoads=new Map();
function loadOptionalScript(src,ready){
  if(ready?.())return Promise.resolve();
  if(optionalScriptLoads.has(src))return optionalScriptLoads.get(src);
  const promise=new Promise((resolve,reject)=>{const script=document.createElement('script');let timer;const finish=error=>{clearTimeout(timer);error?reject(error):resolve();};script.src=src;script.async=true;script.onload=()=>finish(ready&&!ready()?new Error('OPTIONAL_SCRIPT_NOT_READY'):null);script.onerror=()=>finish(new Error('OPTIONAL_SCRIPT_FAILED'));timer=setTimeout(()=>finish(new Error('OPTIONAL_SCRIPT_TIMEOUT')),15000);document.head.appendChild(script);});
  optionalScriptLoads.set(src,promise);promise.catch(()=>{if(optionalScriptLoads.get(src)===promise)optionalScriptLoads.delete(src);});return promise;
}
function pdfAutoTableReady(){try{return typeof window.jspdf?.jsPDF?.API?.autoTable==='function'||typeof new window.jspdf.jsPDF().autoTable==='function';}catch{return false;}}
async function ensurePdfTools(){await loadOptionalScript('vendor/jspdf/jspdf.umd.min.js',()=>!!window.jspdf?.jsPDF);await loadOptionalScript('vendor/jspdf/jspdf.plugin.autotable.min.js',pdfAutoTableReady);}

function exportServices(){
  return [
    {key:'waterCost',label:'Вода',unit:'м³',used:!!prefs.showWater,value:r=>recordUsage(r,'wPrev','wCur')},
    {key:'hotWaterCost',label:'Гаряча вода',unit:'м³',used:!!prefs.showHotWater,value:r=>recordUsage(r,'hwPrev','hwCur')},
    {key:'electroCost',label:'Світло',unit:'кВт·год',used:!!prefs.showElectro,value:r=>recordUsage(r,'dPrev','dCur')+recordUsage(r,'nPrev','nCur')},
    {key:'gasCost',label:'Газ',unit:'м³',used:!!prefs.showGas,value:r=>recordUsage(r,'gPrev','gCur')}
  ].filter(service=>service.used||records.some(r=>Number(r[service.key])>0));
}
function exportCSV(){
  if(!records.length)return showToast('Немає записів','⚠️');
  const services=exportServices(),header=['Місяць',...services.flatMap(s=>[`${s.label} (${s.unit})`,`${s.label} (₴)`]),'Інше (₴)','Всього (₴)','Сплачено (₴)','Залишок (₴)','Статус','Нотатка'];
  const rows=[header,...[...records].sort((a,b)=>b.month.localeCompare(a.month)).map(r=>[r.month,...services.flatMap(s=>[s.value(r),Number(r[s.key]||0).toFixed(2)]),Number(r.customCost||0).toFixed(2),Number(r.total||0).toFixed(2),getPaidAmount(r).toFixed(2),getOutstandingAmount(r).toFixed(2),getPaymentLabel(r),r.note||''])];
  downloadBlob('\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\n')+'\n','komunalka.csv','text/csv;charset=utf-8;');
  showToast('CSV збережено','📊');
}

async function generatePDF(){
  if(!records.length)return showToast('Немає записів','⚠️');
  try{
    showToast('Готуємо PDF…','⏳');
    await ensurePdfTools();
    const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape'});
    let hasFont=false;
    try{const resp=await fetch('./vendor/fonts/Roboto-Regular.ttf');if(resp.ok){const bytes=new Uint8Array(await resp.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);doc.addFileToVFS('Roboto.ttf',btoa(binary));doc.addFont('Roboto.ttf','Roboto','normal');doc.setFont('Roboto','normal');hasFont=true;}}catch{}
    const t=hasFont?s=>String(s):s=>transliterate(String(s)),money=value=>Number(value||0).toFixed(2),services=exportServices();
    doc.setFillColor(36,86,189);doc.rect(0,0,297,35,'F');doc.setTextColor(255,255,255);doc.setFontSize(18);doc.text(t('Комунальні платежі'),15,15);doc.setFontSize(10);doc.text(t($('currentAddressDisplay')?.innerText||''),15,24);doc.setTextColor(60,60,60);
    const head=['Місяць',...services.map(s=>`${s.label}, ₴`),'Інше, ₴','Всього, ₴','Сплачено, ₴','Залишок, ₴','Статус'].map(t);
    const body=[...records].sort((a,b)=>b.month.localeCompare(a.month)).map(r=>[r.month,...services.map(s=>money(r[s.key])),money(r.customCost),money(r.total),money(getPaidAmount(r)),money(getOutstandingAmount(r)),t(getPaymentLabel(r))]);
    doc.autoTable({startY:42,head:[head],body,theme:'striped',styles:{font:hasFont?'Roboto':'helvetica',fontStyle:'normal',fontSize:8,cellPadding:3},headStyles:{fillColor:[36,86,189],textColor:[255,255,255],fontStyle:'normal'},margin:{left:12,right:12}});
    doc.save(`komunalka_${new Date().toISOString().slice(0,10)}.pdf`);showToast('PDF збережено','📄');
  }catch{showToast('Не вдалося створити PDF. Дані залишились збережені.','❌');}
}

function transliterate(text){const map={'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya','А':'A','Б':'B','В':'V','Г':'H','Ґ':'G','Д':'D','Е':'E','Є':'Ye','Ж':'Zh','З':'Z','И':'Y','І':'I','Ї':'Yi','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ь':'','Ю':'Yu','Я':'Ya'};return text.split('').map(c=>map[c]||c).join('');}

async function shareAllRecords(){if(!records.length)return showToast('Немає','⚠️');const sorted=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,6);let t=`📊 Комунальні\n📍 ${$('currentAddressDisplay')?.innerText||''}\n───────\n`;sorted.forEach(r=>{t+=`${new Date(r.month+'-01').toLocaleString('uk-UA',{month:'short',year:'numeric'})}: ${fmt.format(r.total)} ₴ ${isRecordPaid(r)?'✅':getPaymentStatus(r)==='partial'?'◐':'⏳'}\n`;});t+=`───────\nСередній: ${fmt.format(sorted.reduce((s,r)=>s+r.total,0)/sorted.length)} ₴/міс`;if(navigator.share){try{await navigator.share({text:t});return;}catch(e){}}try{await navigator.clipboard.writeText(t);showToast("Скопійовано!","📋");}catch(e){prompt(":",t);}}

function localDraftCopies(){
  if(!activeStore)return [];
  const prefix=activeStore.key+':draft:';
  return Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(key=>{const raw=localStorage.getItem(key);try{return {key:key.slice(prefix.length),value:JSON.parse(raw)};}catch{return {key:key.slice(prefix.length),raw,needsReview:true};}});
}
async function exportCompleteAccount(){
  if(!activeStore||isGuest)return;
  const owner=sessionLogin,store=activeStore;
  if(!saveDraft())return showToast('Не вдалося зберегти чернетку. Повторіть експорт.','⚠️');
  syncCurrentAddress();const persisted=saveToLocal();
  let cloud=null;
  if(navigator.onLine)try{const response=await secureFetch('POST',{}, {action:'account_export'}),result=await response.json();if(response.ok&&result.success)cloud=result.export;}catch{}
  if(store!==activeStore||owner!==sessionLogin)return;
  // The current local snapshot is authoritative for unsent edits. Never substitute an older cloud copy.
  const pending=Boolean(store.read()?.pending),payload={version:1,format:'komunalka-account-v1',exportedAt:new Date().toISOString(),login:owner,data:{...(cloud?.data||{}),...KomunalkaData.copy(accountSnapshot()),displayName},localDrafts:localDraftCopies(),recovery:{source:'device',pending,syncState,localWriteConfirmed:persisted,cloudMetadataIncluded:Boolean(cloud)}};
  downloadBlob(JSON.stringify(payload,null,2),`komunalka_account_${kyivDateKey()}.json`,'application/json;charset=utf-8;');
  writeDeviceMeta({lastExportAt:Date.now()});renderDataHealth();showToast(pending?'Актуальні дані й чернетки завантажено · є локальні зміни':'Дані й чернетки завантажено','💾');
}
