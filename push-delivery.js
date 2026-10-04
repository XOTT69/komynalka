import {recordMetrics} from './service-metrics.js';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import {sendTelegram} from './telegram.js';
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
export function nextReminderRun(now=Date.now(),time='09:00'){
  // Search Kyiv wall-clock minutes so DST changes and user-selected minutes stay correct.
  const [hour,minute]=R.notificationTime({reminderTime:time}).split(':').map(Number),target=hour*60+minute,current=R.calendar(new Date(now)),currentDay=`${R.monthKey(current.year,current.month)}-${current.day}`;
  for(let t=Math.ceil((now+1)/60000)*60000;t<now+49*3600000;t+=60000){
    const date=R.calendar(new Date(t)),day=`${R.monthKey(date.year,date.month)}-${date.day}`,minutes=date.hour*60+date.minute;
    if(day===currentDay&&(current.hour*60+current.minute)>=target)continue;
    const previous=R.calendar(new Date(t-60000)),previousDay=`${R.monthKey(previous.year,previous.month)}-${previous.day}`;
    if(minutes>=target&&(previousDay!==day||previous.hour*60+previous.minute<target))return t;
  }
  return now+24*3600000;
}
export async function sendReminder(env,subscription,message){
  const payload=await buildPushPayload({data:JSON.stringify(message),options:{ttl:3600,urgency:'normal'}},subscription,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  let response;
  try{response=await fetch(subscription.endpoint,{...payload,redirect:'manual',signal:controller.signal});}
  finally{clearTimeout(timer);}
  return response.status;
}
export async function deliverReminders(ctx,env,send=sendReminder,now=new Date(),sendTg=sendTelegram){
  const push=await ctx.storage.get('push')||{subscriptions:[]},telegram=await ctx.storage.get('telegram');if(!push.subscriptions.length&&!telegram?.chatId)return;
  const state=await ctx.storage.get('account'),time=R.notificationTime(state?.value?.accountSettings||{});
  // Set the next alarm before I/O; failures do not permanently stop the schedule.
  await ctx.storage.setAlarm(nextReminderRun(+now,time));
  if(env.MAINTENANCE_MODE==='read-only')return;
  if(!state?.value||state.deleted)return;
  const date=R.calendar(now),[hour,minute]=time.split(':').map(Number);if(date.hour*60+date.minute<hour*60+minute)return;
  const today=`${R.monthKey(date.year,date.month)}-${String(date.day).padStart(2,'0')}`;
  const addresses=(state.value.addresses||[{id:'default',prefs:state.value.prefs||{}}]).filter(address=>!address?.archivedAt);
  const reminders=addresses.flatMap(a=>R.due(a,state.value.accountSettings||{},now));if(!reminders.length)return;
  const labels=[...new Set(reminders.map(r=>r.label))];
  const addressId=String(reminders[0].addressId||'default');
  const message={title:'Комуналка · нагадування',body:`Час передати показники: ${labels.join(', ').slice(0,300)}. Відкрийте застосунок, щоб позначити передані.`,tag:`komunalka-reminder-${today}`,addressId};
  let retry=false;const metrics=[];
  const subscriptions=await Promise.all(push.subscriptions.map(async entry=>{
    if(!pushConfigured(env))return entry;
    if(entry.lastDay===today)return entry;
    const started=performance.now();
    try{const status=await send(env,entry.subscription,message);metrics.push({operation:'push_reminder',status,durationMs:performance.now()-started});if(status===404||status===410)return null;if(status>=200&&status<300)return{...entry,lastDay:today,lastAttemptAt:+now,lastStatus:status};retry=true;return {...entry,lastAttemptAt:+now,lastStatus:status};}catch{metrics.push({operation:'push_reminder',status:0,durationMs:performance.now()-started});retry=true;return {...entry,lastAttemptAt:+now,lastStatus:0};}
  }));
  await ctx.storage.put('push',{subscriptions:subscriptions.filter(Boolean)});
  if(telegram?.chatId&&env.TG_BOT_TOKEN&&telegram.lastDay!==today){
    const started=performance.now();let recorded=false;try{
      const targets=[...new Set(reminders.map(item=>String(item.addressId||'default')))];
      const links=targets.slice(0,10).map((id,index)=>`Адреса ${index+1}: https://mykomunalka.pp.ua/index.html?address=${encodeURIComponent(id)}#calc`).join('\n');
      const text=`Комуналка · нагадування\nЧас передати показники: ${labels.join(', ').slice(0,250)}.\nВнести показники:\n${links}${targets.length>10?'\nРешта адрес — у застосунку.':''}\nПісля передачі позначте її в застосунку.`;
      const status=await sendTg(env,telegram.chatId,text);metrics.push({operation:'telegram_reminder',status,durationMs:performance.now()-started});recorded=true;
      await ctx.storage.put('telegram',{...telegram,lastAttemptAt:+now,lastStatus:status,...(status>=200&&status<300?{lastDay:today}:{})});
      if(status<200||status>=300)retry=true;
    }catch{if(!recorded)metrics.push({operation:'telegram_reminder',status:0,durationMs:performance.now()-started});retry=true;await ctx.storage.put('telegram',{...telegram,lastAttemptAt:+now,lastStatus:0});}
  }
  recordMetrics(env,ctx,metrics);
  if(retry)await ctx.storage.setAlarm(+now+30*60000);
  else if(!subscriptions.some(Boolean)&&!telegram?.chatId)await ctx.storage.deleteAlarm();
}
