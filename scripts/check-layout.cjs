const {chromium}=require(process.env.KOMUNALKA_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{fs.mkdirSync('test-results',{recursive:true});const browser=await chromium.launch({executablePath:process.env.KOMUNALKA_BROWSER_EXECUTABLE || undefined,headless:true});const results=[];
try{for(const width of [320,390,768,1280]){
 const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,colorScheme:width===390?'dark':'light'});const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4174/');await p.locator('#monthlyTasksList .month-task').first().waitFor();await p.locator('#splashScreen').waitFor({state:'hidden'});await p.waitForTimeout(350);
 const nav=await p.locator('#bottomNav').boundingBox();if(width<1000)assert.ok(Math.abs(nav.y+nav.height-844)<2);else assert.equal(nav.x,0);
 await p.locator('#swipeContainer').evaluate(e=>e.scrollTop=e.scrollHeight);assert.deepEqual(await p.locator('#bottomNav').boundingBox(),nav);
 await p.locator('#swipeContainer').evaluate(e=>e.scrollTop=0);if(width===390)await p.screenshot({path:'test-results/monthly-mobile.png'});
 await p.locator('#btnTabCalc').click();await p.waitForTimeout(350);
 const bounds=await p.locator('#utilityForm input[type=number]:visible').evaluateAll(els=>els.map(e=>({id:e.id,x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})));
 assert.ok(bounds.every(b=>b.width>=55&&b.x>=0&&b.right<=width+1),JSON.stringify({width,bounds}));
 if(width===390)await p.screenshot({path:'test-results/entry-mobile.png'});
 const savedReading=await p.locator('#wCur').inputValue();await p.locator('#wCur').fill('1');await p.locator('#paymentStatusInput').selectOption('partial');assert.equal(await p.locator('#entryReviewTotal').textContent(),'—');await p.locator('#wCur').fill(savedReading);
 await p.locator('#entryReviewTitle').scrollIntoViewIfNeeded();assert.ok(await p.locator('#submitFormBtn').isVisible());
 await p.locator('#btnTabSettings').click();await p.locator('#aiFabBtn').click();await p.locator('#aiChatPanel').waitFor({state:'visible'});await p.locator('#aiCloseBtn').click();await p.locator('#aiChatPanel').waitFor({state:'hidden'});await p.locator('label[for="prefReminders"]').click();await p.locator('#customRemindersList').scrollIntoViewIfNeeded();
 const dates=await p.locator('.reminder-period input').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})));
 assert.ok(dates.every(b=>b.width>=55&&b.x>=0&&b.right<=width+1),JSON.stringify({width,dates}));
 if(width===390){
 await p.addStyleTag({content:'html{font-size:32px!important}body{font-size:1rem!important}'});await p.locator('#btnTabDashboard').click();await p.waitForTimeout(350);
 const large=await p.locator('#bottomNav').boundingBox();assert.ok(Math.abs(large.y+large.height-844)<2);
 const buttons=await p.locator('#bottomNav .nav-btn:visible').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right})));assert.ok(buttons.every(b=>b.x>=0&&b.right<=width+1));
 const amounts=await p.locator('.summary-split>div').evaluateAll(es=>es.map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom})));assert.ok(amounts[0].bottom<=amounts[1].top);
 await p.screenshot({path:'test-results/text-200-percent.png'});
 await p.setViewportSize({width,height:420});await p.waitForTimeout(150);const short=await p.locator('#bottomNav').boundingBox();assert.ok(Math.abs(short.y+short.height-420)<2);
 }
 assert.deepEqual(errors,[]);results.push({width,menuFixed:true,readingsFit:true,reminderDatesFit:true});await context.close();
}console.log(JSON.stringify(results));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
