import {service,userClient,checkDatabase,guard,json,body,credential,encrypt,decrypt,env,sha256,requireMember,allowReads} from '../_shared/tracking-runtime.ts';
import {oauthStart,exchangeOAuth,listAccounts,setMetaStatus} from '../_shared/tracking/adapters.mjs';
import {connector,validateWebhookSetup,webhookEndpoint} from '../_shared/tracking/connectors.mjs';
import {metaConfig,sessionId} from '../_shared/tracking-oauth.ts';
const rpc=async(db:any,name:string,args:any={})=>{const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data;};
const supported=(a:any)=>/^act_\d+$/.test(a.account_id)&&['BRL','USD','EUR','JPY','KWD'].includes(a.currency)&&!!a.timezone_name;
Deno.serve(async(req)=>{
 try{
  guard();if(req.method==='OPTIONS')return json(req,{},204);
  const url=new URL(req.url),db=service();await checkDatabase(db);
  if(url.searchParams.has('callback')){
   const destination=new URL('/',env('TRACKING_FRONTEND_ORIGIN'));
   try{
    allowReads();if(url.searchParams.get('callback')!=='meta')throw new Error('Invalid provider');
    const hash=await sha256(url.searchParams.get('state')||''),state=await rpc(db,'tracking_oauth_consume',{h:hash});
    if(state.provider!=='meta'||url.searchParams.has('error')||!url.searchParams.get('code'))throw new Error('OAuth cancelled');
    const config=await metaConfig(db),tokens=await exchangeOAuth('meta',config,url.searchParams.get('code'));
    const grant=await rpc(db,'tracking_oauth_finish',{h:hash,c:await encrypt({...tokens,version:config.version,allowManagement:config.allowManagement})});
    destination.search=new URLSearchParams({tracking_oauth:grant,tracking_workspace:state.workspace_id});
   }catch{destination.searchParams.set('tracking_oauth_error','authorization');}
   return new Response(null,{status:303,headers:{Location:destination.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  if(req.method!=='POST')return json(req,{error:'POST required'},405);
  const input=await body(req),{client,user}=await userClient(req),sid=sessionId(req);
  if(input.action==='platform_status')return json(req,await rpc(client,'tracking_platform_status'));
  if(input.action==='platform_save'){
   const safe=await rpc(client,'tracking_platform_status');if(!safe.can_configure)throw new Error('Forbidden');
   const secret=String(input.client_secret||'').trim();if(secret&&!/^[a-f0-9]{32}$/i.test(secret))throw new Error('Informe o segredo válido do aplicativo da Meta');
   await rpc(client,'tracking_platform_save',{p:{app_id:String(input.app_id||''),config_id:String(input.config_id||''),api_version:'v25.0',allow_management:input.allow_management===true},c:secret?await encrypt({clientSecret:secret}):null});return json(req,{saved:true});
  }
  const w=String(input.workspace||'');await requireMember(client,w,user.id,true);
  if(input.action==='oauth_start'){
   allowReads();if(input.provider!=='meta')throw new Error('Plataforma indisponível');
   const config=await metaConfig(db),state=crypto.randomUUID()+crypto.randomUUID();
   await rpc(db,'tracking_oauth_begin',{h:await sha256(state),w,u:user.id,p:'meta',s:sid});return json(req,{url:await oauthStart('meta',{...config,state})});
  }
  if(['oauth_accounts','oauth_select'].includes(input.action)){
   allowReads();const grant=await rpc(db,'tracking_oauth_grant',{g:input.grant,u:user.id,s:sid});if(grant.workspace_id!==w)throw new Error('Forbidden');
   const secrets=await decrypt(grant.cipher),accounts=(await listAccounts('meta',secrets)).filter(supported).map((a:any)=>({account_id:a.account_id,name:a.name,currency:a.currency,timezone:a.timezone_name}));
   if(input.action==='oauth_accounts')return json(req,{accounts});
   const ids=input.accounts;if(!Array.isArray(ids)||ids.length<1||ids.length>20||new Set(ids).size!==ids.length||ids.some((id:string)=>!accounts.some((a:any)=>a.account_id===id)))throw new Error('Selecione as contas autorizadas');
   const count=await rpc(db,'tracking_install_oauth_accounts',{g:input.grant,u:user.id,s:sid,accounts:accounts.filter((a:any)=>ids.includes(a.account_id))});return json(req,{connected:count});
  }
  if(input.action==='create_api'){
   const name=String(input.name||'').trim();if(!name||name.length>120)throw new Error('Informe o nome da conexão');
   const token=crypto.randomUUID()+crypto.randomUUID(),id=await rpc(db,'tracking_install_webhook',{w,u:user.id,s:sid,p:'custom',n:name,c:await encrypt({})});
   await rpc(db,'tracking_internal_save_credential',{i:id,p_cipher:null,p_hash:await sha256(token)});
   await db.from('tracking_integrations').update({connection_kind:'api'}).eq('id',id);
   return json(req,{integration:id,token,endpoint:env('TRACKING_CALLBACK_ORIGIN')+'/functions/v1/tracking-webhook?provider=custom'});
  }
  if(input.action==='create_webhook'){
   const setup=validateWebhookSetup(input.provider,input),recipientSource=String(input.recipientSource||'PRODUCER');
   if(!['PRODUCER','AFFILIATE','COPRODUCER'].includes(recipientSource))throw new Error('Selecione seu papel na venda');
   if(input.provider==='cartpanda'&&(input.manual_fees!==true||recipientSource!=='PRODUCER'))throw new Error('Confirme a configuração de taxas e custos da loja');
   const secrets={...setup.secrets,ingressToken:crypto.randomUUID()+crypto.randomUUID(),webhook_only:true,recipientSource,manual_fees:input.provider==='cartpanda',timezone:'America/Sao_Paulo'};
   const id=await rpc(db,'tracking_install_webhook',{w,u:user.id,s:sid,p:input.provider,n:setup.name,c:await encrypt(secrets)});return json(req,{integration:id,webhook:webhookEndpoint(env('TRACKING_CALLBACK_ORIGIN'),input.provider,id,secrets.ingressToken)});
  }
  const {data:integration,error}=await client.from('tracking_integrations').select('*').eq('workspace_id',w).eq('id',input.integration).single();if(error||!integration)throw new Error('Integration inaccessible');
  if(input.action==='webhook_details'){
   connector(integration.provider);const {secrets}=await credential(db,integration.id);if(!secrets.ingressToken)throw new Error('Reconecte a plataforma para gerar o endereço privado');return json(req,{provider:integration.provider,webhook:webhookEndpoint(env('TRACKING_CALLBACK_ORIGIN'),integration.provider,integration.id,secrets.ingressToken)});
  }
  if(input.action==='ad_status'){
   if(integration.provider!=='meta'||integration.mode==='simulated')throw new Error('Conta Meta real necessária');
   const entity=await client.from('tracking_ad_entities').select('*').eq('workspace_id',w).eq('provider','meta').eq('account_id',integration.account_id).eq('entity_id',input.entity_id).single();if(entity.error||entity.data.revision!==input.revision)throw new Error('Atualize a campanha antes de alterar');
   const {secrets}=await credential(db,integration.id);if(secrets.allowManagement===false)throw new Error('A Meta foi conectada com permissão somente de leitura');await setMetaStatus(secrets,input.entity_id,input.status);
   const saved=await db.from('tracking_ad_entities').update({status:input.status,revision:input.revision+1,status_updated_at:new Date().toISOString()}).eq('workspace_id',w).eq('provider','meta').eq('account_id',integration.account_id).eq('entity_id',input.entity_id).eq('revision',input.revision);if(saved.error)throw saved.error;
   await db.from('tracking_audit').insert({workspace_id:w,actor_id:user.id,action:'ad.status',entity_id:input.entity_id,details:{provider:'meta',status:input.status}});return json(req,{status:input.status});
  }
  if(input.action==='api_token'){
   if(integration.provider!=='custom')throw new Error('Only custom order API uses bearer credential');const token=crypto.randomUUID()+crypto.randomUUID();await rpc(db,'tracking_internal_save_credential',{i:integration.id,p_cipher:null,p_hash:await sha256(token)});return json(req,{token,notice:'Exibido uma vez; mantenha em local privado.'});
  }
  if(input.action==='queue_sync'){allowReads();await db.from('tracking_integrations').update({error_code:'sync_requested'}).eq('id',integration.id);return json(req,{status:'queued'});}
  throw new Error('Ação indisponível');
 }catch(error){console.error('tracking-api rejected:',error?.code||'validation');const msg=String(error?.message||'');const safe=/^(Informe|Conta não|Selecione|Confirme|Reconecte|O login da Meta|A Meta|Atualize|Forbidden|Unauthorized|Plataforma)/.test(msg)?msg:msg==='token_revoked'?'Credencial inválida, expirada ou sem permissão.':'Não foi possível concluir. Confira a conexão e as permissões da plataforma.';return json(req,{error:safe},msg==='Unauthorized'?401:400);}
});
