import {minor,SCALES,validateOrder,normalizeHotmart,sha256,constantEqual} from './contracts.mjs';
import {connector,webhookEndpoint} from './connectors.mjs';
export const canonicalJSON=value=>JSON.stringify(sort(value));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export async function verifyWebhook(provider,req,payload,secrets){
 connector(provider);const token=new URL(req.url).searchParams.get('ingress_key');
 if(!await constantEqual(token,secrets.ingressToken))return false;
 if(provider==='hotmart')return constantEqual(req.headers.get('x-hotmart-hottok'),secrets.hottok);
 if(provider==='perfectpay')return constantEqual(payload.token,secrets.token);
 return true;
}
export {webhookEndpoint};
export function providerTime(value,zone='America/Sao_Paulo'){
 if(value==null||value==='')return null;
 if(typeof value==='number'||/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)){const d=new Date(value);if(!Number.isFinite(+d))throw new Error('Invalid provider timestamp');return d.toISOString();}
 const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);if(!match)throw new Error('Invalid provider local timestamp');
 const parts=match.slice(1).map(Number),target=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]||0);let instant=target;
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let n=0;n<3;n++){const p=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(x=>[x.type,x.value]));const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);const adjustment=target-local;if(!adjustment)return new Date(instant).toISOString();instant+=adjustment;}
 throw new Error('Ambiguous provider timestamp');
}
const asMinor=value=>Number.isSafeInteger(Number(value))&&/^\d+$/.test(String(value))?Number(value):null;
const netWithin=(n,gross)=>Number.isSafeInteger(n)&&n>=0&&n<=gross?n:null;
function currency(value){const c=value==='R$'?'BRL':value;if(SCALES[c]==null)throw new Error('Unsupported currency');return c;}
function decimal(value,cur){const text=String(value);return minor(text.includes(',')?text.replaceAll('.','').replace(',','.'):text,SCALES[cur]);}
function customer(id,name,email,phone,reliable=false){return id?{external_id:String(id),identity_reliable:reliable,name:name||null,email:email||null,phone:phone||null}:null;}
function chronology(p,c,created,approved,updated,status){
 const createdAt=providerTime(created,c.timezone),approvedAt=providerTime(approved,c.timezone);
 const source=updated?providerTime(updated,c.timezone):status==='paid'&&approvedAt?approvedAt:c.receivedAt;
 if(!createdAt||!source)throw new Error('Provider timestamps required');
 return {created_at:createdAt,approved_at:approvedAt||(['paid','refunded','chargeback','disputed'].includes(status)?source:null),occurred_at:source,money_components:{timestamp_source:updated||status==='paid'&&approvedAt?'provider':'received_at'}};
}
function base(c,order,status,cur,gross){return {schema_version:'1',event_id:c.eventId,order_id:String(order),status,currency:cur,amount_scale:SCALES[cur],gross_amount_minor:gross,gateway_fee_minor:null,recipient_revenue_minor:null,refunded_amount_minor:0,recipient_refunded_minor:null,is_test:false};}
function kiwifyChronology(p,c,status){
 const times=chronology(p,{...c,timezone:'UTC'},p.created_at,p.approved_date||p.approved_at,p.updated_at,status);
 if(!['paid','refunded','chargeback','disputed'].includes(status)||!times.approved_at)return times;
 const received=providerTime(c.receivedAt,'UTC'),approval=Date.parse(times.approved_at);
 if(received&&p.updated_at&&Date.parse(times.occurred_at)>Date.parse(received)+300000)throw new Error('Invalid chronology');
 // Kiwify's test sender supplies tomorrow's approval with today's update.
 // An authenticated financial status remains useful when its approval date is
 // inconsistent. Use the durable first-received clock, retaining provenance;
 // never move revenue into the future or relax the canonical money/date guards.
 if(received&&(approval>Date.parse(received)+300000||approval<Date.parse(times.created_at))){
  return {...times,approved_at:received,occurred_at:received,money_components:{timestamp_source:'received_at_invalid_approval',provider_approved_at:times.approved_at,provider_updated_at:providerTime(p.updated_at,'UTC')||'',timestamp_reason:'approval_outside_valid_range'}};
 }
 // Providers may update this field before writing the approval timestamp.
 if(approval>Date.parse(times.occurred_at))times.occurred_at=times.approved_at;
 return times;
}
export function normalizeKiwifyWebhook(p,c){
 const states={waiting_payment:'pending',paid:'paid',refused:'refused',refunded:'refunded',chargedback:'chargeback',chargeback:'chargeback',cancelled:'cancelled'};
 const hints={order_approved:'paid',order_refunded:'refunded',order_chargeback:'chargeback',order_rejected:'refused',order_paid:'paid',billet_created:'pending',pix_created:'pending'};
 const status=states[p.order_status||p.status]||hints[p.webhook_event_type];if(!status)return null;
 const commission=p.Commissions||{},cur=currency(commission.currency||p.currency||'BRL'),gross=asMinor(commission.charge_amount);if(gross==null)throw new Error('Kiwify charge_amount must be minor units');
 const settlementCurrency=commission.settlement_amount_currency||cur,nativeNet=asMinor(commission.settlement_amount??commission.my_commission),net=settlementCurrency===cur?netWithin(nativeNet,gross):null;
 const feeCurrency=commission.kiwify_fee_currency||cur,fee=feeCurrency===cur?netWithin(asMinor(commission.kiwify_fee),gross):null;
 const refund=['refunded','chargeback'].includes(status)?asMinor(p.refunded_amount)??gross:0;if(p.refund_type==='partial'&&asMinor(p.refunded_amount)==null)throw new Error('Partial refund amount required');
 // The Kiwify delivery observed at the provider uses UTC without an offset.
 // Convert at the boundary; the operation displays it in its own timezone.
 const times=kiwifyChronology(p,c,status);
 return validateOrder({...base(c,p.order_id||p.id,status,cur,gross),...times,gateway_fee_minor:fee,recipient_revenue_minor:net,refunded_amount_minor:refund,recipient_refunded_minor:refund===gross?net:null,
  customer:customer(p.Customer?.id||p.order_id,p.Customer?.full_name,p.Customer?.email,p.Customer?.mobile,Boolean(p.Customer?.id)),
  items:[{external_product_id:String(p.Product?.product_id||''),name:String(p.Product?.product_name||'Produto'),quantity:1,amount_minor:gross}],tracking:p.TrackingParameters||{},payment_method:p.payment_method?.toUpperCase(),renewal:Number(p.Subscription?.recurrence_number||p.subscription?.recurrence_number||1)>1,
  money_components:{...times.money_components,recipient_native_minor:nativeNet,recipient_currency:settlementCurrency,recipient_scale:SCALES[settlementCurrency],fee_native_minor:asMinor(commission.kiwify_fee),fee_currency:feeCurrency,net_includes_gateway:true}});
}
export function normalizePerfectPay(p,c){
 const states={0:'pending',1:'pending',2:'paid',3:'pending',4:'disputed',5:'refused',6:'cancelled',7:'refunded',8:'pending',9:'chargeback',10:'paid',11:'refused',13:'cancelled',16:'pending'},status=states[p.sale_status_enum];if(!status)return null;
 if(Number(p.currency_enum)!==1)throw new Error('Unsupported PerfectPay currency');
 const cur='BRL',gross=minor(p.sale_amount),commissions=p.commission||[],owner=commissions.filter(x=>x.affiliation_code===p.webhook_owner),role={PRODUCER:1,COPRODUCER:2,AFFILIATE:5}[c.recipientSource||'PRODUCER'],candidates=owner.length===1?owner:commissions.filter(x=>x.affiliation_type_enum===role);
 const net=candidates.length===1?netWithin(minor(candidates[0].commission_amount),gross):null;
 const times=chronology(p,c,p.date_created,p.date_approved,p.date_updated||p.updated_at,status),refund=['refunded','chargeback'].includes(status)?gross:0;
 if(p.partial_refund===true)throw new Error('Partial refund requires cumulative refund amount');
 return validateOrder({...base(c,p.code,status,cur,gross),...times,recipient_revenue_minor:net,refunded_amount_minor:refund,recipient_refunded_minor:refund?net:null,
  customer:customer(p.code,p.customer?.full_name,p.customer?.email,[p.customer?.phone_area_code,p.customer?.phone_number].filter(Boolean).join('')),
  items:[{external_product_id:String(p.product?.code||''),name:String(p.product?.name||'Produto'),quantity:Number(p.quantity||p.plan?.quantity||1),amount_minor:gross}],tracking:p.metadata||{},payment_method:({1:'CREDIT_CARD',2:'BOLETO',3:'PAYPAL',4:'CREDIT_CARD',6:'CREDIT_CARD'})[p.payment_type_enum]||'OTHER',renewal:p.payment_type_enum===4,money_components:{...times.money_components,net_includes_gateway:true}});
}
export function normalizeCartpanda(payload,c){
 const p=payload.order||payload.data?.order||payload,cur=currency(p.currency),gross=asMinor(p.unformatted_total_price)??decimal(p.total_price,cur);
 const label=String(p.status_id||'').toLowerCase().replaceAll('_',' ');
 if(Number(p.status_id)===6||label==='partial refund'||p.financial_status==='partially_refunded')throw new Error('Partial refund requires cumulative refund amount');
 const status=Number(p.chargeback_received)===1?'chargeback':Number(p.status_id)===5||label==='refund'||p.financial_status==='refunded'?'refunded':Number(p.payment_status)===3||p.financial_status==='paid'?'paid':Number(p.payment_status)===4||label==='canceled'||p.cancelled_at?'cancelled':'pending';
 if(!Array.isArray(p.line_items)||!p.line_items.length)throw new Error('Cartpanda line items required');
 const times=chronology(p,c,p.created_at,p.paid_at||p.approved_at||(['paid','refunded','chargeback'].includes(status)?p.processed_at:null),p.updated_at,status);
 const weights=p.line_items.map(i=>{try{return decimal(i.price,cur)*Number(i.quantity);}catch{return 0;}}),total=weights.reduce((n,v)=>n+v,0),fallback=total===0,denominator=fallback?p.line_items.reduce((n,i)=>n+Number(i.quantity),0):total;
 if(denominator<=0)throw new Error('Invalid Cartpanda item quantities');
 let remaining=gross;
 const items=p.line_items.map((i,n)=>{const amount=n===p.line_items.length-1?remaining:Math.floor(gross*(fallback?Number(i.quantity):weights[n])/denominator);remaining-=amount;return {external_product_id:String(i.product_id||''),name:String(i.name||i.title||'Produto').slice(0,200),quantity:Number(i.quantity),amount_minor:amount};});
 const refund=['refunded','chargeback'].includes(status)?gross:0;
 // Store-owner gross is an explicit choice; gateway and product costs are
 // configured separately and the UI labels this result as an estimate.
 const net=c.manual_fees===true?gross:null;
 let tracking={};try{tracking=Object.fromEntries(new URL(p.landing_site).searchParams);}catch{}
 for(const a of Array.isArray(p.note_attributes)?p.note_attributes:[])if(a?.name&&a.value!=null)tracking[a.name]=a.value;
 return validateOrder({...base(c,p.id,status,cur,gross),...times,recipient_revenue_minor:net,refunded_amount_minor:refund,recipient_refunded_minor:refund?net:null,
  customer:customer(p.customer?.id||p.customer_id||p.id,p.customer?.full_name||[p.customer?.first_name,p.customer?.last_name].filter(Boolean).join(' '),p.customer?.email||p.email,p.customer?.phone||p.phone,Boolean(p.customer?.id||p.customer_id)),items,tracking,payment_method:p.payment_type==='cc'?'CREDIT_CARD':p.payment_type==='boleto'?'BOLETO':p.payment_type?.toUpperCase(),money_components:{...times.money_components,net_includes_gateway:false,manual_fees:c.manual_fees===true,item_amounts_allocated:true}});
}
export async function normalizeWebhook(provider,payload,context){
 if([payload.is_test,payload.test,payload.order?.test,payload.is_cartx_test,payload.order?.is_cartx_test].some(x=>['1','true'].includes(String(x).toLowerCase())))throw new Error('Synthetic events are unavailable');
 const c={recipientSource:'PRODUCER',timezone:'America/Sao_Paulo',...context,eventId:provider+':'+await sha256(canonicalJSON(payload)),isTest:false};
 if(provider==='hotmart')return String(payload.event||'').startsWith('PURCHASE_')?normalizeHotmart(payload,c):null;
 if(provider==='kiwify')return normalizeKiwifyWebhook(payload,c);
 if(provider==='perfectpay')return normalizePerfectPay(payload,c);
 if(provider==='cartpanda')return normalizeCartpanda(payload,c);
 throw new Error('Provider unsupported');
}
