import {service,checkDatabase,guard,json,credential,decrypt,env,allowReads} from '../_shared/tracking-runtime.ts';
import {syncMeta,syncGoogle,refreshGoogle,checkoutAdapters,capiPayload,providerFetch,metaEntities,metaFailure} from '../_shared/tracking/adapters.mjs';
import {normalizeKiwify,normalizeHotmartHistory,reconciliationIdentity,sha256,constantEqual} from '../_shared/tracking/contracts.mjs';
import webpush from 'npm:web-push@3.6.7';
import {notificationPush} from '../_shared/tracking/notifications.mjs';
import {fetchAdExchangeRates} from '../_shared/tracking/ad-exchange-rates.mjs';
import {cartpandaOrders,cartpandaOrderSnapshot,cartpandaSyncDue} from '../_shared/tracking/cartpanda-orders.mjs';
const rpc=async(db:any,name:string,args:any={})=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data;};
async function syncMetaAccount(db:any,integration:any,date:Date){
 const i=integration.id,g=integration.connection_generation;
 const claim=await rpc(db,'tracking_claim_meta_sync',{i,g});
 if(!claim)return;
 const publish=(stats:any[],entities:any[],failure:string|null,retry_seconds:number)=>
  rpc(db,'tracking_publish_meta_sync',{i,g,claim,stats,entities,failure,retry_seconds});
 try{
  const {secrets}=await credential(db,i);
  const config={...secrets,version:secrets.version||env('TRACKING_META_VERSION')||'v25.0'};
  const {data:account,error}=await db.from('tracking_ad_accounts').select('*')
   .eq('workspace_id',integration.workspace_id).eq('provider','meta').eq('account_id',integration.account_id).eq('selected',true).maybeSingle();
  if(error||!account)throw new Error('sync_failed');
  const to=new Intl.DateTimeFormat('sv-SE',{timeZone:account.timezone||'America/Sao_Paulo'}).format(date);
  const previous=integration.last_sync_at ? new Date(integration.last_sync_at).getTime() : 0;
  const days=previous?Math.min(89,Math.max(6,Math.ceil((+date-previous)/86400000)+2)):89;
  const from=new Date(new Date(to+'T12:00:00Z').getTime()-days*86400000).toISOString().slice(0,10);
  const stats=await syncMeta(config,account,from,to);
  const entities=await metaEntities(config,integration.account_id);
  await publish(stats,entities,null,0);
 }catch(error:any){
  const code=metaFailure(error);
  const delay=Math.max(Number(error.retryAfter)||60,Math.min(3600,2**Math.min(8,integration.error_count||0)*30));
  console.error('tracking-sync:', 'meta', code);
  await publish([],[],code,delay+Math.floor(Math.random()*5));
 }
}
async function reconcileCartpanda(db:any, integration:any, secrets:any, date:Date){
 const cursor=integration.sync_cursor?.cartpanda_orders;
 const previous=integration.last_sync_at ? Date.parse(integration.last_sync_at) : NaN;
 const {data:catalog,error}=await db.from('tracking_catalog_snapshots').select('cipher')
  .eq('integration_id',integration.id).eq('workspace_id',integration.workspace_id).maybeSingle();
 if(error)throw error;
 if(!catalog?.cipher){
  if(integration.error_code==='sync_requested')await rpc(db,'tracking_internal_status',{i:integration.id,p_code:'payload_incomplete'});
  return;
 }

 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'});
 const since=Number.isFinite(previous)?Math.max(+date-89*86400000,previous-2*86400000):+date-7*86400000;
 const window=cursor||{from:day.format(since),to:day.format(+date+86400000),page:1,offset:0,hadInvalidOrder:false};
 const {rows,hasNextPage}=await cartpandaOrders(await decrypt(catalog.cipher),window);
 const batch=rows.slice(window.offset,window.offset+20);
 const idList=batch.map(order=>String(order?.id??'')).filter(id=>/^[1-9][0-9]*$/.test(id));
 const existing=new Map<string,{at:number,status:string}>();
 if(idList.length){
  const {data,error}=await db.from('tracking_orders').select('external_id,last_occurred_at,status')
   .eq('workspace_id',integration.workspace_id).eq('provider','cartpanda').eq('account_id',integration.account_id)
   .in('external_id',idList);
  if(error)throw error;
  for(const order of data)existing.set(order.external_id,{at:Date.parse(order.last_occurred_at),status:order.status});
 }
 let hadInvalidOrder=window.hadInvalidOrder;
 for(const order of batch){
  let event;
  try{event=await cartpandaOrderSnapshot(order,{manual_fees:secrets.manual_fees===true});}
  catch{
   hadInvalidOrder=true;
   console.warn('tracking-cartpanda: order snapshot rejected',integration.id);
   continue;
  }
  if(!event)continue;
  const lastEvent=existing.get(event.order_id);
  const eventTime=Date.parse(event.occurred_at);
  if(lastEvent&&(eventTime<lastEvent.at||(eventTime===lastEvent.at&&event.status===lastEvent.status)))continue;
  const receipt=await rpc(db,'tracking_ingest',{i:integration.id,e:event,h:event.reconciliation_hash,p_historical:true});
  try{await rpc(db,'tracking_process_receipt',{r:receipt});}
  catch{console.warn('tracking-cartpanda: receipt queued for retry',integration.id);}
 }
 const nextOffset=window.offset+batch.length;
 const next=nextOffset<rows.length?{...window,offset:nextOffset,hadInvalidOrder}:
  hasNextPage?{...window,page:window.page+1,offset:0,hadInvalidOrder}:null;
 const {cartpanda_orders:_,...otherCursor}=integration.sync_cursor||{};
 let save=db.from('tracking_integrations').update({
  sync_cursor:next?{...otherCursor,cartpanda_orders:next}:otherCursor,
  ...(next?{}:{last_sync_at:date.toISOString()}),error_count:0,retry_after_at:null
 }).eq('id',integration.id).eq('connected',true).eq('connection_generation',integration.connection_generation)
  .eq('sync_cursor',JSON.stringify(integration.sync_cursor||{}));
 save=integration.last_sync_at?save.eq('last_sync_at',integration.last_sync_at):save.is('last_sync_at',null);
 const {data:saved,error:saveError}=await save.select('id').maybeSingle();
 if(saveError)throw saveError;
 if(!saved||next)return;
 if(hadInvalidOrder)await rpc(db,'tracking_internal_status',{i:integration.id,p_code:'payload_incomplete'});
 else if(/^(?:provider_http_\d+|sync_failed|rate_limit|sync_requested|payload_incomplete)$/.test(integration.error_code||'')){
  const {error}=await db.from('tracking_integrations').update({error_code:null}).eq('id',integration.id)
   .eq('connection_generation',integration.connection_generation).eq('error_code',integration.error_code);
  if(error)throw error;
 }
}
Deno.serve(async(req)=>{
 try{
  guard();if(req.method!=='POST')return json(req,{error:'Unauthorized worker'},401);
  const db=service();await checkDatabase(db);if(!env('TRACKING_WORKER_SECRET')||!await constantEqual(req.headers.get('authorization'),'Bearer '+env('TRACKING_WORKER_SECRET')))return json(req,{error:'Unauthorized worker'},401);
  const refreshExchangeRates=env('TRACKING_ALLOW_EXTERNAL_READS')==='true'
   ?fetchAdExchangeRates().then(rates=>rpc(db,'tracking_save_ad_exchange_rates',{p:rates}))
    .catch(error=>{
     const providerCode=/^ad_exchange_(?:http_\d{3}|empty)$/.test(error?.message)?error.message:null;
     console.error('tracking-worker: exchange rates unavailable',providerCode||error?.code||error?.name||'failure');
    })
   :null;
  const jobs=await rpc(db,'tracking_claim_jobs',{p_limit:30});let processed=0;
  for(const job of jobs){
   try{await rpc(db,'tracking_process_receipt',{r:job.receipt_id});processed++;}
   catch(error){
    await rpc(db,'tracking_fail_job',{j:job.id,code:'normalization_or_transition_failed'});
    if(job.attempts>=8){
     try{await rpc(db,'tracking_internal_status',{i:job.integration_id,p_code:'payload_incomplete'});}
     catch{console.error('tracking-worker: exhausted order retries',job.integration_id);}
    }
   }
  }
  const outbox=await rpc(db,'tracking_internal_outbox');
  for(const d of outbox){
   try{
    if(d.channel==='in_app'){await rpc(db,'tracking_delivery_result',{i:d.id,p_success:true,p_code:null});continue;}
    if(d.channel==='push'){
     const publicKey=env('TRACKING_VAPID_PUBLIC_KEY')||env('VAPID_PUBLIC_KEY'),privateKey=env('TRACKING_VAPID_PRIVATE_KEY')||env('VAPID_PRIVATE_KEY'),subject=env('TRACKING_VAPID_SUBJECT')||env('VAPID_SUBJECT')||'mailto:contato@magemind.com.br';
     if(!privateKey||!publicKey)throw new Error('vapid_missing');
     const members=await db.from('tracking_members').select('user_id').eq('workspace_id',d.workspace_id).eq('user_id',d.user_id).maybeSingle();if(!members.data)throw new Error('membership_revoked');
     webpush.setVapidDetails(subject,publicKey,privateKey);
     for(const s of d.subscriptions){
      if(!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(new URL(s.endpoint).hostname))throw new Error('push_host_not_allowlisted');
      try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(notificationPush(d,env('TRACKING_FRONTEND_ORIGIN'))),{TTL:3600});}
      catch(error){if([404,410].includes(error.statusCode))await rpc(db,'tracking_internal_expire_push',{i:s.id});else throw error;}
     }
    }
    if(d.channel==='capi'){
     const dest=d.destination;const allowlist=env('TRACKING_AUTHORIZED_TEST_PIXELS').split(',').filter(Boolean);
     if(!dest||!allowlist.includes(dest.pixel_id))throw new Error('test_pixel_not_authorized');
     const secrets=await decrypt(dest.cipher),payload=await capiPayload(d.order,d.customer,{...dest,authorized_test_pixel:true});
     await providerFetch('https://graph.facebook.com/'+env('TRACKING_META_VERSION')+'/'+dest.pixel_id+'/events',{method:'POST',headers:{Authorization:'Bearer '+secrets.access_token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    }
    await rpc(db,'tracking_delivery_result',{i:d.id,p_success:true,p_code:null});
   }catch(error){await rpc(db,'tracking_delivery_result',{i:d.id,p_success:false,p_code:['vapid_missing','membership_revoked','test_pixel_not_authorized'].includes(error.message)?error.message:'external_delivery_failed'});}
  }
  const date=new Date(),to=date.toISOString().slice(0,10),from=new Date(+date-7*86400000).toISOString().slice(0,10);
  if(env('TRACKING_ALLOW_EXTERNAL_READS')==='true'){
   const {data:integrations}=await db.from('tracking_integrations').select('*').eq('connected',true).neq('mode','simulated');
   for(const i of integrations||[]){
    const from=new Date(+date-(i.last_sync_at?6:89)*86400000).toISOString().slice(0,10);
    if(i.account_id.startsWith('oauth:'))continue;
    if(i.provider==='meta'){
     try{await syncMetaAccount(db,i,date);}
     catch(error:any){console.error('tracking-meta-sync:',error?.code||'failure');}
     continue;
    }
    if(i.retry_after_at&&new Date(i.retry_after_at)>date)continue;
    if(i.provider==='cartpanda'&&!cartpandaSyncDue(i,date))continue;
    if(i.last_sync_at&&+date-new Date(i.last_sync_at).getTime()<45000&&!i.error_code)continue;
    try{
     const {secrets}=await credential(db,i.id);
     if(i.provider==='google'){
      let config={...secrets,version:secrets.version||env('TRACKING_GOOGLE_VERSION')};
      if(config.refresh_token)config={...config,...await refreshGoogle({...config,clientId:env('TRACKING_GOOGLE_CLIENT_ID'),clientSecret:env('TRACKING_GOOGLE_CLIENT_SECRET')})};
      const {data:account}=await db.from('tracking_ad_accounts').select('*').eq('workspace_id',i.workspace_id).eq('provider','google').eq('account_id',i.account_id).eq('selected',true).maybeSingle();
      if(!account)continue;
      const localTo=new Intl.DateTimeFormat('sv-SE',{timeZone:account.timezone||'America/Sao_Paulo'}).format(date);
      const localFrom=new Date(new Date(localTo+'T12:00:00Z').getTime()-(i.last_sync_at?6:89)*86400000).toISOString().slice(0,10);
      const rows=await syncGoogle(config,account,localFrom,localTo);
      await rpc(db,'tracking_internal_ad_snapshot',{i:i.id,p:rows});
      await rpc(db,'tracking_internal_status',{i:i.id,p_code:null});
      await db.from('tracking_integrations').update({error_count:0,retry_after_at:null}).eq('id',i.id);
     }else if(i.provider==='cartpanda'){
      await reconcileCartpanda(db,i,secrets,date);
     }else if(i.provider==='kiwify'&&!secrets.webhook_only){
      const cursor=i.sync_cursor||{},page=Number(cursor.page||1),offset=Number(cursor.offset||0);
      const response=await checkoutAdapters.kiwify.listOrdersForReconciliation(secrets,cursor.from||from,cursor.to||to,page);
      const rows=response.data||response.items||[];
      for(const raw of rows.slice(offset,offset+20)){
        const full=await checkoutAdapters.kiwify.fetchOrder(String(raw.id),secrets);
        const e=normalizeKiwify(full,{...secrets,isTest:false,authoritative:true,eventId:'reconcile:'+full.id+':'+full.updated_at+':'+full.status});
        await rpc(db,'tracking_ingest',{i:i.id,e,h:await sha256(JSON.stringify(e)),p_historical:true});
      }
      const next=offset+20<rows.length?{page,offset:offset+20,from:cursor.from||from,to:cursor.to||to}:rows.length===100||response.pagination?.has_more||response.has_more?{page:page+1,offset:0,from:cursor.from||from,to:cursor.to||to}:{};
      await db.from('tracking_integrations').update({sync_cursor:next,...(Object.keys(next).length?{}:{last_sync_at:date.toISOString()}),error_code:null,error_count:0,retry_after_at:null}).eq('id',i.id);
      await rpc(db,'tracking_internal_status',{i:i.id,p_code:null});
     }else if(i.provider==='hotmart'&&!secrets.webhook_only){
      const statuses=['APPROVED','COMPLETE','WAITING_PAYMENT','PRINTED_BILLET','REFUNDED','CHARGEBACK','CANCELLED','PROTESTED'];
      const cursor=i.sync_cursor||{},index=Number(cursor.status_index||0);
      const response=await checkoutAdapters.hotmart.listOrdersForReconciliation(secrets,cursor.from||from,cursor.to||to,cursor.page_token||null,fetch,undefined,statuses[index]);
      for(const row of (response.items||[]).slice(Number(cursor.offset||0),Number(cursor.offset||0)+20)){
       const commissions=await checkoutAdapters.hotmart.fetchCommissions(row.purchase.transaction,row.purchase.status,secrets);
       const e=await reconciliationIdentity(normalizeHotmartHistory(row,{...secrets,isTest:false,reconciledAt:date.toISOString()},commissions.items?.find(c=>c.transaction===row.purchase.transaction)?.commissions||[]));
       await rpc(db,'tracking_ingest',{i:i.id,e,h:e.reconciliation_hash,p_historical:true});
      }
      const offset=Number(cursor.offset||0)+20,nextPage=response.page_info?.next_page_token;
      let next;
      if(offset<(response.items||[]).length)next={status_index:index,page_token:cursor.page_token||null,offset,from:cursor.from||from,to:cursor.to||to};
      else if(nextPage)next={status_index:index,page_token:nextPage,offset:0,from:cursor.from||from,to:cursor.to||to};
      else if(index+1<statuses.length)next={status_index:index+1,offset:0,from:cursor.from||from,to:cursor.to||to};
      else next={};
      await db.from('tracking_integrations').update({sync_cursor:next,...(Object.keys(next).length?{}:{last_sync_at:date.toISOString()}),error_code:null,error_count:0,retry_after_at:null}).eq('id',i.id);
      await rpc(db,'tracking_internal_status',{i:i.id,p_code:null});
     }
    }catch(error){
     const code=error.providerCode===200&&/API access blocked/i.test(error.providerDetail||'')?'meta_confirmation_required':['token_revoked','rate_limit'].includes(error.message)?error.message:/^provider_http_\d+$/.test(error.message)?error.message+(error.providerCode?'_'+error.providerCode:''):'sync_failed';
     console.error('tracking-sync:',i.provider,code,error.providerDetail||error.code||'');
     await rpc(db,'tracking_internal_status',{i:i.id,p_code:code});
     const delay=Math.max(error.retryAfter||60,Math.min(code==='meta_confirmation_required'?300:3600,2**Math.min(8,i.error_count||0)*30))+Math.floor(Math.random()*5);
     await db.from('tracking_integrations').update({error_count:(i.error_count||0)+1,retry_after_at:new Date(Date.now()+delay*1000).toISOString()}).eq('id',i.id);
    }
   }
  }
  await refreshExchangeRates;
  await rpc(db,'tracking_prune');
  return json(req,{processed,outbox:outbox.length,environment:env('TRACKING_ENVIRONMENT')});
 }catch(error){console.error('tracking-worker:',error?.code||'failure');return json(req,{error:'Worker failed'},500);}
});
