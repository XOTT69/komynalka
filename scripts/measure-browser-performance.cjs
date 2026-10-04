// Reproducible local browser laboratory, fictional accounts only. Not phone RUM.
const {spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.env.KOMUNALKA_LAB_PORT||4182),runs=Number(process.env.KOMUNALKA_LAB_RUNS||5);
if(!Number.isInteger(port)||port<1024||port>65535||!Number.isInteger(runs)||runs<3||runs>10)throw new Error('Invalid laboratory settings');
const base=`http://127.0.0.1:${port}`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
(async()=>{
 await fs.mkdir('test-results',{recursive:true});const browser=await chromium.launch({headless:true}),profiles=[];
 try{
  for(const records of [200,1000]){
   const server=spawn(process.execPath,['scripts/dev.mjs','--demo','--history-records='+records],{env:{...process.env,KOMUNALKA_PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',chunk=>{log+=chunk;});server.stderr.on('data',chunk=>{log+=chunk;});
   try{
    let ready=false;for(let attempt=0;attempt<100;attempt++){if(server.exitCode!==null)throw new Error('Fixture server stopped: '+log);try{if((await fetch(base+'/demo.html')).ok){ready=true;break;}}catch{}await pause(200);}assert.ok(ready,'Isolated fixture server ready');
    const measurements=[];
    for(let run=0;run<runs;run++){
     const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
     // Routing deliberately disables the HTTP cache. No production requests.
     await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
     const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
     await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:70,downloadThroughput:1250000,uploadThroughput:625000});
     await page.addInitScript(()=>{window.__labLongTasks=[];try{new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__labLongTasks.push(entry.duration);}).observe({type:'longtask',buffered:true});}catch{}});
     const start=performance.now();await page.goto(base+'/index.html');await page.locator('#appScreen').waitFor({state:'visible'});await page.locator('#splashScreen').waitFor({state:'hidden'});await page.locator('#currentAddressDisplay').filter({hasText:'Квартира'}).waitFor();
     const readyMs=Math.round(performance.now()-start),startup=await page.evaluate(()=>({longTasks:window.__labLongTasks.length,blockingMs:Math.round(window.__labLongTasks.reduce((sum,duration)=>sum+Math.max(0,duration-50),0))}));
     const historyStart=performance.now();await page.locator('#btnTabHistory').click();await page.locator('#tabHistory').waitFor({state:'visible'});await page.locator('.rec-del').first().waitFor({state:'attached'});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
     const historyMs=Math.round(performance.now()-historyStart),count=Number((await page.locator('#statsCount').textContent()).replace(/\D/g,''));assert.equal(count,records);assert.ok(await page.locator('.rec-del').count()<=50,'History renders a bounded first page');assert.deepEqual(errors,[]);
     measurements.push({run:run+1,readyMs,historyMs,...startup});await context.close();
    }
    profiles.push({records,measurements,medianReadyMs:percentile(measurements.map(row=>row.readyMs),.5),maxReadyMs:Math.max(...measurements.map(row=>row.readyMs)),medianHistoryMs:percentile(measurements.map(row=>row.historyMs),.5),maxHistoryMs:Math.max(...measurements.map(row=>row.historyMs))});
   }finally{server.kill('SIGTERM');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));await fs.writeFile('test-results/performance-fixture-'+records+'.log',log);}
  }
 }finally{await browser.close();}
 const report={kind:'local-chromium-laboratory-not-physical-phone',measuredAt:new Date().toISOString(),version:require('../package.json').version,viewport:{width:390,height:844},cpuSlowdown:4,simulatedNetwork:{latencyMs:70,downloadMbps:10,uploadMbps:5},cache:'fresh browser context; HTTP cache disabled',scope:'localhost Worker adapter and fictional data; includes browser/test runner overhead; not production latency or Core Web Vitals',runsPerProfile:runs,profiles};
 await fs.writeFile('test-results/browser-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
