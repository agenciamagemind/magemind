import {minor,SCALES,sha256,constantEqual,normalizeCustom,normalizeHotmart,normalizeKiwify} from './contracts.mjs';
const HOSTS=new Set(['graph.facebook.com','www.facebook.com','oauth2.googleapis.com','accounts.google.com','googleads.googleapis.com','public-api.kiwify.com','api-sec-vlc.hotmart.com','api.hotmart.com']);
export async function providerFetch(url,options={},fetcher=fetch) {
 const u=new URL(url);if(u.protocol!=='https:'||!HOSTS.has(u.hostname))throw new Error('External host not allowlisted');
 const method=options.method||'GET';
 if(/mutate|budgets|withdrawals|payouts|\/refund(?:\/|$)/i.test(u.pathname))throw new Error('Management and financial mutations forbidden');
 if(method!=='GET'&&u.hostname==='graph.facebook.com'&&!u.pathname.endsWith('/events')&&!/^\/v\d+\.\d+\/oauth\/access_token$/.test(u.pathname))throw new Error('Only OAuth exchange and explicit test conversions may write to Meta');
 if(method!=='GET'&&u.hostname==='public-api.kiwify.com'&&u.pathname!=='/v1/oauth/token')throw new Error('Kiwify integration is read only');
 if(method!=='GET'&&u.hostname==='developers.hotmart.com')throw new Error('Hotmart integration is read only');
 const response=await fetcher(u,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok){const err=new Error([401,403].includes(response.status)?'token_revoked':response.status===429?'rate_limit':'provider_http_'+response.status);err.retryAfter=Number(response.headers.get('retry-after')||60);throw err;}
 return response.json();
}
export const checkoutAdapters={
 custom:{
  verifyRequest:async(req,c)=>constantEqual(req.headers.get('authorization'), 'Bearer '+c.token),
  normalizeEvent:normalizeCustom,capabilities:{version:'1',history:false},
  fetchOrder:async()=>{throw new Error('Custom API has no historical lookup')},listOrdersForReconciliation:async()=>{throw new Error('History not supported')}
 },
 hotmart:{
  verifyRequest:async(req,c)=>constantEqual(req.headers.get('x-hotmart-hottok'),c.hottok),
  normalizeEvent:normalizeHotmart,capabilities:{version:'2.0.0',history:true},
 },
 kiwify:{
  verifyRequest:async()=>true, // untrusted hint accepted only after a matching authorized sales lookup
  normalizeEvent:normalizeKiwify,capabilities:{version:'v1',history:true,authoritativeLookupRequired:true},
  fetchOrder:async(id,c,fetcher=fetch)=>providerFetch('https://public-api.kiwify.com/v1/sales/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+c.access_token,'x-kiwify-account-id':c.account_id}},fetcher),
  listOrdersForReconciliation:async(c,from,to,page=1,fetcher=fetch)=>providerFetch('https://public-api.kiwify.com/v1/sales?'+new URLSearchParams({...from?{start_date:from}:{},...to?{end_date:to}:{},page:String(page),page_size:'100'}),{headers:{Authorization:'Bearer '+c.access_token,'x-kiwify-account-id':c.account_id}},fetcher)
 }
};
export async function refreshKiwify(c,fetcher=fetch){
 if(!c.client_id||!c.client_secret)throw new Error('Credenciais Kiwify ausentes');
 const r=await providerFetch('https://public-api.kiwify.com/v1/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret})},fetcher);
 if(!r.access_token)throw new Error('Token Kiwify inválido');return {...c,access_token:r.access_token,token_expires_at:Date.now()+Number(r.expires_in||86400)*1000};
}
export async function metaEntities(c,account,fetcher=fetch){
 const out=[];for(const [endpoint,level,fields,parent] of [['campaigns','campaign','id,name,status',null],['adsets','group','id,name,status,campaign_id','campaign_id'],['ads','ad','id,name,status,adset_id','adset_id']]){
  let after;do{const qs=new URLSearchParams({fields,limit:'100'});if(after)qs.set('after',after);const r=await providerFetch('https://graph.facebook.com/'+c.version+'/'+account+'/'+endpoint+'?'+qs,{headers:{Authorization:'Bearer '+c.access_token}},fetcher);out.push(...(r.data||[]).map(e=>({entity_id:e.id,level,name:e.name,parent_id:parent?e[parent]:null,status:e.status==='ACTIVE'?'ACTIVE':'PAUSED'})));after=r.paging?.next?r.paging?.cursors?.after:null;}while(after);
 }return out;
}
export async function setMetaStatus(c,entity,status,fetcher=fetch){
 if(!/^\d+$/.test(entity)||!['ACTIVE','PAUSED'].includes(status))throw new Error('Estado de anúncio inválido');
 // Deliberately narrow mutation: caller verifies workspace/account ownership first.
 const response=await fetcher('https://graph.facebook.com/'+c.version+'/'+entity,{method:'POST',headers:{Authorization:'Bearer '+c.access_token,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({status}),redirect:'error',signal:AbortSignal.timeout(20000)});
 const result=await response.json();if(!response.ok||result.success!==true)throw new Error('A Meta recusou a alteração. Verifique a permissão ads_management da credencial.');return result;
}
// Hotmart official read-only Sales History API. Transaction lookup uses the documented transaction filter.
checkoutAdapters.hotmart.fetchOrder=async(id,c,fetcher=fetch)=>{
 const r=await checkoutAdapters.hotmart.listOrdersForReconciliation(c,null,null,null,fetcher,id);
 const sale=r.items?.find(x=>x.purchase?.transaction===id);if(!sale)throw new Error('Order not found');return sale;
};
checkoutAdapters.hotmart.listOrdersForReconciliation=async(c,from,to,page,fetcher=fetch,transaction,status)=>{
 const qs=new URLSearchParams();if(from)qs.set('start_date',String(new Date(from).getTime()));if(to)qs.set('end_date',String(new Date(to).getTime()+86400000-1));if(page)qs.set('page_token',page);if(transaction)qs.set('transaction',transaction);if(status)qs.set('transaction_status',status);
 return providerFetch('https://developers.hotmart.com/payments/api/v1/sales/history?'+qs,{headers:{Authorization:'Bearer '+c.access_token}},fetcher);
};
// Require official API base configured server-side; the documented host is developers.hotmart.com.
HOSTS.add('developers.hotmart.com');
checkoutAdapters.hotmart.fetchCommissions=async(id,status,c,fetcher=fetch)=>providerFetch('https://developers.hotmart.com/payments/api/v1/sales/commissions?'+new URLSearchParams({transaction:id,transaction_status:status,commission_as:c.recipientSource}),{headers:{Authorization:'Bearer '+c.access_token}},fetcher);
export async function oauthStart(provider,{clientId,redirectUri,state,version='v25.0',configId,allowManagement=false}) {
 const url=new URL(provider==='google'?'https://accounts.google.com/o/oauth2/v2/auth':'https://www.facebook.com/'+version+'/dialog/oauth');
 const args={client_id:clientId,redirect_uri:redirectUri,state,response_type:'code',scope:provider==='google'?'https://www.googleapis.com/auth/adwords':allowManagement?'ads_read,ads_management':'ads_read'};
 if(provider==='meta'&&configId){delete args.scope;args.config_id=configId;}
 if(provider==='google')Object.assign(args,{access_type:'offline',prompt:'consent'});
 url.search=new URLSearchParams(args);return url.href;
}
export async function exchangeOAuth(provider,c,code,fetcher=fetch) {
 const args={client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:c.redirectUri,code};
 if(provider==='google')return providerFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...args,grant_type:'authorization_code'})},fetcher);
 const post=params=>providerFetch('https://graph.facebook.com/'+c.version+'/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)},fetcher);
 const first=await post(args);if(!first.access_token)throw new Error('token_revoked');
 const long=await post({grant_type:'fb_exchange_token',client_id:c.clientId,client_secret:c.clientSecret,fb_exchange_token:first.access_token});
 if(!long.access_token)throw new Error('token_revoked');return {...long,token_expires_at:Date.now()+Number(long.expires_in||first.expires_in||3600)*1000};
}
export async function refreshGoogle(c,fetcher=fetch) {
 return providerFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,refresh_token:c.refresh_token,grant_type:'refresh_token'})},fetcher);
}
export async function listAccounts(provider,c,fetcher=fetch) {
 if(provider==='google'){
  const r=await providerFetch('https://googleads.googleapis.com/'+c.version+'/customers:listAccessibleCustomers',{headers:{Authorization:'Bearer '+c.access_token}},fetcher);
  return (r.resourceNames||[]).map(name=>({account_id:name.split('/').pop(),resource_name:name}));
 }
 const accounts=[];let after;
 do{
  const qs=new URLSearchParams({fields:'id,name,currency,timezone_name',limit:'100'});if(after)qs.set('after',after);
  const r=await providerFetch('https://graph.facebook.com/'+c.version+'/me/adaccounts?'+qs,{headers:{Authorization:'Bearer '+c.access_token}},fetcher);
  accounts.push(...(r.data||[]).map(x=>({...x,account_id:x.id})));after=r.paging?.next?r.paging.cursors?.after:null;
 }while(after);
 return accounts;
}
export async function syncMeta(c,account,from,to,fetcher=fetch) {
 const rows=[];let after;
 do{
  const qs=new URLSearchParams({fields:'account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions,action_values,date_start',level:'ad',time_increment:'1',time_range:JSON.stringify({since:from,until:to}),limit:'100',action_attribution_windows:JSON.stringify(['7d_click','1d_view'])});if(after)qs.set('after',after);
  const r=await providerFetch('https://graph.facebook.com/'+c.version+'/'+account.account_id+'/insights?'+qs,{headers:{Authorization:'Bearer '+c.access_token}},fetcher);
  rows.push(...(r.data||[]).map(x=>({entity_id:x.ad_id,campaign_id:x.campaign_id,campaign_name:x.campaign_name,group_id:x.adset_id,group_name:x.adset_name,name:x.ad_name,date:x.date_start,granularity:'ad',currency:account.currency,amount_scale:SCALES[account.currency],spend_minor:minor(x.spend,SCALES[account.currency]),impressions:Number(x.impressions||0),clicks:Number(x.clicks||0),network_purchases:Number(x.actions?.find(a=>a.action_type==='offsite_conversion.fb_pixel_purchase')?.value||0),network_purchase_value_minor:x.action_values?.find(a=>a.action_type==='offsite_conversion.fb_pixel_purchase')?minor(x.action_values.find(a=>a.action_type==='offsite_conversion.fb_pixel_purchase').value,SCALES[account.currency]):null})));
  after=r.paging?.next?r.paging.cursors?.after:null;
 }while(after);return rows;
}
export async function googleQuery(c,id,query,fetcher=fetch) {
 const all=[];let pageToken;
 do{
  const r=await providerFetch('https://googleads.googleapis.com/'+c.version+'/customers/'+id+'/googleAds:search',{method:'POST',headers:{Authorization:'Bearer '+c.access_token,'Content-Type':'application/json',...(c.login_customer_id?{'login-customer-id':c.login_customer_id}:{})},body:JSON.stringify({query,...(pageToken?{pageToken}:{})})},fetcher);
  all.push(...(r.results||[]));pageToken=r.nextPageToken;
 }while(pageToken);return all;
}
export async function listGoogleCustomerTree(c,fetcher=fetch) {
 const roots=await listAccounts('google',c,fetcher),queue=roots.map(a=>({...a,login_customer_id:null})),result=[],seen=new Set();
 while(queue.length&&seen.size<100){
  const account=queue.shift();if(seen.has(account.account_id))continue;seen.add(account.account_id);
  const config={...c,...(account.login_customer_id?{login_customer_id:account.login_customer_id}:{})};
  const rows=await googleQuery(config,account.account_id,'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1',fetcher);
  const row=rows[0]?.customer;if(!row)continue;
  const mapped={account_id:account.account_id,name:row.descriptiveName||account.account_id,currency:row.currencyCode,timezone:row.timeZone,manager:row.manager===true,login_customer_id:account.login_customer_id};
  result.push(mapped);
  if(mapped.manager){
   const children=await googleQuery({...config,login_customer_id:account.login_customer_id||account.account_id},account.account_id,'SELECT customer_client.id, customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level = 1',fetcher);
   for(const child of children)queue.push({account_id:String(child.customerClient.id),login_customer_id:account.login_customer_id||account.account_id});
  }
 }
 if(queue.length)throw new Error('Manager account traversal limit exceeded; select a smaller authorized scope');
 return result;
}
export async function syncGoogle(c,account,from,to,fetcher=fetch) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!/^\d+$/.test(account.account_id))throw new Error('Invalid Google query parameters');
 // Campaign granularity covers Performance Max without inventing ad identity.
 const rows=await googleQuery(c,account.account_id,"SELECT customer.currency_code, customer.time_zone, campaign.id, campaign.name, campaign.advertising_channel_type, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE segments.date BETWEEN '"+from+"' AND '"+to+"'",fetcher);
 const result=rows.map(x=>{const amountScale=SCALES[x.customer.currencyCode];if(amountScale==null)throw new Error('Unsupported account currency');const divisor=10n**BigInt(6-amountScale);return {entity_id:String(x.campaign.id),name:x.campaign.name,date:x.segments.date,granularity:'campaign',currency:x.customer.currencyCode,amount_scale:amountScale,spend_minor:Number((BigInt(x.metrics.costMicros||0)+divisor/2n)/divisor),impressions:Number(x.metrics.impressions||0),clicks:Number(x.metrics.clicks||0),network_purchases:null,network_purchase_value_minor:null,network_conversion_note:'No purchase conversion actions selected; reported by interaction date'};});
 const selected=c.selected_purchase_actions||[];
 if(selected.length){
  if(selected.some(id=>!/^customers\/\d+\/conversionActions\/\d+$/.test(id)))throw new Error('Invalid conversion action resource');
  const values=await googleQuery(c,account.account_id,"SELECT campaign.id, segments.date, segments.conversion_action, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '"+from+"' AND '"+to+"' AND segments.conversion_action IN ("+selected.map(id=>"'"+id+"'").join(',')+")",fetcher);
  for(const row of result){const mapped=values.filter(x=>String(x.campaign.id)===row.entity_id&&x.segments.date===row.date);row.network_purchases=mapped.reduce((sum,x)=>sum+Number(x.metrics.conversions||0),0);row.network_purchase_value_minor=mapped.reduce((sum,x)=>sum+Math.round(Number(x.metrics.conversionsValue||0)*10**row.amount_scale),0);row.network_conversion_note='Selected Purchase actions; network attribution by interaction date';}
 }
 return result;
}
export function utmTemplate(provider) {
 return provider==='meta'?'utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}':'utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={adgroupid}&utm_content={creative}';
}
export async function capiPayload(order,customer,destination) {
 if(!destination.enabled||!destination.test_event_code||!destination.authorized_test_pixel||!destination.coordinated_emitter||!destination.consent||order.status!=='paid'||!order.is_test)throw new Error('Test CAPI destination or consent not authorized');
 const data={};if(customer?.email)data.em=[await sha256(customer.email.trim().toLowerCase())];if(customer?.phone)data.ph=[await sha256(customer.phone.replace(/\D/g,''))];
 return {data:[{event_name:'Purchase',event_time:Math.floor(new Date(order.approved_at).getTime()/1000),event_id:'mm:'+order.id+':approved',action_source:'website',user_data:data,custom_data:{currency:order.currency,value:order.gross_minor/10**order.amount_scale}}],test_event_code:destination.test_event_code};
}
