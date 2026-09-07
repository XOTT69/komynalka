import {buildPushPayload} from '@block65/webcrypto-web-push';
import './reminders.js';
const R=globalThis.KomunalkaReminders;
export const pushConfigured=env=>Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
export function validateSubscription(value){
  if(!value||typeof value.endpoint!=='string'||value.endpoint.length>2048)throw new Error('INVALID_PUSH_SUBSCRIPTION');
  const url=new URL(value.endpoint),host=url.hostname;
  const trusted=host==='fcm.googleapis.com'||host==='web.push.apple.com'||host.endsWith('.push.apple.com')||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host.endsWith('.notify.windows.com');
  if(url.protocol!=='https:'||url.port||url.username||url.password||!trusted)throw new Error('INVALID_PUSH_ENDPOINT');
  const key=(s,n)=>{if(typeof s!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(s))return false;try{return atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)).length===n;}catch{return false;}};
  if(!key(value.keys?.p256dh,65)||!key(value.keys?.auth,16))throw new Error('INVALID_PUSH_KEYS');
  return {endpoint:value.endpoint,expirationTime:value.expirationTime??null,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}
export function nextReminderRun(now=Date.now()){
  // Checking UTC instants against Kyiv handles daylight saving without a fixed offset.
  for(let t=Math.ceil((now+1)/900000)*900000;t<now+36*3600000;t+=900000){const date=R.calendar(new Date(t));if(date.hour===9&&new Date(t).getUTCMinutes()===0)return t;}
  return now+24*3600000;
}
export async function sendReminder(env,subscription,message){
  const payload=await buildPushPayload({data:JSON.stringify(message),options:{ttl:3600,urgency:'normal'}},subscription,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
  const response=await fetch(subscription.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(7000)});
  return response.status;
}
export async function deliverReminders(ctx,env,send=sendReminder,now=new Date()){
  const push=await ctx.storage.get('push')||{subscriptions:[]};if(!push.subscriptions.length)return;
  // Set the next alarm before I/O; failures do not permanently stop the schedule.
  await ctx.storage.setAlarm(nextReminderRun(+now));
  if(!pushConfigured(env)||env.MAINTENANCE_MODE==='read-only')return;
  const state=await ctx.storage.get('account');if(!state?.value||state.deleted)return;
  const date=R.calendar(now);if(date.hour<9||date.hour>=21)return;
  const today=`${R.monthKey(date.year,date.month)}-${String(date.day).padStart(2,'0')}`;
  const addresses=state.value.addresses||[{id:'default',prefs:state.value.prefs||{}}];
  const reminders=addresses.flatMap(a=>R.due(a,state.value.accountSettings||{},now));if(!reminders.length)return;
  const labels=[...new Set(reminders.map(r=>r.label))];
  const message={title:'Комуналка · нагадування',body:`Час передати показники: ${labels.join(', ').slice(0,300)}. Відкрийте застосунок, щоб позначити передані.`,tag:`komunalka-reminder-${today}`};
  let retry=false;
  const subscriptions=await Promise.all(push.subscriptions.map(async entry=>{
    if(entry.lastDay===today)return entry;
    try{const status=await send(env,entry.subscription,message);if(status===404||status===410)return null;if(status>=200&&status<300)return{...entry,lastDay:today};retry=true;return entry;}catch{retry=true;return entry;}
  }));
  await ctx.storage.put('push',{subscriptions:subscriptions.filter(Boolean)});
  if(!subscriptions.some(Boolean))await ctx.storage.deleteAlarm();
  else if(retry)await ctx.storage.setAlarm(+now+30*60000);
}
