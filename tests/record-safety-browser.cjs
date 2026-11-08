// Run against the isolated demo only. Never point this test at a live account.
const assert=require('node:assert/strict');
const {readFile,mkdir,writeFile}=require('node:fs/promises');
const playwright=require('playwright');
const engine=process.env.KOMUNALKA_BROWSER||'chromium';
const base=process.env.KOMUNALKA_TEST_URL||'http://127.0.0.1:4174';
if(!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base))throw new Error('Fictional local demo required');
(async()=>{
  const browser=await playwright[engine].launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Kyiv'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    const config=JSON.parse(await readFile('vercel.json','utf8'));
    // The fixture is HTTP. WebKit upgrades localhost assets to HTTPS otherwise; production is HTTPS already.
    const policy=config.headers[0].headers.find(header=>header.key==='Content-Security-Policy').value.replace('upgrade-insecure-requests','');
    await page.route('**/*',async route=>{
      if(route.request().resourceType()==='document'&&route.request().url().startsWith(base+'/')){const response=await route.fetch();return route.fulfill({response,headers:{...response.headers(),'Content-Security-Policy':policy}});}
      return route.continue();
    });
    await page.goto(base+'/');await page.locator('#monthlyTasksList .month-task').first().waitFor();
    const report=await page.evaluate(async()=>{
      const original=KomunalkaData.copy(currentAddressSnapshot()),snapshot=KomunalkaData.copy(accountSnapshot()),before=JSON.stringify(original.records);
      const payload='<img src="/missing-audit-image" onerror="window.__safetyExecuted=true">',r={...original.records[0],wCur:payload,waterCost:1,_filled:{water:true}};
      const card=createRecordCard(r);document.body.append(card);const escaped=card.querySelector('img')===null&&card.textContent.includes(payload);card.remove();
      // The CSP also blocks event attributes even if a future sink regresses.
      const container=document.createElement('div');container.innerHTML=payload;document.body.append(container);await new Promise(resolve=>setTimeout(resolve,100));container.remove();
      const target=snapshot.addresses.find(a=>String(a.id)===String(currentAddressId));target.records[0].wCur=payload;
      const rejected=await secureFetch('POST',{}, {...snapshot,baseRevision:activeStore.read().revision,clientMutationId:'browser-security-check'});
      const cloud=await (await secureFetch('GET')).json();
      const preserved=JSON.stringify(cloud.data.addresses.find(a=>String(a.id)===String(currentAddressId)).records)===before;
      return {escaped,eventExecuted:window.__safetyExecuted===true,writeStatus:rejected.status,originalRecordsPreserved:preserved};
    });
    assert.equal(report.escaped,true);assert.equal(report.eventExecuted,false);assert.equal(report.writeStatus,400);assert.equal(report.originalRecordsPreserved,true);
    await page.goto(base+'/admin.html');await page.locator('#adminPass').fill('test-only-password');await page.locator('#loginBtn').click();await page.locator('#usersTableBody .user-row, #loginError:not(.hidden)').first().waitFor();assert.equal(await page.locator('#loginError').isVisible(),false,await page.locator('#loginError').textContent());
    await page.locator('[data-admin-tab=security]').click();await page.locator('#metricsStatus').filter({hasText:'Перевірено'}).waitFor();assert.deepEqual(errors,[]);
    await mkdir('test-results',{recursive:true});await writeFile(`test-results/record-safety-${engine}.json`,JSON.stringify(report,null,2));console.log(`${engine}: inert historical HTML, strict write validation, CSP, preserved records and administration passed`);await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
