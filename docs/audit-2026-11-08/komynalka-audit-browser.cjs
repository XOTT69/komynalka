const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const out=require('node:path').resolve('test-results');
(async()=>{
 const browser=await chromium.launch({headless:true});const report={};
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();page.on('dialog',d=>d.accept());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4174/');await page.locator('#monthlyTasksList .month-task').first().waitFor();
  await page.screenshot({path:out+'/audit-overview-390.png'});
  report.initial=await page.evaluate(()=>({month:getMonthKey(),calcMonth:$('monthInput').value,total:records[0].total,custom:records[0].customData,prefs:{...prefs}}));
  // A zero custom charge must replace its previous value consistently.
  report.customZero=await page.evaluate(()=>{
   $('monthInput').value=records[0].month;fillPreviousReadings();$('custom_building').value='0';calculatePreview();
   const before={cost:currentCalc.customCost,total:currentCalc.total};
   $('utilityForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
   const r=records.find(r=>r.month===getMonthKey());return {before,stored:{customCost:r.customCost,customData:r.customData,total:r.total}};
  });
  report.negativeCustom=await page.evaluate(()=>{
   $('monthInput').value='2030-06';fillPreviousReadings();$('custom_building').value='-100';calculatePreview();
   const before={valid:$('utilityForm').checkValidity(),disabled:$('submitFormBtn').disabled,cost:currentCalc.customCost,total:currentCalc.total};
   $('wPrev').value='0';$('wCur').value='1';calculatePreview();$('utilityForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
   const r=records.find(r=>r.month==='2030-06');return {before,stored:r?{total:r.total,customCost:r.customCost,customData:r.customData}:null};
  });
  report.missingNight=await page.evaluate(()=>{
   $('monthInput').value='2030-07';fillPreviousReadings();$('dPrev').value='0';$('dCur').value='10';$('nPrev').value='';$('nCur').value='';$('custom_building').value='0';calculatePreview();
   const before={valid:validateReadingsUI(),total:currentCalc.total};$('utilityForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
   const r=records.find(r=>r.month==='2030-07');return {before,stored:r?{filled:r._filled,day:r.dCur,night:r.nCur}:null,task:KomunalkaMonth.readings(currentAddressSnapshot(),'2030-07').services.find(s=>s.id==='electro')};
  });
  report.duplicateMonth=await page.evaluate(()=>{
   const a=structuredClone(currentAddressSnapshot()),r=structuredClone(a.records[0]);r.id='different-id';a.records.push(r);
   try{const n=normalizeImportData({addresses:[a],currentAddressId:a.id});return {accepted:!!n,duplicateCount:n.addresses[0].records.filter(x=>x.month===r.month).length};}catch(e){return {accepted:false,error:e.message};}
  });
  // Settings toggles rebuild custom inputs before persisting or restoring them.
  report.settingsDraft=await page.evaluate(()=>{
   $('monthInput').value='2030-08';fillPreviousReadings();$('custom_building').value='123';$('custom_building').dispatchEvent(new Event('input',{bubbles:true}));
   const before=$('custom_building').value;$('prefHotWater').checked=!$('prefHotWater').checked;$('prefHotWater').dispatchEvent(new Event('change',{bubbles:true}));
   const after=$('custom_building').value;saveDraft();return {before,after,draft:activeStore.draft(currentAddressId,'2030-08')?.custom_building};
  });
  // Disabled hot water should remain historical but must not be erased by saving a note.
  report.previousFromMissing=await page.evaluate(()=>{
   records.push({id:'missing-water',month:'2031-01',wPrev:0,wCur:0,waterCost:0,total:100,_filled:{water:false,electro:true},electroCost:100});
   $('monthInput').value='2031-02';fillPreviousReadings();return {autoPrevious:$('wPrev').value,priorFilled:records.find(r=>r.id==='missing-water')._filled.water};
  });
  report.csvFormula=await page.evaluate(()=>csvCell('=1+1'));
  report.errors=errors;
  await fs.writeFile(out+'/audit-reproductions.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
