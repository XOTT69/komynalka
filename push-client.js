(function(global){
  function create({request,registration,permission,subscribeOptions,report}){
    let config=null;
    async function inspect(){
      try{
        config=await request('config');
        if(!config.enabled){report('unconfigured');return false;}
        const reg=await registration(),sub=await reg.pushManager.getSubscription();
        if(permission.current()==='denied'){report('denied');return false;}
        if(!sub||permission.current()!=='granted'){report('available');return false;}
        const result=await request('status',{endpoint:sub.endpoint});
        report(result.subscribed?'enabled':'available');return Boolean(result.subscribed);
      }catch{report('error');return false;}
    }
    async function enable(){
      if(!config?.enabled){report('unconfigured');return false;}
      // This call happens directly in the button gesture, before any network await.
      let grant;try{grant=await permission.ask();}catch{report('error');return false;}if(grant!=='granted'){report(grant==='denied'?'denied':'available');return false;}
      report('connecting');let sub,created=false;
      try{const reg=await registration();sub=await reg.pushManager.getSubscription();if(!sub){sub=await reg.pushManager.subscribe(subscribeOptions(config.publicKey));created=true;}await request('subscribe',{subscription:sub.toJSON()});report('enabled');return true;}
      catch{if(created&&sub)try{await sub.unsubscribe();}catch{}report('error');return false;}
    }
    async function disable(){
      try{const reg=await registration(),sub=await reg.pushManager.getSubscription();if(sub){try{await request('unsubscribe',{endpoint:sub.endpoint});}catch{}if(!await sub.unsubscribe())throw new Error('UNSUBSCRIBE_FAILED');}report('available');return true;}catch{report('error');return false;}
    }
    return{inspect,enable,disable};
  }
  global.KomunalkaPush=Object.freeze({create});
})(globalThis);
