import {service,checkDatabase,guard,json,body,credential,sha256,allowReads} from '../_shared/tracking-runtime.ts';
import {checkoutAdapters} from '../_shared/tracking/adapters.mjs';
import {normalizeCustom,normalizeHotmart,normalizeKiwify,bridgeClick,constantEqual} from '../_shared/tracking/contracts.mjs';
import {checkoutProviders} from '../_shared/tracking/connectors.mjs';
import {normalizeWebhook,verifyWebhook,canonicalJSON} from '../_shared/tracking/webhooks.mjs';
Deno.serve(async(req)=>{
 try{
  guard();
  if(req.method==='OPTIONS'&&new URL(req.url).searchParams.get('provider')==='collector'){
   const origin=req.headers.get('origin');if(!origin)return json(req,{error:'Origin required'},403);
   const db=service();await checkDatabase(db);const sites=await db.from('tracking_sites').select('id').eq('domain',new URL(origin).hostname).eq('enabled',true).limit(1);
   if(!sites.data?.length)return json(req,{error:'Origin not registered'},403);
   return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}});
  }
  if(req.method==='OPTIONS')return json(req,{},204);
  if(req.method!=='POST')return json(req,{error:'POST required'},405);
  const db=service();await checkDatabase(db);const url=new URL(req.url),payload=await body(req),provider=url.searchParams.get('provider');
  const limit=await db.rpc('consume_security_rate_limit',{p_bucket_key:'tracking-webhook:'+String(url.searchParams.get('integration')||'custom').slice(0,100),p_limit:100,p_window_seconds:60});
  if(limit.error||limit.data?.[0]?.allowed!==true)return json(req,{error:'rate_limit'},429);
  if(provider==='collector'){
   const origin=req.headers.get('origin');if(!origin)return json(req,{error:'Origin required'},403);
   if(!['page_view','view_content','add_to_cart','checkout_click','initiate_checkout'].includes(payload.event_name))return json(req,{error:'Financial events forbidden'},400);
   const tracking=bridgeClick(payload.tracking);const cleaned={event_id:String(payload.event_id||'').slice(0,100),session_id:String(payload.session_id||'').slice(0,100),click_id:String(payload.click_id||'').slice(0,100),event_name:payload.event_name,occurred_at:payload.occurred_at,tracking,persisted:payload.persisted===true};
   const r=await db.rpc('tracking_collect',{p_key:payload.site_key,p_origin:new URL(origin).hostname,p:cleaned});if(r.error)throw r.error;
   return new Response(JSON.stringify({accepted:true}),{status:202,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store'}});
  }
  let id=url.searchParams.get('integration'),event;
  if(provider==='custom'){
   const bearer=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!bearer)return json(req,{error:'Credential required'},401);
   const {data,error}=await db.rpc('tracking_resolve_api_credential',{h:await sha256(bearer)});if(error||!data)return json(req,{error:'Invalid credential'},401);id=data.id;event=normalizeCustom(payload);
  }else{
   if(!id||!checkoutProviders.includes(provider||''))return json(req,{error:'Invalid integration'},400);
   const {row,secrets}=await credential(db,id);if(row.integration.provider!==provider)return json(req,{error:'Provider mismatch'},403);
   if(secrets.webhook_only===true){
    if(!await verifyWebhook(provider,req,payload,secrets))return json(req,{error:'Invalid webhook credential'},401);
    const hash=await sha256(canonicalJSON(payload)),clock=await db.rpc('tracking_webhook_clock',{i:id,h:hash});if(clock.error)throw clock.error;
    try{event=await normalizeWebhook(provider,payload,{...secrets,receivedAt:clock.data});}catch(error){if(error?.message==='Synthetic events are unavailable')return json(req,{accepted:true,processing:'ignored_test'},200);await db.from('tracking_integrations').update({error_code:'payload_incomplete'}).eq('id',id);throw error;}
    if(!event)return json(req,{accepted:true,processing:'ignored'},200);
   }else if(provider==='hotmart'){
    if(!await checkoutAdapters.hotmart.verifyRequest(req,secrets))return json(req,{error:'Invalid Hottok'},401);
    event=normalizeHotmart(payload,{...secrets,isTest:false});
   }else{
    allowReads();if(!await constantEqual(url.searchParams.get('ingress_key'),secrets.ingressToken)&&!await checkoutAdapters.custom.verifyRequest(req,{token:secrets.ingressToken}))return json(req,{error:'Ingress credential required'},401);
    const orderId=String(payload.order_id||payload.id||'');if(!orderId||orderId.length>200)throw new Error('Order ID required');
    const verified=await checkoutAdapters.kiwify.fetchOrder(orderId,secrets);
    if(String(verified.id)!==orderId)throw new Error('Authoritative order mismatch');
    // Origin and monetary changes come exclusively from the authenticated API response.
    const eventId='kiwify:'+orderId+':'+String(verified.updated_at)+':'+String(verified.status);
    event=normalizeKiwify(verified,{...secrets,authoritative:true,eventId,isTest:false});
   }
  }
  const {data,error}=await db.rpc('tracking_ingest',{i:id,e:event,h:await sha256(JSON.stringify(event)),p_historical:false});if(error)throw error;
  await db.from('tracking_integrations').update({error_code:null}).eq('id',id).eq('error_code','payload_incomplete');
  // Process immediately; the durable job remains retryable if processing fails.
  const processed=await db.rpc('tracking_process_receipt',{r:data});
  return json(req,{receipt_id:data,processing:processed.error?'queued':'processed'},202);
 }catch(error){console.error('tracking-webhook rejected:',error?.code||'validation');return json(req,{error:'Event rejected; validate authentication and connector diagnostics'},400);}
});
