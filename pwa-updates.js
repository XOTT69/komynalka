(function(global){
  function version(worker,timeout=1800){
    if(!worker)return Promise.resolve(null);
    return new Promise(resolve=>{const channel=new MessageChannel();let timer;const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};channel.port1.onmessage=e=>finish(typeof e.data?.version==='string'?e.data.version:null);timer=setTimeout(()=>finish(null),timeout);try{worker.postMessage({type:'GET_VERSION'},[channel.port2]);}catch{finish(null);}});
  }
  function create({readVersion=version,controller,onReady,onClear}){
    let generation=0,candidate=null;
    return {
      async check(registration){
        const seq=++generation,waiting=registration.waiting,active=controller();
        if(!waiting||!active||waiting===active||waiting.state!=='installed'){candidate=null;onClear();return false;}
        const [next,current]=await Promise.all([readVersion(waiting),readVersion(active)]);
        if(seq!==generation)return false;
        // Older workers may not implement GET_VERSION; their installed successor is a real update.
        if(!next||(current&&next===current)||registration.waiting!==waiting||waiting.state!=='installed'){candidate=null;onClear();return false;}
        candidate=waiting;onReady(waiting);return true;
      },
      current:()=>candidate,
      clear(){generation++;candidate=null;onClear();}
    };
  }
  global.KomunalkaUpdates=Object.freeze({create,version});
})(globalThis);
