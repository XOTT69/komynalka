const {chromium}=require('playwright');
const fs=require('node:fs/promises');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const context=await browser.newContext();const page=await context.newPage();await page.goto('http://127.0.0.1:4174/');await page.locator('#monthlyTasksList .month-task').first().waitFor();
 const result=await page.evaluate(async()=>{
  const post=async(body,token)=>{const r=await fetch('/__demo/api',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  const registration=await post({action:'auth_register',login:'audit-xss-fixture',password:'fictional-Audit-8264'});
  if(!registration.data.success)throw new Error(JSON.stringify(registration));const token=registration.data.sessionToken;
  const addresses=[{id:'audit-home',name:'Вигадана адреса',tariffs:{water:1},prefs:{showWater:true,showElectro:false,showGas:false},customServices:[],records:[{id:'audit-record',month:'2026-11',wPrev:0,wCur:'<img src="/audit-missing-image" onerror="window.__auditGuestExecuted=true">',waterCost:1,total:1,_filled:{water:true}}]}];
  const save=await post({addresses,currentAddressId:'audit-home',accountSettings:{},baseRevision:registration.data.data.revision,clientMutationId:'audit-xss-fixture-save'},token);
  const share=await post({action:'generate_share',addressId:'audit-home'},token);
  return {saveStatus:save.status,saveSucceeded:save.data.success,shareStatus:share.status,shareToken:share.data.shareToken};
 });
 await page.goto('http://127.0.0.1:4174/?share='+result.shareToken);await page.locator('#currentAddressDisplay').filter({hasText:'Гість'}).waitFor();await page.locator('#btnTabHistory').click();await page.waitForFunction(()=>window.__auditGuestExecuted===true);
 const report={saveStatus:result.saveStatus,saveSucceeded:result.saveSucceeded,shareStatus:result.shareStatus,guestScriptExecuted:await page.evaluate(()=>window.__auditGuestExecuted===true)};
 console.log(JSON.stringify(report,null,2));await fs.writeFile('test-results/audit-guest-xss.json',JSON.stringify(report,null,2));await context.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
