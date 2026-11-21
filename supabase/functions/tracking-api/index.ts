import {service,userClient,checkDatabase,guard,json,body,credential,encrypt,decrypt,env,sha256,requireMember,allowReads} from '../_shared/tracking-runtime.ts';
import {oauthStart,exchangeOAuth,listAccounts,setMetaStatus,metaFailure,metaProfile,metaAccountManagement,verifyMetaRead} from '../_shared/tracking/adapters.mjs';
import {connector,validateWebhookSetup,webhookEndpoint} from '../_shared/tracking/connectors.mjs';
import {metaConfig,sessionId} from '../_shared/tracking-oauth.ts';
const rpc=async(db:any,name:string,args:any={})=>{const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data;};
const supported=(a:any)=>/^act_\d+$/.test(a.account_id)&&['BRL','USD','EUR','JPY','KWD'].includes(a.currency)&&!!a.timezone_name;
const authorizationCodes=new Set(['token_revoked','meta_confirmation_required','meta_read_denied','provider_http_400_200','provider_http_400_10']);
const metaMessages:Record<string,string>={
 token_revoked:'A autorização da Meta expirou ou foi revogada. Renove o acesso em Conexões.',
 meta_confirmation_required:'A Meta solicitou uma confirmação. Abra sua conta Meta, conclua a verificação e teste a conexão.',
 meta_read_denied:'A Meta não liberou a leitura da conta de anúncios. Peça acesso ao administrador da conta e renove a conexão.',
 meta_account_not_authorized:'A conta que você tentou renovar ficou de fora da autorização. Tente novamente com o perfil que tem acesso à conta e selecione-a quando a Meta pedir.',
 meta_grant_expired:'Esta autorização não está disponível para esta sessão. Inicie a conexão novamente e conclua o acesso na mesma aba do painel.',
 meta_connection_changed:'A conta foi alterada enquanto você autorizava o acesso. Confira o estado atual em Conexões.',
 meta_manage_denied:'A conexão está em modo somente leitura. Peça acesso para gerenciar campanhas na Meta e renove a conexão.',
 meta_platform_readonly:'O aplicativo da Magemind está habilitado somente para leitura. Fale com o suporte para liberar o gerenciamento.',
 rate_limit:'A Meta limitou as consultas por alguns instantes. Tente novamente em breve.',
 sync_failed:'A Meta está indisponível para esta conexão. Se persistir, fale com o suporte.',
 ad_status_conflict:'A veiculação mudou ou já está sendo atualizada. Aguarde e atualize a lista.',
 meta_update_unconfirmed:'A Meta ainda não confirmou a alteração. Confira a veiculação após sincronizar a conta.'
};
class MetaError extends Error{
 code: string;
 constructor(code:string){super(metaMessages[code]);this.code=code;}
}
const metaSecrets=(secrets:any)=>({...secrets,version:secrets.version||env('TRACKING_META_VERSION')||'v25.0'});
const isRateLimited=(i:any)=>i.error_code==='rate_limit'&&i.retry_after_at&&new Date(i.retry_after_at)>new Date();
async function installMetaAccounts(db:any,grant:string,userId:string,sid:string,accounts:any[]){
 try{return await rpc(db,'tracking_install_oauth_accounts',{g:grant,u:userId,s:sid,accounts});}
 catch(error){
  if(error?.code==='P0002')throw new MetaError('meta_grant_expired');
  if(error?.code==='40001')throw new MetaError('meta_connection_changed');
  throw error;
 }
}
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
   }catch(error){const code=metaFailure(error);destination.searchParams.set('tracking_oauth_error',code==='sync_failed'?'authorization':code);}
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
  if(input.action==='queue_ads_sync'){
   allowReads();const {data:rows,error}=await client.from('tracking_integrations').select('id,provider,error_code,retry_after_at').eq('workspace_id',w).eq('connected',true).in('provider',['meta','google']);if(error)throw error;
   let requested=0;for(const i of rows||[]){
    if(authorizationCodes.has(i.error_code)||isRateLimited(i))continue;
    const query=db.from('tracking_integrations').update({error_code:'sync_requested',retry_after_at:null}).eq('id',i.id).eq('workspace_id',w).eq('connected',true);
    const saved=await (i.error_code?query.eq('error_code',i.error_code):query.is('error_code',null)).select('id');if(saved.error)throw saved.error;
    requested+=saved.data.length;
   }
   return json(req,{requested,status:'queued'});
  }
  if(input.action==='oauth_start'){
   allowReads();if(input.provider!=='meta')throw new Error('Plataforma indisponível');
   const config=await metaConfig(db),state=crypto.randomUUID()+crypto.randomUUID();
   const args={h:await sha256(state),w,u:user.id,s:sid};
   if(input.integration){
    try{await rpc(db,'tracking_begin_meta_renewal',{...args,i:input.integration});}
    catch(error){if(error?.code==='P0002')throw new MetaError('meta_connection_changed');throw error;}
   }else await rpc(db,'tracking_oauth_begin',{...args,p:'meta'});
   return json(req,{url:await oauthStart('meta',{...config,state,reconnect:!!input.integration||input.reconnect===true})});
  }
  if(['oauth_accounts','oauth_select'].includes(input.action)){
   allowReads();
   let grant;
   try{grant=await rpc(db,'tracking_oauth_grant',{g:input.grant,u:user.id,s:sid});}
   catch(error){if(error?.code==='P0002')throw new MetaError('meta_grant_expired');throw error;}
   if(grant.workspace_id!==w)throw new Error('Forbidden');
   const renewalId=grant.renewal_integration_id;
   if(renewalId&&input.action!=='oauth_accounts')throw new MetaError('meta_connection_changed');
   const secrets=metaSecrets(await decrypt(grant.cipher));
   let accounts,profile;
   try{
    profile=await metaProfile(secrets);
    accounts=(await listAccounts('meta',secrets)).filter(supported).map((a:any)=>({
     account_id:a.account_id,name:a.name,currency:a.currency,timezone:a.timezone_name,
     profile_id:profile.id,profile_name:profile.name,management_access:metaAccountManagement(profile,a)
    }));
   }catch(error){throw new MetaError(metaFailure(error));}
   if(renewalId){
    const {data:target,error}=await client.from('tracking_integrations').select('account_id')
      .eq('workspace_id',w).eq('provider','meta').eq('id',renewalId).maybeSingle();
    if(error)throw error;
    if(!target)throw new MetaError('meta_connection_changed');
    const selected=accounts.find((a:any)=>a.account_id===target.account_id);
    if(!selected)throw new MetaError('meta_account_not_authorized');
    try{await verifyMetaRead(secrets,selected.account_id);}
    catch(error){throw new MetaError(metaFailure(error));}
    await installMetaAccounts(db,input.grant,user.id,sid,[selected]);
    return json(req,{renewed:{name:selected.name,management_access:selected.management_access}});
   }
   if(input.action==='oauth_accounts'){
    const linked=await client.from('tracking_integrations').select('account_id,provider_profile_id,error_code')
     .eq('workspace_id',w).eq('provider','meta').eq('connected',true);
    if(linked.error)throw linked.error;
    const current=new Map((linked.data||[]).map((a:any)=>[a.account_id,a]));
    return json(req,{profile:profile.name,accounts:accounts.map((a:any)=>{
     const previous:any=current.get(a.account_id);
     return {...a,connected:Boolean(previous),needs_access:Boolean(previous&&authorizationCodes.has(previous.error_code))};
    })});
   }
   const ids=input.accounts;if(!Array.isArray(ids)||ids.length<1||ids.length>20||new Set(ids).size!==ids.length||ids.some((id:string)=>!accounts.some((a:any)=>a.account_id===id)))throw new Error('Selecione as contas autorizadas');
   const count=await installMetaAccounts(db,input.grant,user.id,sid,accounts.filter((a:any)=>ids.includes(a.account_id)));return json(req,{connected:count});
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
   if(connector(input.provider).manualFees&&(input.manual_fees!==true||recipientSource!=='PRODUCER'))throw new Error('Confirme a configuração de taxas e custos da loja');
   const secrets={...setup.secrets,ingressToken:crypto.randomUUID()+crypto.randomUUID(),webhook_only:true,recipientSource,manual_fees:connector(input.provider).manualFees===true,timezone:input.provider==='kiwify'?'UTC':'America/Sao_Paulo'};
   const id=await rpc(db,'tracking_install_webhook',{w,u:user.id,s:sid,p:input.provider,n:setup.name,c:await encrypt(secrets)});return json(req,{integration:id,webhook:webhookEndpoint(env('TRACKING_CALLBACK_ORIGIN'),input.provider,id,secrets.ingressToken)});
  }
  const {data:integration,error}=await client.from('tracking_integrations').select('*').eq('workspace_id',w).eq('id',input.integration).single();if(error||!integration)throw new Error('Integration inaccessible');
  if(['meta_test','meta_profile_add'].includes(input.action)){
   allowReads();
   if(integration.provider!=='meta'||!integration.connected||integration.mode==='simulated')throw new Error('Conta Meta real necessária');
   const record=(profile_id:any,profile_name:any,can_manage:any,failure:any)=>rpc(db,'tracking_record_meta_check',{
    i:integration.id,g:integration.connection_generation,profile_id,profile_name,can_manage,failure
   });
   let secrets,profile,accounts;
   try{
    secrets=metaSecrets((await credential(db,integration.id)).secrets);
    if(secrets.token_expires_at&&secrets.token_expires_at<=Date.now())throw new Error('token_revoked');
    profile=await metaProfile(secrets);
    accounts=await listAccounts('meta',secrets);
    const account=accounts.find((a:any)=>a.account_id===integration.account_id);
    if(!account){const error=new Error('meta_read_denied');throw Object.assign(error,{providerCode:200});}
    await verifyMetaRead(secrets,integration.account_id);
    if(!await record(profile.id,profile.name,metaAccountManagement(profile,account),null))throw new MetaError('ad_status_conflict');
    if(input.action==='meta_test')return json(req,{ok:true,management_access:metaAccountManagement(profile,account)});
   }catch(error){
    if(error instanceof MetaError)throw error;
    const code=metaFailure(error);
    await record(null,null,null,authorizationCodes.has(code)?code:null);
    throw new MetaError(code);
   }
   const h=await sha256(crypto.randomUUID()+crypto.randomUUID());
   await rpc(db,'tracking_oauth_begin',{h,w,u:user.id,p:'meta',s:sid});
   await rpc(db,'tracking_oauth_consume',{h});
   const grant=await rpc(db,'tracking_oauth_finish',{h,c:await encrypt(secrets)});
   return json(req,{grant});
  }
  if(input.action==='webhook_details'){
   connector(integration.provider);const {secrets}=await credential(db,integration.id);if(!secrets.ingressToken)throw new Error('Reconecte a plataforma para gerar o endereço privado');return json(req,{provider:integration.provider,webhook:webhookEndpoint(env('TRACKING_CALLBACK_ORIGIN'),integration.provider,integration.id,secrets.ingressToken)});
  }
  if(input.action==='ad_status'){
   allowReads();
   if(integration.provider!=='meta'||integration.mode==='simulated'||!integration.connected)throw new Error('Conta Meta real necessária');
   if(!['ACTIVE','PAUSED'].includes(input.status)||!/^\d{1,40}$/.test(input.entity_id)||!Number.isInteger(input.revision))throw new Error('Informe um estado de anúncio válido.');
   const config=await metaConfig(db);
   if(!config.allowManagement)throw new MetaError('meta_platform_readonly');
   if(authorizationCodes.has(integration.error_code))throw new MetaError(/^provider_http/.test(integration.error_code)?'meta_read_denied':integration.error_code);
   if(isRateLimited(integration))throw new MetaError('rate_limit');
   if(integration.management_access===false)throw new MetaError('meta_manage_denied');
   const i=integration.id,g=integration.connection_generation,e=input.entity_id;
   const claim=await rpc(db,'tracking_claim_ad_status',{i,g,e,v:input.revision});
   if(!claim)throw new MetaError('ad_status_conflict');
   const finish=(target:string|null,resync:boolean)=>rpc(db,'tracking_finish_ad_status',{i,g,e,claim,target,actor:user.id,resync});
   try{
    const {row,secrets}=await credential(db,i);
    if(row.integration.connection_generation!==g)throw new MetaError('ad_status_conflict');
    if(secrets.token_expires_at&&secrets.token_expires_at<=Date.now())throw new Error('token_revoked');
    if(secrets.allowManagement===false)throw new MetaError('meta_manage_denied');
    await setMetaStatus(metaSecrets(secrets),e,input.status);
   }catch(error){
    const code=error instanceof MetaError?error.code:metaFailure(error,'write');
    await finish(null,code==='meta_update_unconfirmed');
    if(authorizationCodes.has(code)||code==='meta_manage_denied'){
     await rpc(db,'tracking_record_meta_check',{i,g,profile_id:null,profile_name:null,
      can_manage:code==='meta_manage_denied'?false:null,failure:authorizationCodes.has(code)?code:null});
    }
    throw new MetaError(code);
   }
   if(!await finish(input.status,true))throw new MetaError('meta_update_unconfirmed');
   return json(req,{status:input.status});
  }
  if(input.action==='api_token'){
   if(integration.provider!=='custom')throw new Error('Only custom order API uses bearer credential');const token=crypto.randomUUID()+crypto.randomUUID();await rpc(db,'tracking_internal_save_credential',{i:integration.id,p_cipher:null,p_hash:await sha256(token)});return json(req,{token,notice:'Exibido uma vez; mantenha em local privado.'});
  }
  if(input.action==='queue_sync'){
   allowReads();
   if(!integration.connected)throw new Error('Reconecte a plataforma para sincronizar.');
   if(integration.provider==='meta'&&authorizationCodes.has(integration.error_code))throw new MetaError(/^provider_http/.test(integration.error_code)?'meta_read_denied':integration.error_code);
   if(isRateLimited(integration))return json(req,{status:'rate_limit'});
   const saved=await db.from('tracking_integrations').update({error_code:'sync_requested',retry_after_at:null})
    .eq('id',integration.id).eq('connected',true).eq('connection_generation',integration.connection_generation);
   if(saved.error)throw saved.error;
   return json(req,{status:'queued'});
  }
  throw new Error('Ação indisponível');
 }catch(error){
  if(error instanceof MetaError)return json(req,{error:error.message,code:error.code},error.code==='rate_limit'?429:error.code==='ad_status_conflict'?409:422);
  console.error('tracking-api rejected:',error?.code||'validation');
  const msg=String(error?.message||'');
  const safe=/^(Informe|Conta não|Conta Meta|Selecione|Confirme|Reconecte|O login da Meta|A Meta|Atualize|Forbidden|Unauthorized|Plataforma)/.test(msg)?msg:'Não foi possível concluir. Confira a conexão e as permissões da plataforma.';
  return json(req,{error:safe},msg==='Unauthorized'?401:400);
 }
});
