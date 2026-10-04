// Aggregate operational counters only. Never persist request bodies, identities or URLs.
export const METRIC_OPERATIONS=Object.freeze(['login','register','google_link','sync_read','sync_write','password','push_setup','telegram_setup','telegram_webhook','feedback','ai','push_reminder','telegram_reminder']);
export const METRIC_OUTCOMES=Object.freeze(['ok','auth','conflict','limited','rejected','expired','failed']);
export const METRIC_BOUNDS=Object.freeze([100,300,1000,3000,10000,60000]);
export const METRIC_RETENTION=14;
const operationSet=new Set(METRIC_OPERATIONS),DAY=86400000;
const dayKey=now=>new Date(now).toISOString().slice(0,10);
export function metricOperation(action){
  if(action==='')return 'sync_write';
  if(action==='auth_login'||action==='auth_upgrade_session')return 'login';
  if(action==='auth_register')return 'register';
  if(action==='link_google')return 'google_link';
  if(action==='change_password')return 'password';
  if(['push_subscribe','push_unsubscribe','push_test'].includes(action))return 'push_setup';
  if(['telegram_begin','telegram_unlink','telegram_test'].includes(action))return 'telegram_setup';
  if(['feedback_submit','feedback_public_submit'].includes(action))return 'feedback';
  if(action==='ai_chat')return 'ai';
  return null;
}
export function metricOutcome(operation,status){
  if(status>=200&&status<300)return 'ok';
  if(operation==='push_reminder'&&(status===404||status===410))return 'expired';
  if(status===401||status===403)return 'auth';
  if(status===409)return 'conflict';
  if(status===429)return 'limited';
  return status>=300&&status<500?'rejected':'failed';
}
function safeEvent(event){
  if(!operationSet.has(event?.operation)||!Number.isInteger(event.status)||event.status<0||event.status>599||!Number.isFinite(event.durationMs)||event.durationMs<0)return null;
  return {operation:event.operation,status:event.status,durationMs:Math.min(event.durationMs,600000)};
}
// The caller's response or reminder delivery never waits for monitoring. A failed
// counter write is dropped, and this is explicitly disclosed in the dashboard.
export function recordMetrics(env,ctx,events){
  const safe=events.map(safeEvent).filter(Boolean).slice(0,128);
  if(!safe.length||!env.ACCOUNT_STORE||typeof ctx?.waitUntil!=='function')return;
  try{
    const stub=env.ACCOUNT_STORE.get(env.ACCOUNT_STORE.idFromName('__service_metrics__'));
    const controller=new AbortController();let timer;
    const task=Promise.race([
      Promise.resolve().then(()=>stub.fetch(new Request('https://account.internal',{method:'POST',signal:controller.signal,body:JSON.stringify({action:'metrics-record',events:safe})}))),
      new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve();},1500);})
    ]).catch(()=>{}).finally(()=>clearTimeout(timer));
    ctx.waitUntil(task);
  }catch{/* Monitoring must never interrupt a user operation. */}
}
const empty=()=>({outcomes:Object.fromEntries(METRIC_OUTCOMES.map(key=>[key,0])),latency:Array(METRIC_BOUNDS.length+1).fill(0)});
export async function pruneMetrics(ctx,now=Date.now()){
  const days=await ctx.storage.list({prefix:'metrics:',limit:100});
  const cutoff=dayKey(now-(METRIC_RETENTION-1)*DAY);
  for(const [key] of days)if(key.slice(8)<cutoff)await ctx.storage.delete(key);
  const remaining=await ctx.storage.list({prefix:'metrics:',limit:1});
  if(remaining.size)await ctx.storage.setAlarm(Math.floor(now/DAY)*DAY+DAY+60000);
  else await ctx.storage.deleteAlarm();
}
export async function metricsAction(ctx,body,now=Date.now()){
  if(body.action==='metrics-record'){
    if(!Array.isArray(body.events)||body.events.length>128)throw new Error('INVALID_METRICS');
    const events=body.events.map(safeEvent);if(events.some(event=>!event))throw new Error('INVALID_METRICS');
    const key='metrics:'+dayKey(now),data=await ctx.storage.get(key)||{};
    for(const event of events){
      const entry=data[event.operation]||empty(),outcome=metricOutcome(event.operation,event.status);
      entry.outcomes[outcome]++;
      const index=METRIC_BOUNDS.findIndex(bound=>event.durationMs<=bound);
      entry.latency[index===-1?METRIC_BOUNDS.length:index]++;
      data[event.operation]=entry;
    }
    await ctx.storage.put(key,data);
    if(!await ctx.storage.get('metrics-started'))await ctx.storage.put('metrics-started',new Date(now).toISOString());
    await ctx.storage.put('metrics-enabled',true);
    await pruneMetrics(ctx,now);
    return {success:true};
  }
  if(body.action==='metrics-read'){
    const period=Number(body.days??7);if(![1,7,14].includes(period))throw new Error('INVALID_METRICS_PERIOD');
    await pruneMetrics(ctx,now);
    const cutoff=dayKey(now-(period-1)*DAY),days=await ctx.storage.list({prefix:'metrics:',limit:METRIC_RETENTION});
    const totals=Object.fromEntries(METRIC_OPERATIONS.map(operation=>[operation,empty()]));
    for(const [key,data] of days){if(key.slice(8)<cutoff)continue;
      for(const operation of METRIC_OPERATIONS){const item=data[operation];if(!item)continue;
        for(const outcome of METRIC_OUTCOMES)totals[operation].outcomes[outcome]+=item.outcomes[outcome]||0;
        item.latency.forEach((count,index)=>{totals[operation].latency[index]+=count;});
      }
    }
    const rows=METRIC_OPERATIONS.map(operation=>{const item=totals[operation],count=item.latency.reduce((a,b)=>a+b,0);let accumulated=0,p95UpperMs=null;
      if(count)for(let index=0;index<item.latency.length;index++){accumulated+=item.latency[index];if(accumulated>=Math.ceil(count*.95)){p95UpperMs=METRIC_BOUNDS[index]??null;break;}}
      return {operation,count,...item.outcomes,p95UpperMs};
    });
    return {success:true,days:period,retentionDays:METRIC_RETENTION,dayBoundary:'UTC',from:cutoff,through:dayKey(now),startedAt:await ctx.storage.get('metrics-started')||null,checkedAt:new Date(now).toISOString(),collection:'best-effort',latency:'histogram-upper-bound',rows};
  }
  throw new Error('INVALID_METRICS_ACTION');
}
