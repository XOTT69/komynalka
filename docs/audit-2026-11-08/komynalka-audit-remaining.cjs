const {chromium}=require('playwright');
const fs=require('node:fs/promises');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4174/');await page.locator('#monthlyTasksList .month-task').first().waitFor();
 const report={};
 report.customZeroStatus=await page.evaluate(()=>{
  const a={id:'zero',prefs:{showWater:false,showHotWater:false,showElectro:false,showGas:false},customServices:[{id:'fixed',name:'Фіксована послуга'}],records:[{id:'zero-month',month:'2035-01',total:0,customCost:0,customData:{},_filled:{custom:false}}]};return KomunalkaMonth.readings(a,'2035-01');
 });
 report.draftOverwrite=await page.evaluate(()=>{
  $('monthInput').value='2035-02';fillPreviousReadings();$('custom_building').value='123';$('custom_building').dispatchEvent(new Event('input',{bubbles:true}));
  $('prefHotWater').checked=!$('prefHotWater').checked;$('prefHotWater').dispatchEvent(new Event('change',{bubbles:true}));
  $('recordNote').value='Зміна примітки після налаштувань';$('recordNote').dispatchEvent(new Event('input',{bubbles:true}));
  return {visible:$('custom_building').value,persisted:activeStore.draft(currentAddressId,'2035-02')?.custom_building};
 });
 report.mergeSameMonth=await page.evaluate(()=>{
  const base={addresses:[{id:'home',records:[]}]},local=structuredClone(base),remote=structuredClone(base);local.addresses[0].records.push({id:'device-a',month:'2035-03',total:100});remote.addresses[0].records.push({id:'device-b',month:'2035-03',total:200});const result=KomunalkaData.merge(base,local,remote);return {conflicts:result.conflicts,records:result.value.addresses[0].records};
 });
 // Cloud export succeeds even when the preceding sync failed: capture JSON only.
 report.staleExport=await page.evaluate(async()=>{
  await syncToCloud();const prior=window.fetch,downloads=[];const originalDownload=downloadBlob;let failedSave=false;
  window.fetch=async(url,options)=>{let b;try{b=JSON.parse(options?.body||'{}');}catch{}if(options?.method==='POST'&&Array.isArray(b?.addresses)){failedSave=true;return new Response(JSON.stringify({success:false,error:'TEST_SYNC_FAILURE'}),{status:503,headers:{'Content-Type':'application/json'}});}return prior(url,options);};
  downloadBlob=(content,name)=>downloads.push({value:JSON.parse(content),name});
  const address=addresses.find(a=>String(a.id)===String(currentAddressId)),oldName=address.name;address.name='UNSYNCED_AUDIT_NAME';
  $('exportAccountBtn').click();for(let i=0;i<40&&!downloads.length;i++)await new Promise(r=>setTimeout(r,50));
  const result={failedSave,downloaded:downloads.length>0,downloadedAddress:downloads[0]?.value?.data?.addresses?.find(a=>String(a.id)===String(currentAddressId))?.name,localAddress:address.name,toast:$('toastMsg').textContent};
  window.fetch=prior;downloadBlob=originalDownload;address.name=oldName;return result;
 });
 await fs.writeFile('test-results/audit-domain-and-export.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
