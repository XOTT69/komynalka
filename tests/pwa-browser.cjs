// CI browser gate. Uses an isolated fictional account on the PWA fixture server.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  fs.mkdirSync('test-results',{recursive:true});
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Kyiv'});
  const errors=[];
  const open=async()=>{
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:4175/');await page.locator('#appScreen').waitFor({state:'visible'});await page.locator('#splashScreen').waitFor({state:'hidden'});
    await page.locator('#pwaDiagnostics summary').click();return page;
  };
  const draft=async(page,month,value,note)=>{
    await page.locator('#btnTabCalc').click();await page.locator('#monthInput').fill(month);await page.locator('#wPrev').fill('246');await page.locator('#wCur').fill(value);await page.locator('#recordNote').fill(note);
  };
  const verifyDraft=async(page,month,value,note)=>{
    await page.locator('#btnTabCalc').click();await page.locator('#monthInput').fill(month);
    assert.equal(await page.locator('#wPrev').inputValue(),'246');assert.equal(await page.locator('#wCur').inputValue(),value);assert.equal(await page.locator('#recordNote').inputValue(),note);
  };
  try{
    const first=await open();await first.locator('#pwaState').filter({hasText:/Контролер: komunalka-.*-preview1/}).waitFor();
    assert.equal(await first.locator('#updateBanner').count(),0,'first installation must not offer an update');
    const second=await open();
    await draft(first,'2026-11','251','Чернетка першої вкладки');await draft(second,'2026-12','260','Чернетка другої вкладки');
    await second.locator('#pwaNext').click();await first.locator('#updateBanner').waitFor();await second.locator('#updateBanner').waitFor();
    await Promise.all([first.waitForNavigation({waitUntil:'load'}),second.waitForNavigation({waitUntil:'load'}),second.locator('#applyUpdateBtn').click()]);
    for(const page of [first,second]){
      assert.match(await page.locator('meta[name="app-build"]').getAttribute('content'),/-preview2$/);
      assert.equal(await page.locator('#updateBanner').count(),0,'activated update must disappear');
    }
    await verifyDraft(first,'2026-11','251','Чернетка першої вкладки');await verifyDraft(second,'2026-12','260','Чернетка другої вкладки');
    await second.locator('#pwaDiagnostics summary').click();await second.locator('#pwaOffline').click();
    await second.locator('#pwaState').filter({hasText:'Мережа: тестовий збій'}).waitFor();
    await second.reload();await second.locator('#appScreen').waitFor({state:'visible'});await second.locator('#splashScreen').waitFor({state:'hidden'});
    await verifyDraft(second,'2026-12','260','Чернетка другої вкладки');
    assert.match(await second.locator('#syncStatusText').textContent(),/пристрої/,'API failure must reopen the device copy even while the browser reports online');
    await second.locator('#pwaDiagnostics summary').click();await second.locator('#pwaOffline').click();
    await second.locator('#pwaState').filter({hasText:'Мережа: працює'}).waitFor();
    await context.setOffline(true);await second.reload();await second.locator('#appScreen').waitFor({state:'visible'});await second.locator('#splashScreen').waitFor({state:'hidden'});
    await verifyDraft(second,'2026-12','260','Чернетка другої вкладки');await second.screenshot({path:'test-results/pwa-offline.png'});
    await context.setOffline(false);await second.reload();await second.locator('#splashScreen').waitFor({state:'hidden'});await second.locator('#pwaDiagnostics summary').click();await second.locator('#pwaCheck').click();
    await second.locator('#pwaState').filter({hasText:/Контролер: komunalka-.*-preview2 · Очікує: немає/}).waitFor();
    assert.equal(await second.locator('#updateBanner').count(),0,'unchanged release must not offer an update');
    const appCaches=await second.evaluate(async()=> (await caches.keys()).filter(key=>key.startsWith('komunalka-')));assert.equal(appCaches.length,1,'old release cache must be removed');
    assert.deepEqual(errors,[]);console.log('PWA browser checks passed: first install, two-tab update, drafts, unavailable API, offline reload and unchanged release.');
  }finally{await context.setOffline(false);await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
