import {service,checkDatabase,guard,json,credential,decrypt,env,allowReads} from '../_shared/tracking-runtime.ts';
import {syncMeta,syncGoogle,refreshGoogle,checkoutAdapters,capiPayload,providerFetch,metaEntities} from '../_shared/tracking/adapters.mjs';
import {normalizeKiwify,normalizeHotmartHistory,reconciliationIdentity,sha256,constantEqual} from '../_shared/tracking/contracts.mjs';
import webpush from 'npm:web-push@3.6.7';
const rpc=async(db:any,name:string,args:any={})=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data;};
Deno.serve(async(req)=>{
 try{
  guard();if(req.method!=='POST')return json(req,{error:'Unauthorized worker'},401);
  const db=service();await checkDatabase(db);if(!env('TRACKING_WORKER_SECRET')||!await constantEqual(req.headers.get('authorization'),'Bearer '+env('TRACKING_WORKER_SECRET')))return json(req,{error:'Unauthorized worker'},401);const jobs=await rpc(db,'tracking_claim_jobs',{p_limit:30});let processed=0;
  for(const job of jobs){
   try{await rpc(db,'tracking_process_receipt',{r:job.receipt_id});processed++;}
   catch(error){await rpc(db,'tracking_fail_job',{j:job.id,code:'normalization_or_transition_failed'});}
  }
  const date=new Date(),to=date.toISOString().slice(0,10),from=new Date(+date-7*86400000).toISOString().slice(0,10);
  if(env('TRACKING_ALLOW_EXTERNAL_READS')==='true'){
   const {data:integrations}=await db.from('tracking_integrations').select('*').eq('connected',true).neq('mode','simulated');
   for(const i of integrations||[]){
    const from=new Date(+date-(i.last_sync_at?6:89)*86400000).toISOString().slice(0,10);
    if(i.account_id.startsWith('oauth:'))continue;
    if(i.retry_after_at&&new Date(i.retry_after_at)>date)continue;
    if(i.last_sync_at&&+date-new Date(i.last_sync_at).getTime()<600000&&i.error_code!=='sync_requested')continue;
    try{
     const {secrets}=await credential(db,i.id);
     if(['meta','google'].includes(i.provider)){
      let config={...secrets,version:secrets.version||env('TRACKING_'+i.provider.toUpperCase()+'_VERSION')};
      if(i.provider==='google'&&config.refresh_token)config={...config,...await refreshGoogle({...config,clientId:env('TRACKING_GOOGLE_CLIENT_ID'),clientSecret:env('TRACKING_GOOGLE_CLIENT_SECRET')})};
      const {data:account}=await db.from('tracking_ad_accounts').select('*').eq('workspace_id',i.workspace_id).eq('provider',i.provider).eq('account_id',i.account_id).eq('selected',true).maybeSingle();
      if(!account)continue;const rows=i.provider==='meta'?await syncMeta(config,account,from,to):await syncGoogle(config,account,from,to);
      await rpc(db,'tracking_internal_ad_snapshot',{i:i.id,p:rows});
      if(i.provider==='meta')for(const e of await metaEntities(config,i.account_id)){
       const prior=await db.from('tracking_ad_entities').select('revision,status').eq('workspace_id',i.workspace_id).eq('provider','meta').eq('account_id',i.account_id).eq('entity_id',e.entity_id).maybeSingle();
       const saved=await db.from('tracking_ad_entities').upsert({...e,workspace_id:i.workspace_id,provider:'meta',account_id:i.account_id,revision:(prior.data?.revision||0)+(prior.data&&prior.data.status!==e.status?1:0)},{onConflict:'workspace_id,provider,account_id,entity_id'});if(saved.error)throw saved.error;
      }
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
     }
    }catch(error){
     await rpc(db,'tracking_internal_status',{i:i.id,p_code:error.message==='token_revoked'?'token_revoked':error.message==='rate_limit'?'rate_limit':'sync_failed'});
     const delay=Math.max(error.retryAfter||60,Math.min(3600,2**Math.min(8,i.error_count||0)*30))+Math.floor(Math.random()*5);
     await db.from('tracking_integrations').update({error_count:(i.error_count||0)+1,retry_after_at:new Date(Date.now()+delay*1000).toISOString()}).eq('id',i.id);
    }
   }
  }
  const outbox=await rpc(db,'tracking_internal_outbox');
  for(const d of outbox){
   try{
    if(d.channel==='in_app'){await rpc(db,'tracking_delivery_result',{i:d.id,p_success:true,p_code:null});continue;}
    if(d.channel==='push'){
     if(!env('TRACKING_VAPID_PRIVATE_KEY')||!env('TRACKING_VAPID_PUBLIC_KEY')||!env('TRACKING_VAPID_SUBJECT'))throw new Error('vapid_missing');
     const members=await db.from('tracking_members').select('user_id').eq('workspace_id',d.workspace_id).eq('user_id',d.user_id).maybeSingle();if(!members.data)throw new Error('membership_revoked');
     webpush.setVapidDetails(env('TRACKING_VAPID_SUBJECT'),env('TRACKING_VAPID_PUBLIC_KEY'),env('TRACKING_VAPID_PRIVATE_KEY'));
     for(const s of d.subscriptions){
      if(!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(new URL(s.endpoint).hostname))throw new Error('push_host_not_allowlisted');
      const hidden=d.preference?.hide_amount!==false,labels={sale:'Venda aprovada',renewal:'Renovação aprovada',refund:'Devolução registrada',failure:'Uma integração precisa de atenção'};
      const title=labels[d.category]||'Atualização da sua operação',amount=d.order?new Intl.NumberFormat('pt-BR',{style:'currency',currency:d.order.currency}).format(Number(d.category==='refund'?d.order.refund_minor:d.order.gross_minor)/10**d.order.amount_scale):null;
      try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify({environment:'test',workspaceId:d.workspace_id,orderId:d.order_id,integrationId:d.integration_id,hideAmount:hidden,body:title+(hidden||amount==null?'':' · '+amount),url:env('TRACKING_FRONTEND_ORIGIN')+'/tracking.html?workspace='+d.workspace_id+(d.order_id?'&order='+d.order_id:'&tab=integrations')}),{TTL:3600});}
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
  await rpc(db,'tracking_prune');
  return json(req,{processed,outbox:outbox.length,environment:env('TRACKING_ENVIRONMENT')});
 }catch(error){console.error('tracking-worker:',error?.code||'failure');return json(req,{error:'Worker failed'},500);}
});
