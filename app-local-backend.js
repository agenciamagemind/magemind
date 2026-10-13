/* The original APP uses this bridge only when running in the local preview.
   Sessions remain HttpOnly; no provider credential or service role is exposed. */
(() => {
 if(window.MAGEMIND_TRACKING_ENV?.mode!=='local-simulator')return;
 const cfg=window.MAGEMIND_TRACKING_ENV;
 if(cfg.environment!=='test'||cfg.externalDelivery!==false||!['127.0.0.1','localhost'].includes(location.hostname))throw new Error('Prévia local inválida');
 async function call(route,body){const r=await fetch(cfg.apiBase+route,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Magemind-Test':'1'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Não foi possível concluir');return data;}
 const listeners=new Set();let current=null;
 const session=me=>me?.user_id?{user:{id:me.user_id,email:me.email},access_token:'local-cookie-session',refresh_token:'local-cookie-session',expires_at:Math.floor(Date.now()/1000)+3600}:null;
 const refresh=async()=>{current=session(await call('/auth/me'));return current;};
 const result=async fn=>{try{return {data:await fn(),error:null};}catch(e){return {data:null,error:{message:e.message}};}};
 class Query {
  constructor(table){this.b={table,filters:[],order:[]};this.singleRow=false;}
  select(){return this;}
  eq(column,value){this.b.filters.push({column,value,op:'eq'});return this;}
  neq(column,value){this.b.filters.push({column,value,op:'neq'});return this;}
  is(column,value){this.b.filters.push({column,value,op:'is'});return this;}
  in(column,value){this.b.filters.push({column,value,op:'in'});return this;}
  gte(column,value){this.b.filters.push({column,value,op:'gte'});return this;}
  lte(column,value){this.b.filters.push({column,value,op:'lte'});return this;}
  or(value){this.b.or=value;return this;}
  order(column,options={}){this.b.order.push({column,...options});return this;}
  limit(n){this.b.limit=n;return this;}
  maybeSingle(){this.singleRow=true;return this;}
  single(){this.singleRow=true;return this;}
  update(values){Object.assign(this.b,{mode:'update',values});return this;}
  insert(values){Object.assign(this.b,{mode:'insert',values});return this;}
  upsert(values){Object.assign(this.b,{mode:'upsert',values});return this;}
  delete(){this.b.mode='delete';return this;}
  then(resolve,reject){return result(async()=>{const rows=await call('/native/query',this.b);return this.singleRow?rows[0]||null:rows;}).then(resolve,reject);}
 }
 const auth={
  getSession:()=>result(async()=>({session:await refresh()})),
  getUser:()=>result(async()=>({user:(await refresh())?.user||null})),
  refreshSession:()=>result(async()=>({session:await refresh()})),
  setSession:()=>result(async()=>{await refresh();return {session:current,user:current?.user};}),
  signOut:()=>result(async()=>{await call('/auth/logout',{});current=null;listeners.forEach(fn=>fn('SIGNED_OUT',null));return {}; }),
  onAuthStateChange(fn){listeners.add(fn);setTimeout(()=>refresh().then(s=>fn('INITIAL_SESSION',s)).catch(()=>{}),0);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
  signInWithPassword:credentials=>result(async()=>{current=session(await call('/auth/login',credentials));return {user:current.user,session:current};}),
  updateUser:data=>result(()=>call('/native/password',data)),
  resetPasswordForEmail:()=>Promise.resolve({error:{message:'A recuperação por e-mail estará disponível com o serviço de autenticação conectado.'}})
 };
 const channel=()=>({on(){return this;},subscribe(){return this;},unsubscribe(){return Promise.resolve();}});
 const client={auth,from:table=>new Query(table),rpc:(name,args)=>result(async()=>{const rows=await call('/native/rpc',{name,args});if(['set_my_phone','mark_notifications_read'].includes(name))return null;return rows;}),channel,removeChannel:async()=>{},removeAllChannels:async()=>{},storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:''}}),upload:async()=>({error:{message:'Upload disponível quando o armazenamento estiver conectado.'}})})}};
 window.supabase={createClient:()=>client};
 window.MagemindLocalAuth=async(action,data)=>{const me=await call('/auth/'+(action==='signup'?'signup':'login'),data);current=session(me);return {user:current.user,session:current};};
})();
