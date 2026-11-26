// Sync + sign-in layer. Gives the app the same small "db" interface it used inside Claude.
const Store=(()=>{
  const CFG=window.RP_CONFIG||{};
  let cred=null,cache={},pins={},admin=false,q=Promise.resolve(),timer=null,lastJSON='',firstDone=false,onChange=()=>{},onDenied=()=>{},onNew=()=>{};
  const KEY='rp_cred';
  async function rpc(fn,args){
    const h={apikey:CFG.key,'Content-Type':'application/json'};
    if(/^eyJ/.test(CFG.key))h.Authorization='Bearer '+CFG.key;
    const r=await fetch(CFG.url+'/rest/v1/rpc/'+fn,{method:'POST',headers:h,body:JSON.stringify(args)});
    if(!r.ok)throw new Error('http '+r.status);
    return r.json();
  }
  const A=()=>({p_staff:cred.staff,p_pin:cred.pin});
  function apply(res){
    const next={};(res.docs||[]).forEach(d=>{next[d.path]=d.data});
    const j=JSON.stringify([next,res.pins]);
    const old=cache;cache=next;pins=res.pins||{};admin=!!res.admin;
    if(firstDone)detectNew(old,next);
    if(j!==lastJSON||!firstDone){lastJSON=j;firstDone=true;onChange()}
  }
  function detectNew(old,next){
    Object.keys(next).forEach(p=>{if(p.startsWith('ntf/')&&!(p in old))onNew(next[p])});
  }
  function pull(){
    q=q.then(async()=>{
      if(!cred)return;
      try{
        const r=await rpc('app_pull',A());
        if(!r.ok){if(r.err==='auth')onDenied();return}
        apply(r);
      }catch(e){}
    });
    return q;
  }
  function startPolling(){
    stop();timer=setInterval(()=>{if(!document.hidden)pull()},20000);
    document.addEventListener('visibilitychange',vis);
  }
  const vis=()=>{if(!document.hidden)pull()};
  function stop(){clearInterval(timer);document.removeEventListener('visibilitychange',vis)}
  function put(path,data,del){
    return new Promise((res,rej)=>{
      q=q.then(async()=>{
        if(del)delete cache[path];else cache[path]=JSON.parse(JSON.stringify(data));
        onChange();
        try{
          const r=await rpc('app_put',Object.assign(A(),{p_path:path,p_data:del?{}:data,p_del:!!del}));
          if(!r.ok){const e=new Error(r.err);e.code=r.err==='denied'?'invalid_argument':r.err;
            const f=await rpc('app_pull',A());if(f.ok)apply(f);rej(e);return}
          res();
        }catch(e){try{const f=await rpc('app_pull',A());if(f.ok)apply(f)}catch(x){}rej(e)}
      });
    });
  }
  const db={
    doc:p=>({set:d=>put(p,d,false),delete:()=>put(p,null,true)})
  };
  return {
    db,
    names:()=>rpc('app_names',{}),
    resetPin:(staff,pin)=>rpc('app_reset_pin',{p_staff:staff,p_new:pin}),
    async login(staff,pin){
      const r=await rpc('app_pull',{p_staff:staff,p_pin:pin});
      if(!r.ok)return r;
      cred={staff,pin};firstDone=false;lastJSON='';
      try{localStorage.setItem(KEY,JSON.stringify(cred))}catch(e){}
      apply(r);startPolling();return r;
    },
    saved(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){return null}},
    logout(){cred=null;cache={};pins={};stop();try{localStorage.removeItem(KEY)}catch(e){}},
    who:()=>cred&&cred.staff,
    isAdmin:()=>admin,
    pins:()=>pins,
    pull,
    data:()=>cache,
    setOnChange:f=>{onChange=f},setOnDenied:f=>{onDenied=f},setOnNew:f=>{onNew=f},
    async setPin(target,newPin,adminFlag){
      const r=await rpc('app_set_pin',Object.assign(A(),{p_target:target,p_new:newPin,p_admin:adminFlag===undefined?null:adminFlag}));
      if(r.ok&&target===cred.staff&&newPin){cred.pin=newPin;try{localStorage.setItem(KEY,JSON.stringify(cred))}catch(e){}}
      if(r.ok)await pull();return r;
    },
    async mail(ids,subject,html){
      try{
        if(!cred||CFG.mail===false)return {ok:false,err:'off'};
        const h={apikey:CFG.key,'Content-Type':'application/json'};if(/^eyJ/.test(CFG.key))h.Authorization='Bearer '+CFG.key;
        const r=await fetch(CFG.url+'/functions/v1/send-email',{method:'POST',headers:h,body:JSON.stringify({p_staff:cred.staff,p_pin:cred.pin,ids,subject,html})});
        return await r.json();
      }catch(e){return {ok:false,err:'network'}}
    },
    async issuePins(){const r=await rpc('app_issue_pins',A());if(r.ok)await pull();return r}
  };
})();
