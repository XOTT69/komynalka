const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const playwright=require('playwright');
const engine=process.env.KOMUNALKA_BROWSER||'chromium';
const base=process.env.KOMUNALKA_TEST_URL||'http://127.0.0.1:4174';
if(!['chromium','webkit','firefox'].includes(engine))throw new Error('Unsupported browser');

(async()=>{
 const browser=await playwright[engine].launch({headless:true});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   // Clipboard permissions differ across engines. This checks our resulting UI,
   // while a manual browser check covers the actual clipboard permission flow.
   await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__testCopied=text;}}}));
   await page.goto(base+'/index.html?address=demo-other#calc');
   await page.locator('#appScreen').waitFor({state:'visible'});
   await page.locator('#splashScreen').waitFor({state:'hidden'});
   assert.match(await page.locator('#currentAddressDisplay').textContent(),/^(Будинок · Ірпінь|Тестовий будинок)$/);
   assert.equal(new URL(page.url()).search,'');
   await page.locator('#btnTabDashboard').click();await page.locator('#resumeOnboarding').click();
   await page.locator('#onboardingDialog').waitFor({state:'visible'});
   await page.locator('#onboardingFields input[name=name]').fill('Тестовий будинок');
   await page.locator('#onboardingFields input[name=showGas]').uncheck();
   await page.locator('#onboardingNext').click();
   await page.locator('#onboardingFields input[name=water]').fill('56.7');
   await page.locator('#onboardingLater').click();
   await page.locator('#resumeOnboarding').click();
   assert.equal(await page.locator('#onboardingFields input[name=water]').inputValue(),'56.7');
   await page.locator('#onboardingNext').click();
   await page.locator('#onboardingFields input[name=wPrev]').fill('267');
   await page.locator('#onboardingNext').click();
   await page.locator('#onboardingDialog').waitFor({state:'hidden'});
   assert.equal(await page.locator('#wPrev').inputValue(),'267');
   await page.locator('#wCur').fill('280');await page.locator('#dPrev').fill('0');await page.locator('#dCur').fill('0');
   await page.locator('#btnTabDashboard').click();
   await page.reload();await page.locator('#appScreen').waitFor({state:'visible'});
   await page.locator('#btnTabCalc').click();assert.equal(await page.locator('#wCur').inputValue(),'280');
   await page.locator('#addressHeaderTrigger').click();
   await page.locator('[data-addr-id=demo-home]').click();
   await page.locator('#addressModal').waitFor({state:'hidden'});
   await page.locator('#btnTabDashboard').click();await page.locator('#monthlySummaryOpen').click();
   await page.locator('#monthlySummaryDialog').waitFor({state:'visible'});
   assert.match(await page.locator('#monthlySummaryText').inputValue(),/Нараховано:/);
   await page.locator('#monthlySummaryCopy').click();await page.locator('#monthlySummaryCopyStatus').filter({hasText:'скопійовано'}).waitFor();
   await page.locator('#monthlySummaryClose').click();
   await page.locator('#btnTabHistory').click();assert.ok(await page.locator('.rec-del').count()>0);
   if(width===390){const bounds=await page.locator('#bottomNav').boundingBox();assert.ok(Math.abs(bounds.y+bounds.height-844)<2);}
   assert.ok(await page.locator('#swipeContainer').evaluate(element=>element.scrollWidth<=element.clientWidth+2));
   await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:`test-results/critical-${engine}-${width}.png`});
   await page.goto(base+'/demo.html');await page.locator('#demoCurrent').fill('281');
   await page.locator('#demoPrepare').click();assert.match(await page.locator('#demoMail').inputValue(),/Різниця 14/);
   await page.locator('#demoCopy').click();assert.match(await page.locator('#demoCopyStatus').textContent(),/скопійовано/);
   await page.request.post(base+'/__demo/api',{data:{action:'feedback_public_submit',category:'other',message:'Fictional browser regression feedback '+width}});
   await page.goto(base+'/admin.html');await page.locator('#adminPass').fill('test-only-password');await page.locator('#loginBtn').click();
   await page.locator('#usersTableBody .user-row').first().waitFor();assert.ok(Number(await page.locator('#statUsers').textContent())>=1);
   await page.locator('#searchUsers').fill('no-such-fictional-account');await page.locator('#pageInfo').filter({hasText:'Немає результатів'}).waitFor();
   assert.ok(Number(await page.locator('#statUsers').textContent())>=1);
   await page.locator('[data-admin-tab=feedback]').click();await page.locator('#feedbackList article').first().waitFor();
   assert.match(await page.locator('#feedbackList').textContent(),/Fictional browser regression/);
   await page.screenshot({path:`test-results/admin-directory-${engine}-${width}.png`});
   await page.locator('[data-admin-tab=security]').click();await page.locator('#metricsStatus').filter({hasText:'Перевірено'}).waitFor();assert.match(await page.locator('#metricsRows').textContent(),/Завантаження даних/);
   await page.locator('#metricsPeriod').selectOption('1');await page.locator('#metricsStatus').filter({hasText:'Перевірено'}).waitFor();assert.ok(await page.locator('.reliability-row').count()>0);
   assert.ok(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth+2));await page.screenshot({path:`test-results/reliability-${engine}-${width}.png`});
   assert.deepEqual(errors,[]);await context.close();console.log(`${engine} ${width}: setup, drafts, address links, summary, history, demo passed`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
