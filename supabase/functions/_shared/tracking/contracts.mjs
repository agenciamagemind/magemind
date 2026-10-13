export const CHECKOUTS=Object.freeze({
 custom:{version:'1',authentication:'rotatable bearer credential',historical:false,states:['pending','paid','refused','cancelled','refunded','chargeback','disputed']},
 hotmart:{version:'2.0.0',authentication:'X-HOTMART-HOTTOK',historical:true,states:['pending','paid','refused','cancelled','refunded','chargeback','disputed']},
 kiwify:{version:'public-api-v1',authentication:'authenticated order lookup; webhook is only an untrusted hint',historical:true,states:['pending','paid','refused','cancelled','refunded','chargeback']}
});
export const FUTURE=['Stripe','Kirvano','Shopify','WooCommerce','TikTok'];
export const SCALES=Object.freeze({BRL:2,USD:2,EUR:2,JPY:0,KWD:3});
export function minor(value,scale=2) {
 if(typeof value==='number' && !Number.isFinite(value)) throw new Error('Invalid decimal');
 const match=String(value).match(/^([0-9]+)(?:\.([0-9]+))?$/);
 const fraction=(match?.[2]||'').replace(/0+$/,'');
 if(!match || fraction.length>scale) throw new Error('Invalid decimal precision');
 const result=BigInt(match[1])*10n**BigInt(scale)+BigInt(fraction.padEnd(scale,'0')||'0');
 if(result>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Money exceeds supported safe integer range');
 return Number(result);
}
export const timestamp=value=>{
 if(value==null) return null;
 const d=new Date(value); if(!Number.isFinite(+d)) throw new Error('Invalid timestamp');
 return d.toISOString();
};
const text=(value,max=200)=>value==null?null:String(value).slice(0,max);
const stripTracking=t=>Object.fromEntries(['mm_click_id','utm_source','utm_medium','utm_campaign','utm_term','utm_content','campaign_id','adset_id','ad_id','gclid','gbraid','wbraid','fbclid','src','sck','xcod','first_touch'].filter(k=>t?.[k]!=null).map(k=>[k,k==='first_touch'?stripTracking(t[k]):text(t[k],250)]));
export function bridgeClick(t) {
 const copy=stripTracking(t||{});
 for(const key of ['sck','xcod','src']) if(/^mm_[a-f0-9-]{36}$/i.test(copy[key]||'')) copy.mm_click_id=copy[key].slice(3);
 if(!copy.utm_source&&['whatsapp','email','organic','organico','orgânico'].includes(String(copy.src||'').toLowerCase()))copy.utm_source=String(copy.src).toLowerCase();
 return copy;
}
export function validateOrder(e) {
 if(e?.schema_version!=='1'||typeof e.event_id!=='string'||!e.event_id||e.event_id.length>200||typeof e.order_id!=='string'||!e.order_id||e.order_id.length>200) throw new Error('Invalid event/order identity');
 if(!CHECKOUTS.custom.states.includes(e.status)||SCALES[e.currency]!==e.amount_scale||e.is_test!==true) throw new Error('Invalid status/currency/test marker');
 for(const name of ['gross_amount_minor','gateway_fee_minor','recipient_revenue_minor','refunded_amount_minor','recipient_refunded_minor']) {
  if(e[name]!=null&&(!Number.isSafeInteger(e[name])||e[name]<0)) throw new Error('Invalid money: '+name);
 }
 if(e.gross_amount_minor==null||e.refunded_amount_minor==null||e.refunded_amount_minor>e.gross_amount_minor||e.recipient_revenue_minor>e.gross_amount_minor||e.gateway_fee_minor>e.gross_amount_minor||e.recipient_refunded_minor>e.recipient_revenue_minor) throw new Error('Inconsistent money');
 timestamp(e.created_at);timestamp(e.occurred_at);
 if(!e.created_at||!e.occurred_at||new Date(e.occurred_at)>new Date(Date.now()+300000)||new Date(e.created_at)>new Date(e.occurred_at)) throw new Error('Invalid chronology');
 if(e.status==='paid'&&!e.approved_at) throw new Error('Approval time required');
 if(e.approved_at&&(new Date(timestamp(e.approved_at))<new Date(e.created_at)||new Date(e.approved_at)>new Date(e.occurred_at))) throw new Error('Invalid approval time');
 if(!Array.isArray(e.items)||!e.items.length||e.items.length>100) throw new Error('Invalid items');
 for(const i of e.items) if(typeof i.external_product_id!=='string'||!i.external_product_id||typeof i.name!=='string'||i.name.length>200||!Number.isInteger(i.quantity)||i.quantity<1||!Number.isSafeInteger(i.amount_minor)||i.amount_minor<0) throw new Error('Invalid item');
 if(e.items.reduce((s,i)=>s+i.amount_minor,0)!==e.gross_amount_minor) throw new Error('Item totals must match order gross (line totals include bumps)');
 const customer=e.customer?{external_id:text(e.customer.external_id),identity_reliable:e.customer.identity_reliable!==false,name:text(e.customer.name),email:text(e.customer.email,254),phone:text(e.customer.phone,30)}:null;
 if(customer&&!customer.external_id) throw new Error('Customer requires provider identity; email is not a global ID');
 const safe=Object.fromEntries(['schema_version','event_id','order_id','status','currency','amount_scale','gross_amount_minor','gateway_fee_minor','recipient_revenue_minor','refunded_amount_minor','recipient_refunded_minor','renewal','root_order_id','payment_method','is_test','money_components'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]));
 safe.items=e.items.map(i=>({external_product_id:i.external_product_id,name:i.name,quantity:i.quantity,amount_minor:i.amount_minor}));
 if(safe.money_components)safe.money_components=Object.fromEntries(['recipient_native_minor','recipient_currency','recipient_scale','fee_native_minor','fee_currency','net_includes_gateway','timestamp_source'].filter(k=>['string','number','boolean'].includes(typeof safe.money_components[k])).map(k=>[k,safe.money_components[k]]));
 return {...safe,customer,tracking:bridgeClick(e.tracking),created_at:timestamp(e.created_at),occurred_at:timestamp(e.occurred_at),approved_at:timestamp(e.approved_at)};
}
export async function sha256(value) {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function constantEqual(a,b) {return typeof a==='string'&&typeof b==='string'&&a.length>0&&await sha256(a)===await sha256(b);}
export function normalizeHotmart(p,context) {
 if(typeof p.id!=='string'||!p.id)throw new Error('Hotmart event ID required');
 if(p.version!=='2.0.0') throw new Error('Only Hotmart webhook 2.0.0 supported');
 const purchase=p.data?.purchase, buyer=p.data?.buyer, product=p.data?.product;
 if(!purchase||!product) throw new Error('Invalid Hotmart payload');
 const states={PURCHASE_APPROVED:'paid',PURCHASE_COMPLETE:'paid',PURCHASE_BILLET_PRINTED:'pending',PURCHASE_DELAYED:'pending',PURCHASE_PROTEST:'disputed',PURCHASE_CANCELED:'cancelled',PURCHASE_REFUNDED:'refunded',PURCHASE_CHARGEBACK:'chargeback',PURCHASE_REJECTED:'refused'};
 const status=states[p.event];if(!status) throw new Error('Unsupported Hotmart event');
 const price=purchase.full_price||purchase.price;
 const currency=price.currency_value,scale=SCALES[currency];if(scale==null)throw new Error('Unsupported currency');
 const gross=minor(price.value,scale);
 const commission=(p.data.commissions||[]).find(x=>x.source===context.recipientSource&&x.currency_value===currency);
 const net=commission?minor(commission.value,scale):null;
 const isRefund=['refunded','chargeback'].includes(status);
 // No guess for partial-refund or multi-item formats: require reconciliation instead of fabricating values.
 if(purchase.refund_reason?.is_partial || purchase.refund?.is_partial)throw new Error('Partial refund requires authoritative cumulative amounts');
 return validateOrder({schema_version:'1',event_id:String(p.id),order_id:String(purchase.transaction),status,
 occurred_at:timestamp(p.creation_date),created_at:timestamp(purchase.order_date),approved_at:purchase.approved_date?timestamp(purchase.approved_date):status==='paid'?timestamp(p.creation_date):null,
 currency,amount_scale:scale,gross_amount_minor:gross,gateway_fee_minor:null,recipient_revenue_minor:net,
 refunded_amount_minor:isRefund?gross:0,recipient_refunded_minor:isRefund?net:null,
 customer:buyer?.ucode||buyer?.email?{external_id:String(buyer.ucode||purchase.transaction),identity_reliable:Boolean(buyer.ucode),name:buyer.name,email:buyer.email,phone:buyer.checkout_phone||null}:null,
 items:[{external_product_id:String(product.id),name:product.name,quantity:1,amount_minor:gross}],
 tracking:purchase.origin||{},payment_method:purchase.payment?.type,renewal:Number(purchase.recurrence_number||1)>1,
 root_order_id:purchase.parent_transaction||null,is_test:true});
}
export function normalizeKiwify(p,context) {
 if(context.authoritative!==true)throw new Error('Kiwify payment must be verified using authorized sales API');
 const statusMap={waiting_payment:'pending',paid:'paid',refused:'refused',refunded:'refunded',chargedback:'chargeback',chargeback:'chargeback',cancelled:'cancelled'};
 const status=statusMap[p.status||p.order_status];if(!status)throw new Error('Unsupported Kiwify status');
 const currency=p.payment?.charge_currency||p.currency||'BRL',scale=SCALES[currency],gross=p.payment?.charge_amount??p.amount??p.Commissions?.charge_amount;
 if(!Number.isSafeInteger(gross))throw new Error('Kiwify API amount must be minor units');
 const fee=p.payment?.fee_currency&&p.payment.fee_currency!==currency?null:p.payment?.fee??p.fee??p.Commissions?.kiwify_fee??null;
 // Revenue is from the configured recipient role, not consumer gross.
 const nativeNet=p.payment?.settlement_amount??p.net_amount??p.Commissions?.my_commission??null;
 const nativeCurrency=p.payment?.settlement_currency||p.currency||currency;
 const net=nativeCurrency===currency?nativeNet:null;
 const refund=p.refunded_amount??(['refunded','chargeback'].includes(status)?gross:0);
 return validateOrder({schema_version:'1',event_id:context.eventId,order_id:String(p.id||p.order_id),status,
 occurred_at:timestamp(p.updated_at||p.approved_date||p.created_at),created_at:timestamp(p.created_at),
 approved_at:p.approved_date?timestamp(p.approved_date):status==='paid'?timestamp(p.updated_at):null,currency,amount_scale:scale,
 gross_amount_minor:gross,gateway_fee_minor:fee,recipient_revenue_minor:net,refunded_amount_minor:refund,
 recipient_refunded_minor:p.recipient_refunded_amount??(refund===gross?net:null),
 customer:p.customer?.id?{external_id:String(p.customer.id),identity_reliable:true,name:p.customer.name,email:p.customer.email,phone:p.customer.mobile||null}:p.Customer?.email?{external_id:String(p.order_id),identity_reliable:false,name:p.Customer.full_name,email:p.Customer.email,phone:p.Customer.mobile}:null,
 items:[{external_product_id:String(p.product?.id||p.Product?.product_id),name:p.product?.name||p.Product?.product_name,quantity:1,amount_minor:gross}],
 tracking:p.tracking||p.TrackingParameters||{},payment_method:p.payment_method?.toUpperCase(),renewal:Number(p.subscription?.recurrence_number||1)>1,
 money_components:{recipient_native_minor:nativeNet,recipient_currency:nativeCurrency,recipient_scale:SCALES[nativeCurrency],fee_native_minor:p.payment?.fee??fee,fee_currency:p.payment?.fee_currency||currency,net_includes_gateway:true},is_test:true});
}
export function normalizeCustom(p) { return validateOrder(p); }
export function normalizeHotmartHistory(row,context,commissions=[]) {
 const p=row.purchase;if(!p||!row.product||!p.transaction)throw new Error('Invalid Hotmart sales history');
 const map={APPROVED:'paid',COMPLETE:'paid',PRINTED_BILLET:'pending',WAITING_PAYMENT:'pending',STARTED:'pending',PROCESSING_TRANSACTION:'pending',UNDER_ANALISYS:'pending',REFUNDED:'refunded',CHARGEBACK:'chargeback',CANCELLED:'cancelled',EXPIRED:'cancelled',NO_FUNDS:'refused',PROTESTED:'disputed',BLOCKED:'disputed',OVERDUE:'pending'};
 if(p.status==='PARTIALLY_REFUNDED')throw new Error('Partial refund requires authoritative cumulative refund amount');
 const status=map[p.status];if(!status)throw new Error('Unsupported Hotmart history status');
 const currency=p.price.currency_code,amountScale=SCALES[currency],gross=minor(p.price.value,amountScale);
 const matches=commissions.filter(c=>c.source===context.recipientSource&&(!context.recipientUserUcode||c.user?.ucode===context.recipientUserUcode));
 const recipient=matches.length===1?matches[0].commission:null;
 const nativeCurrency=recipient?.currency_value||currency,nativeNet=recipient?minor(recipient.value,SCALES[nativeCurrency]):null,net=nativeCurrency===currency?nativeNet:null;
 const fullRefund=['refunded','chargeback'].includes(status);
 const occurred=context.reconciledAt||new Date().toISOString();
 return validateOrder({schema_version:'1',event_id:'history-pending-id',order_id:String(p.transaction),status,currency,amount_scale:amountScale,
 created_at:timestamp(p.order_date),occurred_at:occurred,approved_at:timestamp(p.approved_date),
 gross_amount_minor:gross,gateway_fee_minor:p.hotmart_fee?.currency_code===currency?minor(p.hotmart_fee.total,amountScale):null,recipient_revenue_minor:net,
 refunded_amount_minor:fullRefund?gross:0,recipient_refunded_minor:fullRefund?net:null,
 customer:row.buyer?.ucode?{external_id:row.buyer.ucode,name:row.buyer.name,email:row.buyer.email,phone:null}:null,
 items:[{external_product_id:String(row.product.id),name:row.product.name,quantity:1,amount_minor:gross}],
 tracking:{src:p.tracking?.source,sck:p.tracking?.source_sck,xcod:p.tracking?.external_code},payment_method:p.payment?.method,
 renewal:Number(p.recurrency_number||1)>1,money_components:{recipient_native_minor:nativeNet,recipient_currency:nativeCurrency,recipient_scale:SCALES[nativeCurrency],net_includes_gateway:true,timestamp_source:'reconciliation_received_at'},is_test:true});
}
export async function reconciliationIdentity(e) {
 const copy={...e};delete copy.event_id;
 if(e.money_components?.timestamp_source==='reconciliation_received_at')delete copy.occurred_at;
 const fingerprint=await sha256(JSON.stringify(copy));
 return {...e,event_id:'reconcile:'+e.order_id+':'+fingerprint.slice(0,32),reconciliation_hash:fingerprint};
}
export function csvCell(value) {
 const str=String(value??'');const safe=/^[\s\u0000-\u001f]*[=+@-]/.test(str)?"'"+str:str;
 return '"'+safe.replaceAll('"','""')+'"';
}
export function publicError(error){return String(error?.message||error).replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,'[email]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,120);}
