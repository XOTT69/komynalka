const assert=require('node:assert/strict');
const playwright=require('playwright');
const base=process.env.KOMUNALKA_TEST_URL||'http://127.0.0.1:4174';
const browserName=process.env.KOMUNALKA_BROWSER||'chromium';
const api=response=>new URL(response.url()).pathname==='/__demo/api';
const mutation=response=>api(response)&&response.request().method()==='POST'&&Boolean(response.request().postDataJSON()?.clientMutationId);
const home=addresses=>addresses.find(address=>address.id==='demo-home');

(async()=>{
  const browser=await playwright[browserName].launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},locale:'uk-UA',timezoneId:'Europe/Kyiv'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const nightRow=page.locator('#electroNightRow');
    const previous=page.locator('#nPrev'),current=page.locator('#nCur');
    let month;
    const open=async()=>{
      const loaded=page.waitForResponse(response=>api(response)&&response.request().method()==='GET'&&new URL(response.url()).searchParams.has('t'));
      if(page.url()===base+'/index.html#calc')await page.reload();
      else await page.goto(base+'/index.html#calc');
      const {data}=await(await loaded).json();
      await page.locator('#splashScreen').waitFor({state:'hidden'});
      await page.locator('#tabCalc.tab-active #dCur').waitFor();
      const address=home(data.addresses);
      month??=address.records[0].month;
      const monthInput=page.locator('#monthInput');
      if(await monthInput.inputValue()!==month)await monthInput.fill(month);
      return address;
    };
    const setMode=async enabled=>{
      await page.locator('#btnTabSettings').click();
      await page.locator('[data-settings-open=home]').click();
      const control=page.locator('#prefElectroTwoZone');
      if(await control.isChecked()!==enabled)await page.locator('label:has(#prefElectroTwoZone)').click();
      assert.equal(await control.isChecked(),enabled);
      assert.equal(await page.locator('#prefElectroTwoZoneStatus').textContent(),enabled?'Увімкнено':'Вимкнено');
      const saved=page.waitForResponse(mutation);
      await page.locator('#saveSettingsBtn').click();
      const response=await saved;
      assert.equal((await response.json()).success,true);
      assert.equal(home(response.request().postDataJSON().addresses).prefs.electroTwoZone,enabled);
    };
    const checkFields=async enabled=>{
      await nightRow.waitFor({state:enabled?'visible':'hidden'});
      assert.equal(await previous.isEnabled(),enabled);
      assert.equal(await current.isEnabled(),enabled);
      assert.ok(await page.locator('#dPrev').isVisible());
      assert.ok(await page.locator('#dCur').isVisible());
    };
    const initial=await open();
    assert.equal(initial.prefs.electroTwoZone??false,false);
    await checkFields(false);
    await setMode(true);
    assert.equal((await open()).prefs.electroTwoZone,true);
    await checkFields(true);
    assert.equal(await previous.inputValue(),'');
    await previous.fill('100');
    await current.fill('110');
    await setMode(false);
    assert.equal((await open()).prefs.electroTwoZone,false);
    await checkFields(false);

    await page.locator('#recordNote').fill('Однозонний запис у тесті');
    const saved=page.waitForResponse(mutation);
    await page.locator('#submitFormBtn').click();
    const response=await saved;
    assert.equal((await response.json()).success,true);
    const record=home(response.request().postDataJSON().addresses).records.find(item=>item.month===month);
    assert.equal(record.electroCost,initial.records[0].electroCost);
    assert.equal(record.dCur,initial.records[0].dCur);
    assert.equal(record.nCur,undefined);
    await page.locator('#btnTabDashboard[aria-current=page]').waitFor();

    await setMode(true);
    const reloaded=await open();
    assert.equal(reloaded.prefs.electroTwoZone,true);
    assert.equal(reloaded.records.find(item=>item.month===month).note,record.note);
    await checkFields(true);
    assert.equal(await previous.inputValue(),'100');
    assert.equal(await current.inputValue(),'110');
    assert.equal(await page.locator('#recordNote').inputValue(),record.note);
    await setMode(false);
    await open();
    await checkFields(false);
    assert.deepEqual(errors,[]);
    console.log(`${browserName}: electricity mode, saved preference, hidden inputs, history and night draft passed.`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
