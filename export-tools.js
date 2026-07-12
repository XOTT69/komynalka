'use strict';

// =================== EXPORT ===================
function csvCell(value){const text=String(value??'');return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function downloadBlob(content,filename,type){const blob=new Blob([content],{type}),link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=filename;link.click();URL.revokeObjectURL(link.href);}

function exportCSV(){
  if(!records.length)return showToast('Немає','⚠️');
  const header=['Місяць'];
  if(prefs.showWater)    header.push('Вода(м3)','Вода(₴)');
  if(prefs.showHotWater) header.push('Гар(м3)','Гар(₴)');
  if(prefs.showElectro)  header.push('Світло(кВт)','Світло(₴)');
  if(prefs.showGas)      header.push('Газ(м3)','Газ(₴)');
  header.push('Інше(₴)','Всього(₴)','Статус','Нотатка');
  const rows=[[...header]];
  [...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).forEach(r=>{
    const row=[r.month];
    if(prefs.showWater)    row.push(Math.max(0,(r.wCur||0)-(r.wPrev||0)),(r.waterCost||0).toFixed(2));
    if(prefs.showHotWater) row.push(Math.max(0,(r.hwCur||0)-(r.hwPrev||0)),(r.hotWaterCost||0).toFixed(2));
    if(prefs.showElectro)  row.push(Math.max(0,(r.dCur||0)-(r.dPrev||0))+Math.max(0,(r.nCur||0)-(r.nPrev||0)),(r.electroCost||0).toFixed(2));
    if(prefs.showGas)      row.push(Math.max(0,(r.gCur||0)-(r.gPrev||0)),(r.gasCost||0).toFixed(2));
    row.push((r.customCost||0).toFixed(2),(r.total||0).toFixed(2),getPaymentLabel(r),r.note||'');
    rows.push(row);
  });
  downloadBlob('\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\n')+'\n','komunalka.csv','text/csv;charset=utf-8;');
  showToast('Експортовано','📊');
}

async function generatePDF(){
  if(!records.length)return showToast('Немає','⚠️');
  const{jsPDF}=window.jspdf,doc=new jsPDF();
  let hasFont=false;
  try{const resp=await fetch('vendor/fonts/Roboto-Regular.ttf');if(resp.ok){const buf=await resp.arrayBuffer(),bytes=new Uint8Array(buf);let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);doc.addFileToVFS('Roboto.ttf',btoa(binary));doc.addFont('Roboto.ttf','Roboto','normal');doc.setFont('Roboto','normal');hasFont=true;}}catch(e){}
  const t=hasFont?s=>s:transliterate;
  doc.setFillColor(0,122,255);doc.rect(0,0,210,35,'F');doc.setTextColor(255,255,255);doc.setFontSize(18);doc.text(t('Комунальні платежі'),15,15);doc.setFontSize(10);doc.text(t($('currentAddressDisplay')?.innerText||''),15,24);doc.setTextColor(60,60,60);
  const tH=[t('Міс.')];if(prefs.showWater)tH.push(t('Вода'),t('₴'));if(prefs.showElectro)tH.push(t('Світло'),t('₴'));if(prefs.showGas)tH.push(t('Газ'),t('₴'));tH.push(t('Інше'),t('Всього'),t('Статус'));
  const tR=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).map(r=>{const row=[r.month];if(prefs.showWater)row.push(Math.max(0,(r.wCur||0)-(r.wPrev||0)),(r.waterCost||0).toFixed(0));if(prefs.showElectro)row.push(Math.max(0,(r.dCur||0)-(r.dPrev||0))+Math.max(0,(r.nCur||0)-(r.nPrev||0)),(r.electroCost||0).toFixed(0));if(prefs.showGas)row.push(Math.max(0,(r.gCur||0)-(r.gPrev||0)),(r.gasCost||0).toFixed(0));row.push((r.customCost||0).toFixed(0),(r.total||0).toFixed(0),t(getPaymentLabel(r)));return row;});
  doc.autoTable({startY:40,head:[tH],body:tR,theme:'striped',styles:{font:hasFont?'Roboto':'helvetica'},headStyles:{fillColor:[0,122,255],textColor:[255,255,255],fontSize:7,fontStyle:'bold',halign:'center'},bodyStyles:{fontSize:7,halign:'center'},margin:{left:10,right:10}});
  doc.save(`komunalka_${new Date().toISOString().slice(0,10)}.pdf`);showToast('PDF!','📄');
}

function transliterate(text){const map={'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya','А':'A','Б':'B','В':'V','Г':'H','Ґ':'G','Д':'D','Е':'E','Є':'Ye','Ж':'Zh','З':'Z','И':'Y','І':'I','Ї':'Yi','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ь':'','Ю':'Yu','Я':'Ya'};return text.split('').map(c=>map[c]||c).join('');}

async function shareAllRecords(){if(!records.length)return showToast('Немає','⚠️');const sorted=[...records].sort((a,b)=>new Date(b.month)-new Date(a.month)).slice(0,6);let t=`📊 Комунальні\n📍 ${$('currentAddressDisplay')?.innerText||''}\n───────\n`;sorted.forEach(r=>{t+=`${new Date(r.month+'-01').toLocaleString('uk-UA',{month:'short',year:'numeric'})}: ${fmt.format(r.total)} ₴ ${isRecordPaid(r)?'✅':getPaymentStatus(r)==='partial'?'◐':'⏳'}\n`;});t+=`───────\nСередній: ${fmt.format(sorted.reduce((s,r)=>s+r.total,0)/sorted.length)} ₴/міс`;if(navigator.share){try{await navigator.share({text:t});return;}catch(e){}}try{await navigator.clipboard.writeText(t);showToast("Скопійовано!","📋");}catch(e){await showCopyDialog('Скопіюйте звіт',t);}}

$('exportCsvBtn')?.addEventListener('click',exportCSV);
$('exportPdfBtn')?.addEventListener('click',generatePDF);
$('shareAllBtn')?.addEventListener('click',shareAllRecords);
$('exportJsonBtn')?.addEventListener('click',()=>{syncCurrentAddress();downloadBlob(JSON.stringify({version:APP_VERSION,exportDate:new Date().toISOString(),addresses,currentAddressId},null,2),'komunalka_backup.json','application/json;charset=utf-8;');showToast('Бекап','💾');});
$('importJsonBtn')?.addEventListener('click',()=>$('importFileInput')?.click());
