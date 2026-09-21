import {pushConfigured,validateSubscription,deliverReminders} from './push-delivery.js';
/* A serialized authority for each account; the original KV snapshot is retained.
 * All account writers must go through this object after the coordinated cutover.
 */
export class AccountStore {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async alarm(){return this.ctx.blockConcurrencyWhile(()=>deliverReminders(this.ctx,this.env));}
  async fetch(request){
    const body=await request.json();
    return this.ctx.blockConcurrencyWhile(async()=>{
      let state=await this.ctx.storage.get('account');
      if(!state){
        const raw=await this.env.KV.get(body.login);
        let value=null;
        if(raw){try{value=JSON.parse(raw);}catch{throw new Error('UNSUPPORTED_LEGACY_ACCOUNT');}if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_LEGACY_ACCOUNT');}
        state={login:body.login,value,revision:value?1:0,receipts:[],deleted:false};
        await this.ctx.storage.put({'account':state,'legacy-original':{raw,importedAt:Date.now()}});
      }
      if(state.login!==body.login)return Response.json({error:'ACCOUNT_MISMATCH'},{status:403});
      if(body.action.startsWith('telegram-')){
        if(state.deleted||!state.value)return Response.json({error:'NOT_FOUND'},{status:404});
        const telegram=await this.ctx.storage.get('telegram')||{};
        if(body.action==='telegram-status'){
          if(telegram.chatId)await this.ctx.storage.setAlarm(Date.now()+5000);
          return Response.json({success:true,connected:Boolean(telegram.chatId),chatId:telegram.chatId||null,chatLabel:telegram.chatId?telegram.chatLabel||'Приватний чат':null});
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
          const subscribed=pushConfigured(this.env)&&push.subscriptions.some(e=>e.subscription.endpoint===body.endpoint);
          // Opening the app repairs a missing/stale alarm and checks today's window now.
          if(subscribed)await this.ctx.storage.setAlarm(Date.now()+5000);
          return Response.json({success:true,subscribed,nextCheckAt:subscribed?await this.ctx.storage.getAlarm():null});
        }
        return Response.json({error:'INVALID_ACTION'},{status:400});
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
        await this.ctx.storage.put({'previous':state,'account':next});
        // KV is a compatibility mirror. It is never the authority after import.
        try{await this.env.KV.put(body.login,JSON.stringify({...body.value,_revision:revision}));}catch{console.error('Account KV mirror failed');}
        // A reminder edited during today's active window must not wait until tomorrow.
        const push=await this.ctx.storage.get('push'),telegram=await this.ctx.storage.get('telegram');if(push?.subscriptions?.length||telegram?.chatId)await this.ctx.storage.setAlarm(Date.now()+5000);
        return Response.json({success:true,revision});
      }
      if(body.action==='delete'){
        await this.ctx.storage.put({'previous':state,'account':{...state,deleted:true,revision:state.revision+1}});
        await this.ctx.storage.deleteAlarm();await this.ctx.storage.put('push',{subscriptions:[]});await this.ctx.storage.delete('telegram');
        await this.env.KV.delete(body.login);
        return Response.json({success:true});
      }
      return Response.json({error:'INVALID_ACTION'},{status:400});
    });
  }
}
