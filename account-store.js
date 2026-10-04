import {pushConfigured,validateSubscription,deliverReminders,sendReminder} from './push-delivery.js';
import {sendTelegram} from './telegram.js';
import {accountSummary,directoryAction} from './admin-directory.js';
/* A serialized authority for each account; the original KV snapshot is retained.
 * All account writers must go through this object after the coordinated cutover.
 */
export class AccountStore {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async flushDirectory(force=false){
    const summary=await this.ctx.storage.get('directory-pending');if(!summary)return;
    try{
      const stub=this.env.ACCOUNT_STORE.get(this.env.ACCOUNT_STORE.idFromName('__admin_directory__'));
      const response=await stub.fetch(new Request('https://account.internal',{method:'POST',body:JSON.stringify({action:'directory-upsert',summary,force})}));
      if(!response.ok)throw new Error('INDEX_UNAVAILABLE');
      await this.ctx.storage.put('directory-revision',summary.revision);await this.ctx.storage.delete('directory-pending');
    }catch{console.error('Admin index update deferred');await this.ctx.storage.setAlarm(Date.now()+60000);}
  }
  async cleanupDeleted(){
    const keys=await this.ctx.storage.get('delete-cleanup')||[],remaining=[];
    for(const key of keys)try{await this.env.KV.delete(key);}catch{remaining.push(key);}
    if(remaining.length){await this.ctx.storage.put('delete-cleanup',remaining);await this.ctx.storage.setAlarm(Date.now()+60000);}
    else{await this.ctx.storage.delete('delete-cleanup');await this.ctx.storage.deleteAlarm();}
    return Response.json({success:true,cleanupPending:Boolean(remaining.length)});
  }
  async alarm(){return this.ctx.blockConcurrencyWhile(async()=>{
    await this.flushDirectory();
    if(await this.ctx.storage.get('delete-cleanup')){const result=await this.cleanupDeleted();if(await this.ctx.storage.get('directory-pending'))await this.ctx.storage.setAlarm(Date.now()+60000);return result;}
    if(this.ctx.storage.list){const expired=await this.ctx.storage.list({prefix:'rate:',limit:1000});for(const [key,value] of expired)if(value.expiresAt<=Date.now())await this.ctx.storage.delete(key);const remaining=await this.ctx.storage.list({prefix:'rate:',limit:1});if(remaining.size)await this.ctx.storage.setAlarm(Date.now()+3600000);}
    const result=await deliverReminders(this.ctx,this.env);
    if(await this.ctx.storage.get('directory-pending')){const alarm=await this.ctx.storage.getAlarm();await this.ctx.storage.setAlarm(Math.min(alarm||Infinity,Date.now()+60000));}
    return result;
  });}
  async fetch(request){
    const body=await request.json();
    return this.ctx.blockConcurrencyWhile(async()=>{
      const action=String(body.action||'');
      if(action.startsWith('directory-')){
        try{return Response.json(await directoryAction(this.ctx,body));}
        catch(error){return Response.json({error:error.message},{status:/^INVALID_/.test(error.message)?400:503});}
      }
      // One dedicated object serializes security counters and administrator sessions.
      if(action==='rate-limit'){
        const now=Date.now(),windowMs=Math.max(1000,Math.min(Number(body.windowMs)||60000,86400000)),limit=Math.max(1,Math.min(Number(body.limit)||1,10000));
        const bucket=Math.floor(now/windowMs),key=String(body.key||'').slice(0,240);
        if(!key)return Response.json({error:'INVALID_RATE_KEY'},{status:400});
        // One compact value per identity cannot overflow a shared map during an attack.
        const storageKey=`rate:${key}`,stored=await this.ctx.storage.get(storageKey);
        const entry=stored?.bucket===bucket?stored:{bucket,count:0,expiresAt:(bucket+2)*windowMs};
        if(entry.count>=limit)return Response.json({success:true,allowed:false,retryAfter:Math.max(1,Math.ceil(((bucket+1)*windowMs-now)/1000))});
        entry.count+=1;await this.ctx.storage.put(storageKey,entry);
        if(!await this.ctx.storage.getAlarm())await this.ctx.storage.setAlarm(now+windowMs*2);
        return Response.json({success:true,allowed:true,remaining:Math.max(0,limit-entry.count)});
      }
      if(action.startsWith('admin-session-')){
        const now=Date.now();let sessions=(await this.ctx.storage.get('admin-sessions')||[]).filter(item=>item.expiresAt>now);
        if(action==='admin-session-create'){
          if(!/^[a-f0-9]{64}$/.test(body.tokenHash||''))return Response.json({error:'INVALID_TOKEN'},{status:400});
          sessions=[...sessions,{tokenHash:body.tokenHash,createdAt:now,expiresAt:now+Math.max(300000,Math.min(Number(body.ttl)||3600000,7200000))}].slice(-8);
          await this.ctx.storage.put('admin-sessions',sessions);return Response.json({success:true,expiresAt:sessions.at(-1).expiresAt});
        }
        if(action==='admin-session-verify'){
          const session=sessions.find(item=>item.tokenHash===body.tokenHash);await this.ctx.storage.put('admin-sessions',sessions);
          return Response.json({success:Boolean(session),expiresAt:session?.expiresAt||null},{status:session?200:401});
        }
        if(action==='admin-session-revoke'){
          sessions=sessions.filter(item=>item.tokenHash!==body.tokenHash);await this.ctx.storage.put('admin-sessions',sessions);return Response.json({success:true});
        }
        return Response.json({error:'INVALID_ACTION'},{status:400});
      }
      // The community catalogue is serialized here to prevent lost votes and moderation edits.
      if(action.startsWith('community-')){
        let community=await this.ctx.storage.get('community');
        if(!community){let list=[];try{const raw=await this.env.KV.get('community_tariffs');if(raw)list=JSON.parse(raw);if(!Array.isArray(list))list=[];}catch{list=[];}community={list,revision:1};await this.ctx.storage.put('community',community);}
        if(action==='community-restore'){if(!Array.isArray(body.snapshot?.list)||body.snapshot.list.length>200||!Number.isInteger(body.snapshot.revision)||body.snapshot.revision<1)return Response.json({error:'INVALID_COMMUNITY_DATA'},{status:400});community={list:body.snapshot.list,revision:body.snapshot.revision};await this.ctx.storage.put('community',community);return Response.json({success:true,revision:community.revision});}
        if(action==='community-read')return Response.json({success:true,list:community.list,revision:community.revision});
        if(action==='community-replace'){
          if(body.expectedRevision!==community.revision)return Response.json({error:'CONFLICT',revision:community.revision},{status:409});
          if(!Array.isArray(body.list)||body.list.length>200)return Response.json({error:'INVALID_COMMUNITY_DATA'},{status:400});
          community={list:body.list,revision:community.revision+1};await this.ctx.storage.put('community',community);
          try{await this.env.KV.put('community_tariffs',JSON.stringify(community.list),{expirationTtl:86400*365});}catch{console.error('Community KV mirror failed');}
          return Response.json({success:true,revision:community.revision});
        }
        return Response.json({error:'INVALID_ACTION'},{status:400});
      }
      let state=await this.ctx.storage.get('account');
      if(!state){
        const raw=await this.env.KV.get(body.login);
        let value=null;
        if(raw){try{value=JSON.parse(raw);}catch{throw new Error('UNSUPPORTED_LEGACY_ACCOUNT');}if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_LEGACY_ACCOUNT');}
        state={login:body.login,value,revision:value?1:0,receipts:[],deleted:false};
        await this.ctx.storage.put({'account':state,'legacy-original':{raw,importedAt:Date.now()}});
      }
      if(state.login!==body.login)return Response.json({error:'ACCOUNT_MISMATCH'},{status:403});
      if(state.value&&(await this.ctx.storage.get('directory-revision'))!==state.revision){await this.ctx.storage.put('directory-pending',accountSummary(state));await this.flushDirectory();}
      if(action.startsWith('session-')){
        if(state.deleted||!state.value)return Response.json({error:'NOT_FOUND'},{status:404});
        const now=Date.now();let sessions=(await this.ctx.storage.get('sessions')||[]).filter(item=>item.expiresAt>now);
        if(action==='session-create'){
          if(!/^[a-f0-9]{64}$/.test(body.tokenHash||''))return Response.json({error:'INVALID_TOKEN'},{status:400});
          const entry={tokenHash:body.tokenHash,createdAt:now,expiresAt:now+Math.max(3600000,Math.min(Number(body.ttl)||2592000000,7776000000)),device:String(body.device||'').slice(0,120),deviceName:String(body.deviceName||'Пристрій').slice(0,80)};
          sessions=[...sessions.filter(item=>item.tokenHash!==entry.tokenHash),entry].slice(-12);await this.ctx.storage.put('sessions',sessions);
          return Response.json({success:true,expiresAt:entry.expiresAt});
        }
        if(action==='session-verify'){
          const session=sessions.find(item=>item.tokenHash===body.tokenHash);await this.ctx.storage.put('sessions',sessions);
          return Response.json({success:Boolean(session),expiresAt:session?.expiresAt||null},{status:session?200:401});
        }
        if(action==='session-revoke'){
          sessions=sessions.filter(item=>item.tokenHash!==body.tokenHash);await this.ctx.storage.put('sessions',sessions);return Response.json({success:true});
        }
        if(action==='session-revoke-all'){await this.ctx.storage.put('sessions',[]);return Response.json({success:true});}
        if(action==='session-list')return Response.json({success:true,sessions:sessions.map(({tokenHash,...item})=>({...item,id:tokenHash,current:tokenHash===body.currentTokenHash}))});
        if(action==='session-revoke-others'){await this.ctx.storage.put('sessions',sessions.filter(item=>item.tokenHash===body.currentTokenHash));return Response.json({success:true});}
        return Response.json({error:'INVALID_ACTION'},{status:400});
      }
      if(action.startsWith('share-')){
        if(state.deleted||!state.value)return Response.json({error:'NOT_FOUND'},{status:404});
        const now=Date.now();let shares=(await this.ctx.storage.get('shares')||[]).filter(item=>item.expiresAt>now);
        if(action==='share-add'||action==='share-import'){
          const entry={tokenHash:String(body.tokenHash||''),token:String(body.token||''),addressId:String(body.addressId||''),createdAt:Number(body.createdAt)||now,expiresAt:Number(body.expiresAt)||now,kvKey:body.kvKey||`share:${body.token}`};
          if(!/^[a-f0-9]{64}$/.test(entry.tokenHash)||!/^[-_A-Za-z0-9]{12,128}$/.test(entry.token)||!entry.addressId||entry.expiresAt<=now)return Response.json({error:'INVALID_SHARE'},{status:400});
          if(await this.ctx.storage.get(`share-revoked:${entry.tokenHash}`))return Response.json({error:'INVALID_OR_EXPIRED'},{status:404});
          if(action==='share-add'&&shares.length>=30)return Response.json({error:'SHARE_LIMIT'},{status:409});
          shares=[...shares.filter(item=>item.tokenHash!==entry.tokenHash),entry];await this.ctx.storage.put('shares',shares);return Response.json({success:true});
        }
        if(action==='share-list'){await this.ctx.storage.put('shares',shares);return Response.json({success:true,shares});}
        if(action==='share-verify')return Response.json({success:shares.some(item=>item.tokenHash===body.tokenHash&&String(item.addressId)===String(body.addressId))});
        if(action==='share-revoke'){const removed=shares.find(item=>item.tokenHash===body.tokenHash);await this.ctx.storage.put(`share-revoked:${body.tokenHash}`,{revokedAt:now});shares=shares.filter(item=>item.tokenHash!==body.tokenHash);await this.ctx.storage.put('shares',shares);return Response.json({success:true,token:removed?.token||null,kvKey:removed?.kvKey||null});}
        if(action==='share-clear'){await this.ctx.storage.put('shares',[]);return Response.json({success:true,tokens:shares.map(item=>item.token).filter(Boolean)});}
        return Response.json({error:'INVALID_ACTION'},{status:400});
      }
      if(action.startsWith('telegram-')){
        if(state.deleted||!state.value)return Response.json({error:'NOT_FOUND'},{status:404});
        const telegram=await this.ctx.storage.get('telegram')||{};
        if(body.action==='telegram-status'){
          if(telegram.chatId)await this.ctx.storage.setAlarm(Date.now()+5000);
          return Response.json({success:true,connected:Boolean(telegram.chatId),chatId:telegram.chatId||null,chatLabel:telegram.chatId?telegram.chatLabel||'Приватний чат':null,lastReminderDay:telegram.lastDay||null,lastTestAt:telegram.lastTestAt||null,lastAttemptAt:telegram.lastAttemptAt||null,lastStatus:telegram.lastStatus??null});
        }
        if(body.action==='telegram-begin'){
          if(!/^[a-f0-9]{32}$/.test(body.ticket))return Response.json({error:'INVALID_TOKEN'},{status:400});
          await this.ctx.storage.put('telegram',{...telegram,pending:body.ticket,pendingUntil:Date.now()+10*60000});
          return Response.json({success:true});
        }
        if(body.action==='telegram-confirm'){
          if(!/^-?\d{1,20}$/.test(body.chatId)||telegram.pending!==body.ticket||telegram.pendingUntil<Date.now())return Response.json({success:false});
          const previousChatId=telegram.chatId;
          await this.ctx.storage.put('telegram',{chatId:body.chatId,chatLabel:'Приватний чат',...(telegram.chatId===body.chatId&&telegram.lastDay?{lastDay:telegram.lastDay}:{})});
          await this.ctx.storage.setAlarm(Date.now()+5000);
          return Response.json({success:true,previousChatId});
        }
        if(body.action==='telegram-unlink'){
          if(body.chatId&&telegram.chatId!==body.chatId)return Response.json({success:false});
          await this.ctx.storage.delete('telegram');
          const push=await this.ctx.storage.get('push');if(!push?.subscriptions?.length)await this.ctx.storage.deleteAlarm();
          return Response.json({success:true,previousChatId:telegram.chatId||null});
        }
        if(body.action==='telegram-test'){
          if(!telegram.chatId||!this.env.TG_BOT_TOKEN)return Response.json({error:'TELEGRAM_NOT_CONNECTED'},{status:409});
          const now=Date.now();
          if(now-(telegram.testAttemptAt||0)<60000)return Response.json({error:'TEST_RATE_LIMITED'},{status:429});
          await this.ctx.storage.put('telegram',{...telegram,testAttemptAt:now});
          const status=await sendTelegram(this.env,telegram.chatId,'Комуналка · тестове повідомлення. Нагадування до цього чату підключені.');
          if(status<200||status>=300)return Response.json({error:'TELEGRAM_TEST_FAILED'},{status:502});
          await this.ctx.storage.put('telegram',{...telegram,testAttemptAt:now,lastTestAt:now});
          return Response.json({success:true,sentAt:now});
        }
        return Response.json({error:'INVALID_ACTION'},{status:400});
      }
      if(body.action.startsWith('push-')){
        if(state.deleted||!state.value)return Response.json({error:'NOT_FOUND'},{status:404});
        const push=await this.ctx.storage.get('push')||{subscriptions:[]};
        if(body.action==='push-subscribe'){
          if(!pushConfigured(this.env))return Response.json({error:'PUSH_NOT_CONFIGURED'},{status:503});
          let subscription;try{subscription=validateSubscription(body.subscription);}catch(e){return Response.json({error:e.message},{status:400});}
          const existing=push.subscriptions.find(e=>e.subscription.endpoint===subscription.endpoint);
          if(!existing&&push.subscriptions.length>=10)return Response.json({error:'PUSH_DEVICE_LIMIT'},{status:400});
          push.subscriptions=push.subscriptions.filter(e=>e.subscription.endpoint!==subscription.endpoint);
          push.subscriptions.push({subscription});
          await this.ctx.storage.put('push',push);await this.ctx.storage.setAlarm(Date.now()+5000);
          return Response.json({success:true});
        }
        if(body.action==='push-unsubscribe'){
          push.subscriptions=push.subscriptions.filter(e=>e.subscription.endpoint!==body.endpoint);
          await this.ctx.storage.put('push',push);if(!push.subscriptions.length&&!(await this.ctx.storage.get('telegram'))?.chatId)await this.ctx.storage.deleteAlarm();
          return Response.json({success:true});
        }
        if(body.action==='push-status'){
          const entry=push.subscriptions.find(e=>e.subscription.endpoint===body.endpoint);
          const subscribed=pushConfigured(this.env)&&Boolean(entry);
          // Opening the app repairs a missing/stale alarm and checks today's window now.
          if(subscribed)await this.ctx.storage.setAlarm(Date.now()+5000);
          return Response.json({success:true,subscribed,nextCheckAt:subscribed?await this.ctx.storage.getAlarm():null,lastReminderDay:entry?.lastDay||null,lastTestAt:entry?.lastTestAt||null,lastAttemptAt:entry?.lastAttemptAt||null,lastStatus:entry?.lastStatus??null});
        }
        if(body.action==='push-test'){
          if(!pushConfigured(this.env))return Response.json({error:'PUSH_NOT_CONFIGURED'},{status:503});
          const entry=push.subscriptions.find(e=>e.subscription.endpoint===body.endpoint);
          if(!entry)return Response.json({error:'PUSH_NOT_CONNECTED'},{status:409});
          const now=Date.now();
          if(now-(entry.testAttemptAt||0)<60000)return Response.json({error:'TEST_RATE_LIMITED'},{status:429});
          entry.testAttemptAt=now;
          await this.ctx.storage.put('push',push);
          let status;try{status=await sendReminder(this.env,entry.subscription,{title:'Комуналка · тест',body:'Тестове сповіщення від Комуналки. Підключення перевірено.',tag:`komunalka-test-${now}`});}catch{status=503;}
          if(status===404||status===410){push.subscriptions=push.subscriptions.filter(e=>e!==entry);await this.ctx.storage.put('push',push);if(!push.subscriptions.length&&!(await this.ctx.storage.get('telegram'))?.chatId)await this.ctx.storage.deleteAlarm();return Response.json({error:'PUSH_NOT_CONNECTED'},{status:409});}
          if(status<200||status>=300)return Response.json({error:'PUSH_TEST_FAILED'},{status:502});
          entry.lastTestAt=now;
          await this.ctx.storage.put('push',push);
          return Response.json({success:true,sentAt:now});
        }
        return Response.json({error:'INVALID_ACTION'},{status:400});
      }
      if(body.action==='backup-snapshot'){
        const push=await this.ctx.storage.get('push')||{subscriptions:[]},telegram=await this.ctx.storage.get('telegram')||null,shares=await this.ctx.storage.get('shares')||[];
        const revokedShares=this.ctx.storage.list?Object.fromEntries(await this.ctx.storage.list({prefix:'share-revoked:'})):{};
        return Response.json({success:true,snapshot:{login:body.login,account:state,push,telegram,shares,revokedShares,alarmAt:await this.ctx.storage.getAlarm()},revision:state.revision});
      }
      if(body.action==='restore-snapshot'){
        const snapshot=body.snapshot;
        if(snapshot?.login!==body.login||snapshot.account?.login!==body.login||!Number.isInteger(snapshot.account.revision)||!(Array.isArray(snapshot.account.value?.addresses)||Array.isArray(snapshot.account.value?.records)))return Response.json({error:'INVALID_SNAPSHOT'},{status:400});
        await this.ctx.storage.put({account:snapshot.account,push:snapshot.push||{subscriptions:[]},telegram:snapshot.telegram||{},shares:snapshot.shares||[],sessions:[],...(snapshot.revokedShares||{})});
        await this.ctx.storage.delete('previous');await this.ctx.storage.delete('legacy-original');
        if(snapshot.push?.subscriptions?.length||snapshot.telegram?.chatId)await this.ctx.storage.setAlarm(Date.now()+60000);else await this.ctx.storage.deleteAlarm();
        await this.env.KV.put(`account-index:${encodeURIComponent(body.login)}`,JSON.stringify({login:body.login}));
        await this.ctx.storage.put('directory-pending',accountSummary(snapshot.account));await this.flushDirectory(true);
        return Response.json({success:true,revision:snapshot.account.revision});
      }
      if(body.action==='read')return Response.json({value:state.deleted?null:state.value,revision:state.revision});
      if(body.action==='write'){
        const receipt=body.mutationId&&state.receipts.find(item=>item.id===body.mutationId);
        if(receipt)return Response.json(receipt.fingerprint===body.fingerprint?{success:true,revision:receipt.revision}:{error:'MUTATION_ID_REUSED'},{status:receipt.fingerprint===body.fingerprint?200:409});
        if(state.deleted||body.expectedRevision!==state.revision)return Response.json({error:'CONFLICT',revision:state.revision},{status:409});
        // Index first: a committed account stays discoverable even if its KV mirror fails.
        await this.env.KV.put(`account-index:${encodeURIComponent(body.login)}`,JSON.stringify({login:body.login}));
        const revision=state.revision+1;
        const next={...state,value:body.value,revision};
        if(body.mutationId)next.receipts=[...state.receipts,{id:body.mutationId,fingerprint:body.fingerprint,revision}].slice(-1000);
        // Keep the immediately preceding version for operational recovery.
        await this.ctx.storage.put({'previous':state,'account':next,'directory-pending':accountSummary(next)});
        await this.flushDirectory();
        // KV is a compatibility mirror. It is never the authority after import.
        try{await this.env.KV.put(body.login,JSON.stringify({...body.value,_revision:revision}));}catch{console.error('Account KV mirror failed');}
        // A reminder edited during today's active window must not wait until tomorrow.
        const push=await this.ctx.storage.get('push'),telegram=await this.ctx.storage.get('telegram');if(push?.subscriptions?.length||telegram?.chatId)await this.ctx.storage.setAlarm(Date.now()+5000);
        return Response.json({success:true,revision});
      }
      if(body.action==='delete'){
        // Remove the old credential mirror before committing the private-state purge.
        // Related aliases can be retried safely by an alarm after the account is gone.
        await this.env.KV.delete(body.login);
        await this.ctx.storage.put('delete-cleanup',[...new Set([...(await this.ctx.storage.get('delete-cleanup')||[]),...(body.cleanupKeys||[])])]);
        const tombstone={login:body.login,value:null,deleted:true,revision:state.revision+1,receipts:[]};
        await this.ctx.storage.put({'account':tombstone,'directory-pending':accountSummary(tombstone)});
        await this.ctx.storage.delete('previous');await this.ctx.storage.delete('legacy-original');
        await this.ctx.storage.deleteAlarm();await this.ctx.storage.put('push',{subscriptions:[]});await this.ctx.storage.delete('telegram');await this.ctx.storage.put('sessions',[]);await this.ctx.storage.put('shares',[]);
        const result=await this.cleanupDeleted();await this.flushDirectory();return result;
      }
      return Response.json({error:'INVALID_ACTION'},{status:400});
    });
  }
}
