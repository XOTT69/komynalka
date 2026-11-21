const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const playwright=require('playwright');
const base=process.env.KOMUNALKA_TEST_URL||'http://127.0.0.1:4174';
const engine=process.env.KOMUNALKA_BROWSER||'chromium';

(async()=>{
  const browser=await playwright[engine].launch();
  try{
    await fs.mkdir('test-results',{recursive:true});
    const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Kyiv'});
    await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copiedMail=value;}},configurable:true}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/index.html');
    await page.locator('#appScreen').waitFor({state:'visible'});
    await page.locator('#splashScreen').waitFor({state:'hidden'});
    const month=await page.locator('#monthInput').inputValue();
    await page.locator('#btnTabSettings').click();
    await page.locator('[data-settings-open=providers]').click();
    await page.locator('[data-provider-edit=water]').click();
    await page.locator('#providerAccount').fill('000142');
    await page.locator('#providerEmail').fill('water@example.invalid');
    await page.locator('#providerEmailSettings summary').click();
    await page.locator('#providerEmailBody').fill('Старе число 125');
    await page.locator('#providerTemplateNotice').filter({hasText:/бракує поля/}).waitFor();
    assert.match(await page.locator('#providerTemplatePreview').textContent(),/246/);
    await page.locator('[data-provider-token=current]').click();
    assert.match(await page.locator('#providerEmailBody').inputValue(),/\{current\}/);
    await page.locator('#providerEmailBody').fill('Старе число 125');
    await page.locator('#providerSave').click();
    await page.locator('#providerDialog').waitFor({state:'hidden'});

    await page.locator('#btnTabCalc').click();
    await page.locator('#wCur').fill('248');
    await page.locator('#submitFormBtn').click();
    await page.locator('#monthlyMailActions').getByRole('button',{name:'Підготувати лист'}).click();
    await page.locator('#providerEmailDialog').waitFor();
    assert.match(await page.locator('#providerReadingsSummary').textContent(),/240 м³.*248 м³.*8 м³/);
    assert.match(await page.locator('#providerEmailBodyText').inputValue(),/248.*240.*8/);
    assert.ok(!(await page.locator('#providerEmailBodyText').inputValue()).includes('125'));
    assert.match(await page.locator('#providerDeliveryStatus').textContent(),/очікує передачі/);
    await page.screenshot({path:'test-results/provider-mail-'+engine+'.png',animations:'disabled'});
    await page.locator('#providerMailDestination').selectOption('gmail');
    const mail=new URL(await page.locator('#providerOpenMail').getAttribute('href'));
    assert.equal(mail.searchParams.get('to'),'water@example.invalid');
    assert.match(mail.searchParams.get('body'),/248/);
    await page.locator('#providerMailDestination').selectOption('copy');
    await page.locator('#providerCopyFullMail').click();
    assert.match(await page.evaluate(()=>window.copiedMail),/248/);
    assert.match(await page.locator('#providerDeliveryStatus').textContent(),/очікує передачі/);
    await page.locator('#providerMarkSent').click();
    assert.match(await page.locator('#providerDeliveryStatus').textContent(),/Надіслано/);
    await page.locator('#providerEmailClose').click();

    await page.locator('#btnTabCalc').click();
    await page.locator('#monthInput').fill(month);
    await page.locator('#wCur').fill('249');
    await page.locator('#submitFormBtn').click();
    await page.locator('#btnTabHistory').click();
    const record=page.locator('[data-provider-record-month="'+month+'"]');
    await record.locator('[data-toggle-details]').click();
    await record.locator('[data-history-mail=water]').click();
    await page.locator('#providerEmailDialog').waitFor();
    assert.match(await page.locator('#providerEmailBodyText').inputValue(),/249/);
    assert.match(await page.locator('#providerDeliveryStatus').textContent(),/змінено після передачі/);
    await page.locator('#providerUndoSent').click();
    assert.match(await page.locator('#providerDeliveryStatus').textContent(),/очікує передачі/);
    await page.locator('#providerEmailClose').click();
    if(process.env.KOMUNALKA_TEST_PWA==='1'){
      await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
      await page.waitForFunction(async()=>{
        const cache=await caches.match('./provider-mail-ui.js');
        return Boolean(cache?.ok);
      });
      await context.setOffline(true);
    }
    await page.reload();
    await page.locator('#appScreen').waitFor({state:'visible'});
    await page.locator('#splashScreen').waitFor({state:'hidden'});
    await page.locator('#monthlyMailActions').getByRole('button',{name:'Підготувати лист'}).click();
    await page.locator('#providerEmailDialog').waitFor();
    assert.match(await page.locator('#providerEmailBodyText').inputValue(),/249/);
    assert.deepEqual(errors,[]);
    console.log(engine+': provider template, saved water values, draft destinations, confirmation, correction, undo and reload passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
