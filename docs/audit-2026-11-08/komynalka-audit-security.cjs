const {chromium}=require('playwright');
const fs=require('node:fs/promises');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4174/');await page.locator('#monthlyTasksList .month-task').first().waitFor();
 const report={};
 report.readingHtml=await page.evaluate(async()=>{
  const a=structuredClone(currentAddressSnapshot());const r=a.records[0];r.wCur='<img src="/audit-missing-image" onerror="window.__auditReadingExecuted=true">';r.waterCost=100;r._filled={...r._filled,water:true};
  const n=normalizeImportData({addresses:[a],currentAddressId:a.id});const card=createRecordCard(n.addresses[0].records[0]);card.style.display='none';document.body.append(card);
  await new Promise(resolve=>setTimeout(resolve,150));const result={importAccepted:!!n,htmlExecuted:window.__auditReadingExecuted===true};card.remove();return result;
 });
 report.payloadLimit=await page.evaluate(async()=>{
  const body={addresses:[],padding:'x'.repeat(530000),baseRevision:0,clientMutationId:'audit-size'};
  const response=await secureFetch('POST',{},body);return {bytes:JSON.stringify(body).length,status:response.status,body:await response.json()};
 });
 await fs.writeFile('test-results/audit-security.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
