import {minor,SCALES,validateOrder,normalizeHotmart,paymentMethod,sha256,constantEqual} from './contracts.mjs';
import {connector,webhookEndpoint} from './connectors.mjs';
export const canonicalJSON=value=>JSON.stringify(sort(value));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export async function verifyWebhook(provider,req,payload,secrets){
 connector(provider);const token=new URL(req.url).searchParams.get('ingress_key');
 if(!await constantEqual(token,secrets.ingressToken))return false;
 if(provider==='hotmart')return constantEqual(req.headers.get('x-hotmart-hottok'),secrets.hottok);
 if(provider==='perfectpay')return constantEqual(payload.token,secrets.token);
 if(provider==='kirvano')return constantEqual(req.headers.get('security-token')||req.headers.get('authorization')?.replace(/^Bearer /i,''),secrets.token);
 if(provider==='cakto'){
  if(!await constantEqual(payload.secret,secrets.secret))return false;
  const signature=req.headers.get('x-cakto-signature'),time=req.headers.get('x-cakto-timestamp');
  if(signature||time){if(!/^\d+$/.test(time||'')||Math.abs(Date.now()/1000-Number(time))>300)return false;return constantEqual(signature,'v1='+await hmac(secrets.secret,time+'.'+await req.text(),'hex'));}
 }
 if(provider==='yampi')return constantEqual(req.headers.get('x-yampi-hmac-sha256'),await hmac(secrets.secret,await req.text(),'base64'));
 return true;
}
async function hmac(secret,raw,format){
 if(!secret)throw new Error('Webhook secret required');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)));
 return format==='base64'?btoa(String.fromCharCode(...bytes)):Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
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
function base(c,order,status,cur,gross){if(order==null||!String(order).trim())throw new Error('Order ID required');return {schema_version:'1',event_id:c.eventId,order_id:String(order),status,currency:cur,amount_scale:SCALES[cur],gross_amount_minor:gross,gateway_fee_minor:null,recipient_revenue_minor:null,refunded_amount_minor:0,recipient_refunded_minor:null,is_test:false};}
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
  items:[{external_product_id:String(p.Product?.product_id||''),name:String(p.Product?.product_name||'Produto'),quantity:1,amount_minor:gross}],tracking:p.TrackingParameters||{},payment_method:p.payment_method,installments:p.installments??p.card_installments,renewal:Number(p.Subscription?.recurrence_number||p.subscription?.recurrence_number||1)>1,
  money_components:{...times.money_components,recipient_native_minor:nativeNet,recipient_currency:settlementCurrency,recipient_scale:SCALES[settlementCurrency],fee_native_minor:asMinor(commission.kiwify_fee),fee_currency:feeCurrency,net_includes_gateway:true}});
}
export function normalizePerfectPay(p,c){
 const states={0:'pending',1:'pending',2:'paid',3:'pending',4:'disputed',5:'refused',6:'cancelled',7:'refunded',8:'pending',9:'chargeback',10:'paid',11:'refused',13:'cancelled',16:'pending'},status=states[p.sale_status_enum];if(!status)return null;
 if(Number(p.currency_enum)!==1)throw new Error('Unsupported PerfectPay currency');
 const cur='BRL',gross=minor(p.sale_amount),commissions=p.commission||[],owner=commissions.filter(x=>x.affiliation_code===p.webhook_owner),role={PRODUCER:1,COPRODUCER:2,AFFILIATE:5}[c.recipientSource||'PRODUCER'],candidates=owner.length===1?owner:commissions.filter(x=>x.affiliation_type_enum===role);
 const net=candidates.length===1?netWithin(minor(candidates[0].commission_amount),gross):null;
 const platform=commissions.find(x=>Number(x.affiliation_type_enum)===0&&x.commission_amount!=null);
 const fee=platform?netWithin(minor(platform.commission_amount),gross):null;
 const explicitMethod=paymentMethod(p.payment_type)||paymentMethod(p.payment_method);
 const type=explicitMethod==='PIX'?'PIX':({1:'CREDIT_CARD',2:'BOLETO',3:'PAYPAL',4:'CREDIT_CARD',6:'CREDIT_CARD'})[p.payment_type_enum]||explicitMethod||'OTHER';
 const times=chronology(p,c,p.date_created,p.date_approved,p.date_updated||p.updated_at,status),refund=['refunded','chargeback'].includes(status)?gross:0;
 if(p.partial_refund===true)throw new Error('Partial refund requires cumulative refund amount');
 return validateOrder({...base(c,p.code,status,cur,gross),...times,gateway_fee_minor:fee,recipient_revenue_minor:net,refunded_amount_minor:refund,recipient_refunded_minor:refund?net:null,
  customer:customer(p.code,p.customer?.full_name,p.customer?.email,[p.customer?.phone_area_code,p.customer?.phone_number].filter(Boolean).join('')),
  items:[{external_product_id:String(p.product?.code||''),name:String(p.product?.name||'Produto'),quantity:Number(p.quantity||p.plan?.quantity||1),amount_minor:gross}],tracking:p.metadata||{},payment_method:type,installments:p.installments,renewal:Number(p.payment_type_enum)===4,money_components:{...times.money_components,net_includes_gateway:true}});
}
const cartpandaOrder = payload => payload.order || payload.data?.order || payload;

function confirmedCartpandaAppmaxPayment(order) {
 const payment = order.payment;
 const transactionId = String(order.payment_gateway_id ?? '');
 return ['0','false'].includes(String(order.test).toLowerCase())
  && order.shop?.cartxpayments_mode === 'production'
  && order.source_name === 'checkout'
  && order.payment_gateway === 'appmax' && payment?.gateway === 'appmax'
  && /^[1-9][0-9]*$/.test(transactionId) && String(payment.appmax_payment_id) === transactionId
  && String(payment.order_id) === String(order.id)
  && (Number(payment.status_id) === 3 || Number(order.status_id) === 5 || Number(order.chargeback_received) === 1);
}

function webhookTestStatus(provider, payload) {
 const flagged = value => ['1','true'].includes(String(value).toLowerCase());
 const order = provider === 'cartpanda' ? cartpandaOrder(payload) : payload.order;
 if ([payload.is_test, payload.test, order?.is_test, order?.test].some(flagged)) return 'test';
 if (provider !== 'cartpanda') return 'live';
 if ([order.shop?.cartxpayments_mode, order.payment?.mode].some(mode => /^(sandbox|test)$/i.test(mode ?? ''))
  || flagged(order.payment?.is_test) || flagged(order.payment?.test)) return 'test';
 // The legacy flag also appears on real Appmax checkouts. Some webhooks omit
 // the payment data the authenticated orders API provides for verification.
 if ([payload.is_cartx_test, order.is_cartx_test].some(flagged) && !confirmedCartpandaAppmaxPayment(order)) return 'unverified';
 return 'live';
}

export function isSyntheticWebhook(provider, payload) {
 return webhookTestStatus(provider, payload) !== 'live';
}

export function cartpandaWebhookNeedsConfirmation(payload) {
 return webhookTestStatus('cartpanda', payload) === 'unverified' &&
  /^[1-9][0-9]*$/.test(String(cartpandaOrder(payload).id ?? ''));
}

export function normalizeCartpanda(payload,c){
 const p=cartpandaOrder(payload),cur=currency(p.currency),gross=asMinor(p.unformatted_total_price)??decimal(p.total_price,cur);
 const label=String(p.status_id||'').toLowerCase().replaceAll('_',' ');
 if(Number(p.status_id)===6||label==='partial refund'||p.financial_status==='partially_refunded')throw new Error('Partial refund requires cumulative refund amount');
 const status=Number(p.chargeback_received)===1?'chargeback':Number(p.status_id)===5||label==='refund'||p.financial_status==='refunded'?'refunded':Number(p.payment_status)===3||p.financial_status==='paid'?'paid':Number(p.payment_status)===4||label==='canceled'||p.cancelled_at?'cancelled':'pending';
 if(!Array.isArray(p.line_items)||!p.line_items.length)throw new Error('Cartpanda line items required');
 const paymentApproved = status === 'paid' && confirmedCartpandaAppmaxPayment(p) ? p.payment.updated_at : null;
 const times=chronology(p,c,p.created_at,p.paid_at||p.approved_at||paymentApproved||(['paid','refunded','chargeback'].includes(status)?p.processed_at:null),p.updated_at,status);
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
  customer:customer(p.customer?.id||p.customer_id||p.id,p.customer?.full_name||[p.customer?.first_name,p.customer?.last_name].filter(Boolean).join(' '),p.customer?.email||p.email,p.customer?.phone||p.phone,Boolean(p.customer?.id||p.customer_id)),items,tracking,payment_method:p.payment_type,installments:p.installments??p.no_of_installments??p.payment?.installments??p.payment_details?.installments,money_components:{...times.money_components,net_includes_gateway:false,manual_fees:c.manual_fees===true,item_amounts_allocated:true}});
}
function allocatedItems(rows,gross,read){
 if(!Array.isArray(rows)||!rows.length||rows.length>100)throw new Error('Order items required');
 const items=rows.map(read);for(const r of items)if(!r.external_product_id||!Number.isInteger(r.quantity)||r.quantity<1||!Number.isSafeInteger(r.weight)||r.weight<0)throw new Error('Invalid provider item');
 const total=items.reduce((n,r)=>n+r.weight,0),units=items.reduce((n,r)=>n+r.quantity,0);let rest=gross;
 return items.map((r,i)=>{const amount=i===items.length-1?rest:Math.floor(gross*(total?r.weight:r.quantity)/(total||units));rest-=amount;return {external_product_id:r.external_product_id,name:String(r.name||'Produto').slice(0,200),quantity:r.quantity,amount_minor:amount};});
}
const real=v=>decimal(String(v).replace(/^R\$\s*/,''),'BRL');
const stamp=v=>v&&typeof v==='object'?String(v.date||'').replace(/\.\d+$/,''):v;
const method=v=>({credit_card:'CREDIT_CARD',threeDs:'CREDIT_CARD',debit_card:'DEBIT_CARD',pix_auto:'PIX',bank_slip:'BOLETO'}[v]||String(v||'OTHER').toUpperCase());
function manualNet(c,gross){return c.manual_fees===true?gross:null;}
export function normalizeKirvano(p,c){
 const status=({BANK_SLIP_GENERATED:'pending',PIX_GENERATED:'pending',SALE_APPROVED:'paid',SALE_REFUSED:'refused',SALE_CANCELED:'cancelled',SALE_CANCELLED:'cancelled',SALE_REFUNDED:'refunded',SALE_CHARGEBACK:'chargeback'})[p.event];if(!status)return null;
 const gross=real(p.total_price),refund=['refunded','chargeback'].includes(status)?gross:0;
 if(p.partial_refund===true)throw new Error('Partial refund requires cumulative refund amount');
 const times=chronology(p,c,p.created_at,p.payment?.finished_at,p.updated_at||p.refunded_at||p.canceled_at,status),net=manualNet(c,gross);
 const items=allocatedItems(p.products,gross,r=>({external_product_id:String(r.id||''),name:r.name,quantity:Number(r.quantity||1),weight:real(r.price)*Number(r.quantity||1)}));
 return validateOrder({...base(c,p.sale_id,status,'BRL',gross),...times,recipient_revenue_minor:net,refunded_amount_minor:refund,recipient_refunded_minor:refund?net:null,customer:customer(p.customer?.id||p.sale_id,p.customer?.name,p.customer?.email,p.customer?.phone_number,Boolean(p.customer?.id)),items,tracking:p.utm||{},payment_method:method(p.payment?.method||p.payment_method),installments:p.payment?.installments,renewal:Number(p.plan?.recurrence_number||p.recurrence_number||1)>1,money_components:{...times.money_components,manual_fees:c.manual_fees===true,net_includes_gateway:false,item_amounts_allocated:true}});
}
export function normalizeCakto(p,c){
 const r=p.data;if(!r||Array.isArray(r))throw new Error('Cakto order required');
 const status=({purchase_approved:'paid',purchase_refused:'refused',pix_generated:'pending',boleto_generated:'pending',purchase_canceled:'cancelled',purchase_cancelled:'cancelled',refund:'refunded',chargeback:r.status==='chargedback'?'chargeback':'disputed'})[p.event];if(!status)return null;
 const cur=currency(r.currency||r.offer?.currency||'BRL'),gross=decimal(r.amount,cur),role={PRODUCER:'producer',AFFILIATE:'affiliate',COPRODUCER:'coproducer'}[c.recipientSource];
 const commissions=(r.commissions||[]).filter(x=>String(x.user||'').toLowerCase()===String(c.recipient_email||'').toLowerCase()&&x.type===role);
 const net=commissions.length===1?netWithin(decimal(commissions[0].totalAmount,cur),gross):null;
 const fee=r.fees==null?null:netWithin(decimal(r.fees,cur),gross),refund=['refunded','chargeback'].includes(status)?gross:0;
 if(r.partial_refund===true)throw new Error('Partial refund requires cumulative refund amount');
 const times=chronology(r,c,r.createdAt,r.paidAt,r.updatedAt||r.refundedAt||r.chargedbackAt||r.canceledAt,status);
 return validateOrder({...base(c,r.id,status,cur,gross),...times,gateway_fee_minor:fee,recipient_revenue_minor:net,refunded_amount_minor:refund,recipient_refunded_minor:refund?net:null,customer:customer(r.customer?.id||r.id,r.customer?.name,r.customer?.email,r.customer?.phone,Boolean(r.customer?.id)),items:[{external_product_id:String(r.product?.id||''),name:String(r.product?.name||'Produto').slice(0,200),quantity:1,amount_minor:gross}],tracking:r,payment_method:method(r.paymentMethod),installments:r.installments,renewal:Number(r.subscription_period||1)>1,money_components:{...times.money_components,net_includes_gateway:true}});
}
export function normalizeYampi(p,c){
 if(!['order.created','order.updated','order.paid','order.status.updated'].includes(p.event))return null;
 const r=p.resource;if(!r||!r.id)throw new Error('Yampi order required');
 const tx=r.transactions?.data||[],alias=r.status?.data?.alias;
 const states={waiting_payment:'pending',pending:'pending',authorized:'pending',paid:'paid',cancelled:'cancelled',canceled:'cancelled',refused:'refused',refunded:'refunded',chargeback:'chargeback'};
 const status=p.event==='order.paid'?'paid':states[alias]||(['handling_products','invoiced','shipped','delivered'].includes(alias)&&tx.some(x=>x.captured||x.status==='paid')?'paid':null);if(!status)return null;
 const gross=real(r.value_total),net=manualNet(c,gross),refund=['refunded','chargeback'].includes(status)?gross:0;
 if(r.partial_refund===true)throw new Error('Partial refund requires cumulative refund amount');
 const paid=tx.find(x=>x.captured||x.status==='paid'),times=chronology(r,c,stamp(r.created_at),stamp(r.paid_at)||stamp(paid?.created_at),stamp(r.updated_at)||p.time,status);
 const items=allocatedItems(r.items?.data,gross,i=>({external_product_id:String(i.product_id||i.sku?.data?.product_id||i.sku_id||''),name:i.sku?.data?.title||i.name,quantity:Number(i.quantity),weight:real(i.price)*Number(i.quantity)}));
 const buyer=r.customer?.data,payment=paid||tx[0];
 return validateOrder({...base(c,r.id,status,'BRL',gross),...times,recipient_revenue_minor:net,refunded_amount_minor:refund,recipient_refunded_minor:refund?net:null,customer:customer(buyer?.id||r.customer_id||r.id,buyer?.name,buyer?.email,buyer?.phone?.full_number,Boolean(buyer?.id||r.customer_id)),items,tracking:r.utm||r.tracking?.data||r.metadata?.data?.reduce((o,x)=>(o[x.key]=x.value,o),{})||{},payment_method:method(payment?.payment?.data?.alias||r.payments?.[0]?.alias),installments:payment?.installments??r.installments,money_components:{...times.money_components,manual_fees:c.manual_fees===true,net_includes_gateway:false,item_amounts_allocated:true}});
}
export function normalizeAppmax(p,c){
 if(p.event_type&&p.event_type!=='order')return null;
 const status=({order_approved:'paid',order_paid:'paid',order_paid_by_pix:'paid',order_pending_integration:'paid',order_integrated:'paid',order_authorized:'pending',order_billet_created:'pending',order_pix_created:'pending',order_refund:'refunded',order_pix_expired:'cancelled',order_billet_overdue:'cancelled',order_refused_by_risk:'refused',order_chargeback_in_treatment:'disputed'})[p.event];
 if(p.event==='order_partial_refund')throw new Error('Partial refund requires cumulative refund amount');if(!status)return null;
 const r=p.data;if(!r||!r.order_id)throw new Error('Appmax order required');
 const gross=real(r.total),nativeNet=r.merchant_total==null?null:netWithin(real(r.merchant_total),gross),net=nativeNet??manualNet(c,gross),refund=status==='refunded'?gross:0;
 const times=chronology(r,c,r.created_at,r.paid_at,r.updated_at||r.refund_at||r.paid_at,status);
 const items=allocatedItems(r.products,gross,i=>({external_product_id:String(i.sku||i.id||''),name:i.name,quantity:Number(i.quantity),weight:real(i.price)*Number(i.quantity)}));
 const buyer=r.customer;return validateOrder({...base(c,r.order_id,status,'BRL',gross),...times,recipient_revenue_minor:net,refunded_amount_minor:refund,recipient_refunded_minor:refund?net:null,customer:customer(buyer?.id||r.order_id,buyer?.name,buyer?.email,buyer?.phone,Boolean(buyer?.id)),items,tracking:r.utm||{},payment_method:r.payment_info?.pix||p.event==='order_paid_by_pix'?'PIX':r.payment_info?.boleto?'BOLETO':r.payment_info?.credit_card?'CREDIT_CARD':'OTHER',installments:r.payment_info?.credit_card?.installments,money_components:{...times.money_components,manual_fees:nativeNet==null&&c.manual_fees===true,net_includes_gateway:nativeNet!=null,item_amounts_allocated:true}});
}
export async function normalizeWebhook(provider,payload,context){
 if(isSyntheticWebhook(provider,payload))throw new Error('Synthetic events are unavailable');
 const c={recipientSource:'PRODUCER',timezone:'America/Sao_Paulo',...context,eventId:provider+':'+await sha256(canonicalJSON(payload)),isTest:false};
 if(provider==='hotmart')return String(payload.event||'').startsWith('PURCHASE_')?normalizeHotmart(payload,c):null;
 if(provider==='kiwify')return normalizeKiwifyWebhook(payload,c);
 if(provider==='perfectpay')return normalizePerfectPay(payload,c);
 if(provider==='cartpanda')return normalizeCartpanda(payload,c);
 if(provider==='kirvano')return normalizeKirvano(payload,c);
 if(provider==='cakto'){
  if(Array.isArray(payload.data)){if(!payload.data.length||payload.data.length>100)throw new Error('Invalid Cakto batch');return (await Promise.all(payload.data.map(async data=>normalizeCakto({...payload,data},{...c,eventId:'cakto:'+await sha256(canonicalJSON({event:payload.event,data}))})))).filter(Boolean);}
  return normalizeCakto(payload,{...c,eventId:'cakto:'+await sha256(canonicalJSON({event:payload.event,data:payload.data}))});
 }
 if(provider==='yampi')return normalizeYampi(payload,c);
 if(provider==='appmax')return normalizeAppmax(payload,c);
 throw new Error('Provider unsupported');
}
