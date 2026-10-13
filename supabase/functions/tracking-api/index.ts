import {service,userClient,checkDatabase,guard,json,body,credential,encrypt,env,sha256,requireMember,allowReads} from '../_shared/tracking-runtime.ts';
import {oauthStart,exchangeOAuth,refreshGoogle,refreshKiwify,listAccounts,listGoogleCustomerTree,googleQuery,providerFetch,checkoutAdapters,setMetaStatus} from '../_shared/tracking/adapters.mjs';
import {validateOrder} from '../_shared/tracking/contracts.mjs';
function oauthConfig(provider:string){
 const prefix=provider==='google'?'GOOGLE':'META';
 const config={clientId:env('TRACKING_'+prefix+'_CLIENT_ID'),clientSecret:env('TRACKING_'+prefix+'_CLIENT_SECRET'),version:env('TRACKING_'+prefix+'_VERSION'),redirectUri:env('TRACKING_CALLBACK_ORIGIN')+'/functions/v1/tracking-api?callback='+provider};
 if(!config.clientId||!config.clientSecret||!config.version)throw new Error('OAuth app credentials missing');return config;
}
Deno.serve(async(req)=>{
 try{
  guard();if(req.method==='OPTIONS')return json(req,{},204);
  const url=new URL(req.url),db=service();await checkDatabase(db);
  if(url.searchParams.has('callback')){
   allowReads();const provider=url.searchParams.get('callback')||'';if(!['meta','google'].includes(provider))throw new Error('Invalid provider');
   const {data:state,error}=await db.rpc('tracking_oauth_consume',{h:await sha256(url.searchParams.get('state')||'')});if(error||state.provider!==provider)throw new Error('Invalid OAuth state');
   const tokens=await exchangeOAuth(provider,oauthConfig(provider),url.searchParams.get('code')||'');
   const {data:i,error:insertError}=await db.from('tracking_integrations').upsert({workspace_id:state.workspace_id,provider,account_id:'oauth:'+state.user_id,name:'Autorização '+provider,mode:'real_test_pending',connected:true},{onConflict:'workspace_id,provider,account_id'}).select('id').single();if(insertError)throw insertError;
   const saved=await db.rpc('tracking_internal_save_credential',{i:i.id,p_cipher:await encrypt({...tokens,recipientSource:'PRODUCER'}),p_hash:null});if(saved.error)throw saved.error;
   return Response.redirect(env('TRACKING_FRONTEND_ORIGIN')+'/tracking.html?workspace='+encodeURIComponent(state.workspace_id)+'&oauth='+encodeURIComponent(i.id),303);
  }
  if(req.method!=='POST')return json(req,{error:'POST required'},405);
  const input=await body(req),{client,user}=await userClient(req);
  const w=String(input.workspace||'');await requireMember(client,w,user.id,true);
  if(input.action==='connect_real'){
   allowReads();if(!['meta','kiwify'].includes(input.provider))throw new Error('Provider unavailable in this pilot');
   const workspace=await client.from('tracking_workspaces').select('simulation_only').eq('id',w).single();if(workspace.data?.simulation_only)throw new Error('Selecione sua operação real para conectar uma conta');
   const provider=input.provider;let accountId=String(input.account_id||'').trim();if(provider==='meta'&&/^\d+$/.test(accountId))accountId='act_'+accountId;if(accountId.length<1||accountId.length>200)throw new Error('ID da conta obrigatório');
   let secrets:any,account:any;
   if(provider==='meta'){
    if(!input.access_token||!/^act_\d+$/.test(accountId))throw new Error('Informe o ID act_ e o token da Meta');
    secrets={access_token:String(input.access_token),version:env('TRACKING_META_VERSION')};
    account=await providerFetch('https://graph.facebook.com/'+secrets.version+'/'+accountId+'?fields=id,name,currency,timezone_name',{headers:{Authorization:'Bearer '+secrets.access_token}});if(account.id!==accountId)throw new Error('Conta não autorizada pelo token');account.account_id=accountId;account.timezone=account.timezone_name;
   }else{
    secrets=await refreshKiwify({account_id:accountId,client_id:String(input.client_id||''),client_secret:String(input.client_secret||''),recipientSource:'PRODUCER'});
    await checkoutAdapters.kiwify.listOrdersForReconciliation(secrets,null,null,1);secrets.ingressToken=crypto.randomUUID()+crypto.randomUUID();
   }
   const connected=await client.rpc('tracking_connect',{w,p_provider:provider,p_account:accountId,p_name:account?.name||'Kiwify',p_mode:'real_test_pending'});if(connected.error)throw connected.error;
   const saved=await db.rpc('tracking_internal_save_credential',{i:connected.data,p_cipher:await encrypt(secrets),p_hash:null});if(saved.error)throw saved.error;
   if(account){const selected=await db.rpc('tracking_internal_account',{i:connected.data,p:account});if(selected.error)throw selected.error;}
   const updated=await db.from('tracking_integrations').update({mode:'approved_test',error_code:'sync_requested',last_sync_at:null,sync_cursor:{},retry_after_at:null,error_count:0}).eq('id',connected.data);if(updated.error)throw updated.error;
   return json(req,{integration:connected.data,connected:true,...(provider==='kiwify'?{webhook:env('TRACKING_CALLBACK_ORIGIN')+'/functions/v1/tracking-webhook?provider=kiwify&integration='+connected.data+'&ingress_key='+encodeURIComponent(secrets.ingressToken)}:{})});
  }
  if(input.action==='fixtures'){
   const member=await requireMember(client,w,user.id,true);if(member.role!=='owner')throw new Error('Owner required');
   const existing=await client.from('tracking_integrations').select('mode').eq('workspace_id',w);if(existing.data?.some(i=>i.mode!=='simulated'))throw new Error('Use a separate operation for fixtures');
   const {data:i,error:seedError}=await db.from('tracking_integrations').upsert({workspace_id:w,provider:'custom',account_id:'synthetic-checkout',name:'Checkout sintético',mode:'simulated',connected:true},{onConflict:'workspace_id,provider,account_id'}).select('id').single();if(seedError)throw seedError;
   const rules=await client.from('tracking_cost_rules').select('id').eq('workspace_id',w).limit(1);
   if(!rules.data?.length)await db.from('tracking_cost_rules').insert({workspace_id:w,name:'Custo sintético',product_id:'course-test',category:'product',amount_minor:1200,currency:'BRL',valid_from:'2026-01-01'});
   for(let n=1;n<=40;n++){
    const prior=await db.from('tracking_orders').select('id').eq('workspace_id',w).eq('provider','custom').eq('account_id','synthetic-checkout').eq('external_id','SUPA-TEST-'+n).maybeSingle();if(prior.data)continue;
    const time=new Date(Date.now()-n*3600000).toISOString(),gross=12900;
    const e=validateOrder({schema_version:'1',event_id:'supa-fixture-'+n,order_id:'SUPA-TEST-'+n,status:n%5===0?'pending':'paid',occurred_at:time,created_at:time,approved_at:n%5===0?null:time,currency:'BRL',amount_scale:2,gross_amount_minor:gross,gateway_fee_minor:1300,recipient_revenue_minor:11600,refunded_amount_minor:0,customer:n%4?{external_id:'buyer-'+n,name:'Comprador sintético '+n,email:'teste'+n+'@example.test',phone:null}:null,items:[{external_product_id:'course-test',name:'Produto sintético',quantity:1,amount_minor:gross}],tracking:n%7?{utm_source:n%2?'meta':'google'}:{},renewal:n%6===0,is_test:true});
    const r=await db.rpc('tracking_ingest',{i:i.id,e,h:await sha256(JSON.stringify(e)),p_historical:true});if(r.error)throw r.error;
   }
   return json(req,{orders:40,simulated:true,processing:'queued'});
  }
  if(input.action==='oauth_start'){
   allowReads();const provider=input.provider;if(!['meta','google'].includes(provider))throw new Error('Provider unsupported');
   const state=crypto.randomUUID()+crypto.randomUUID();
   const stored=await db.rpc('tracking_oauth_prepare',{h:await sha256(state),w,u:user.id,p:provider});if(stored.error)throw stored.error;
   return json(req,{url:await oauthStart(provider,{...oauthConfig(provider),state})});
  }
  const {data:integration,error}=await client.from('tracking_integrations').select('*').eq('workspace_id',w).eq('id',input.integration).single();
  if(error||!integration)throw new Error('Integration inaccessible');
  if(input.action==='webhook_details'){
   const {secrets}=await credential(db,integration.id);if(integration.provider!=='kiwify')throw new Error('Provider unsupported');
   return json(req,{webhook:env('TRACKING_CALLBACK_ORIGIN')+'/functions/v1/tracking-webhook?provider=kiwify&integration='+integration.id+'&ingress_key='+encodeURIComponent(secrets.ingressToken)});
  }
  if(input.action==='ad_status'){
   if(integration.provider!=='meta'||integration.mode==='simulated')throw new Error('Conta Meta real necessária');
   const entity=await client.from('tracking_ad_entities').select('*').eq('workspace_id',w).eq('provider','meta').eq('account_id',integration.account_id).eq('entity_id',input.entity_id).single();
   if(entity.error||entity.data.revision!==input.revision)throw new Error('Atualize a campanha antes de alterar');
   const {secrets}=await credential(db,integration.id);await setMetaStatus({...secrets,version:env('TRACKING_META_VERSION')},input.entity_id,input.status);
   const saved=await db.from('tracking_ad_entities').update({status:input.status,revision:input.revision+1,status_updated_at:new Date().toISOString()}).eq('workspace_id',w).eq('provider','meta').eq('account_id',integration.account_id).eq('entity_id',input.entity_id).eq('revision',input.revision);if(saved.error)throw saved.error;
   await db.from('tracking_audit').insert({workspace_id:w,actor_id:user.id,action:'ad.status',entity_id:input.entity_id,details:{provider:'meta',status:input.status}});return json(req,{status:input.status});
  }
  if(input.action==='simulate'){
   if(integration.mode!=='simulated'||!['custom','kiwify','hotmart'].includes(integration.provider))throw new Error('Use a simulated checkout operation');
   const e=validateOrder(input.event);const r=await db.rpc('tracking_ingest',{i:integration.id,e,h:await sha256(JSON.stringify(e)),p_historical:false});if(r.error)throw r.error;
   return json(req,{receipt_id:r.data,processing:'queued',simulated:true},202);
  }
  if(input.action==='api_token'){
   if(integration.provider!=='custom')throw new Error('Only custom order API uses bearer credential');
   const token=crypto.randomUUID()+crypto.randomUUID();const saved=await db.rpc('tracking_internal_save_credential',{i:integration.id,p_cipher:null,p_hash:await sha256(token)});if(saved.error)throw saved.error;
   return json(req,{token,notice:'Exibido uma vez; mantenha em secret store.'});
  }
  if(input.action==='purchase_actions'||input.action==='select_purchase_actions'){
   allowReads();if(integration.provider!=='google'||!/^\d+$/.test(integration.account_id))throw new Error('Select an authorized leaf account first');
   const {secrets}=await credential(db,integration.id);let config={...oauthConfig('google'),...secrets};if(config.refresh_token)config={...config,...await refreshGoogle(config)};
   const rows=await googleQuery(config,integration.account_id,"SELECT conversion_action.resource_name, conversion_action.name, conversion_action.category FROM conversion_action WHERE conversion_action.category = 'PURCHASE' AND conversion_action.status = 'ENABLED'");
   const actions=rows.map(r=>({id:r.conversionAction.resourceName,name:r.conversionAction.name}));
   if(input.action==='purchase_actions')return json(req,{actions,selected:secrets.selected_purchase_actions||[]});
   const ids=input.ids||[];if(!Array.isArray(ids)||ids.some(id=>!actions.some(a=>a.id===id)))throw new Error('Conversion action is not an authorized Purchase');
   const saved=await db.rpc('tracking_internal_save_credential',{i:integration.id,p_cipher:await encrypt({...secrets,selected_purchase_actions:ids}),p_hash:null});if(saved.error)throw saved.error;
   return json(req,{selected:ids});
  }
  if(input.action==='checkout_credentials'){
   if(!['hotmart','kiwify'].includes(integration.provider))throw new Error('Invalid checkout');
   const secrets=input.secrets||{};if(!secrets.recipientSource||!['PRODUCER','AFFILIATE','COPRODUCER'].includes(secrets.recipientSource))throw new Error('Recipient role required');
   if(integration.provider==='hotmart'&&!secrets.hottok)throw new Error('Hottok required');
   if(integration.provider==='kiwify'&&(!secrets.account_id||secrets.account_id!==integration.account_id||!secrets.access_token))throw new Error('Kiwify read-only OAuth and canonical account credentials required');
   if(integration.provider==='kiwify')secrets.ingressToken=crypto.randomUUID()+crypto.randomUUID();
   const stored=await db.rpc('tracking_internal_save_credential',{i:integration.id,p_cipher:await encrypt(secrets),p_hash:null});if(stored.error)throw stored.error;
   await db.from('tracking_integrations').update({mode:'real_test_pending'}).eq('id',integration.id);
   return json(req,{status:'real_test_pending',webhook:env('TRACKING_CALLBACK_ORIGIN')+'/functions/v1/tracking-webhook?provider='+integration.provider+'&integration='+integration.id+(integration.provider==='kiwify'?'&ingress_key='+encodeURIComponent(secrets.ingressToken):'')});
  }
  if(input.action==='accounts'){
   allowReads();const {secrets}=await credential(db,integration.id);let config={...oauthConfig(integration.provider),...secrets};if(integration.provider==='google'&&config.refresh_token)config={...config,...await refreshGoogle(config)};
   const accounts=integration.provider==='google'?await listGoogleCustomerTree(config):await listAccounts(integration.provider,config);
   if(integration.provider==='meta')for(const a of accounts)a.timezone=a.timezone_name;
   return json(req,{accounts});
  }
  if(input.action==='select_account'){
   allowReads();const {secrets}=await credential(db,integration.id);let config={...oauthConfig(integration.provider),...secrets};if(integration.provider==='google'&&config.refresh_token)config={...config,...await refreshGoogle(config)};
   const available=integration.provider==='google'?await listGoogleCustomerTree(config):await listAccounts(integration.provider,config),account=available.find(a=>a.account_id===input.account_id);if(!account)throw new Error('Account not authorized');
   if(account.manager)throw new Error('Select a leaf customer of the MCC');
   if(integration.provider==='meta')account.timezone=account.timezone_name;
   const connected=await client.rpc('tracking_connect',{w,p_provider:integration.provider,p_account:account.account_id,p_name:account.name,p_mode:'real_test_pending'});if(connected.error)throw connected.error;
   const saved=await db.rpc('tracking_internal_save_credential',{i:connected.data,p_cipher:await encrypt({...secrets,login_customer_id:account.login_customer_id||null}),p_hash:null});if(saved.error)throw saved.error;
   const selected=await db.rpc('tracking_internal_account',{i:connected.data,p:account});if(selected.error)throw selected.error;
   return json(req,{integration:connected.data,status:'real_test_pending'});
  }
  if(input.action==='configure_test_capi'){
   const authorized=env('TRACKING_AUTHORIZED_TEST_PIXELS').split(',').filter(Boolean);
   if(!authorized.includes(input.pixel_id)||!input.test_event_code||input.coordinated_emitter!==true||input.consent!==true)throw new Error('Authorized test pixel, event code, coordinated emitter and consent required');
   const r=await db.rpc('tracking_internal_capi',{w,p:{pixel_id:input.pixel_id,test_event_code:input.test_event_code,enabled:input.enabled===true,coordinated_emitter:true,consent:true},p_cipher:await encrypt({access_token:input.access_token})});if(r.error)throw r.error;
   return json(req,{status:input.enabled?'enabled_test_only':'disabled'});
  }
  if(input.action==='queue_sync'){
   allowReads();await db.from('tracking_integrations').update({error_code:'sync_requested'}).eq('id',integration.id);
   return json(req,{status:'queued'});
  }
  throw new Error('Unsupported action');
 }catch(error){console.error('tracking-api rejected:',error?.code||'validation');const msg=String(error?.message||'');const safe=/^(Informe|Conta não|Selecione|ID da|Credenciais|A Meta|Atualize|Forbidden|Unauthorized)/.test(msg)?msg:msg==='token_revoked'?'Credencial inválida, expirada ou sem permissão.':'Não foi possível concluir. Confira as credenciais e permissões da integração.';return json(req,{error:safe},msg==='Unauthorized'?401:400);}
});
