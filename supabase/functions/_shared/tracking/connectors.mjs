// Provider-specific setup contracts. Only documented, implemented connectors
// are enabled; adding a name here alone never enables financial ingestion.
export const webhookConnectors=Object.freeze({
 kiwify:{name:'Kiwify',category:'checkout',auth:'private_url',docs:'https://ajuda.kiwify.com.br/pt-br/article/como-funcionam-os-webhooks-2ydtgl/',fields:[],events:['Compra aprovada','Compra recusada','Boleto/Pix gerado','Reembolso','Chargeback'],instructions:'Na Kiwify, abra Apps → Webhooks → Criar webhook. Cole a URL privada, selecione os produtos e os eventos de pedidos, aprovação, recusa, reembolso e chargeback.'},
 hotmart:{name:'Hotmart',category:'checkout',auth:'hottok',docs:'https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/purchase-webhook/',fields:[{name:'hottok',label:'Token do webhook (Hottok)',type:'password',required:true}],events:['PURCHASE_APPROVED','PURCHASE_COMPLETE','PURCHASE_BILLET_PRINTED','PURCHASE_DELAYED','PURCHASE_REJECTED','PURCHASE_CANCELED','PURCHASE_REFUNDED','PURCHASE_CHARGEBACK','PURCHASE_PROTEST'],instructions:'Na Hotmart, abra Ferramentas → Webhook. Use a versão 2.0.0 e os eventos de compra listados abaixo. Informe aqui o Hottok da sua conta; não é necessário informar Client ID e Client Secret para receber estes eventos.'},
 perfectpay:{name:'PerfectPay',category:'checkout',auth:'payload_token',docs:'https://help.perfectpay.com.br/article/597-integracao-via-webhook-com-a-perfect-pay',fields:[{name:'token',label:'Token do webhook da PerfectPay',type:'password',required:true}],events:['Venda aprovada','Venda concluída','Venda pendente','Venda recusada','Venda cancelada','Venda reembolsada','Chargeback'],instructions:'Na PerfectPay, configure o postback/webhook para a URL privada abaixo e os eventos de atualização da venda. O token recebido no webhook deve ser o mesmo informado aqui.'},
 cartpanda:{name:'Cartpanda',category:'checkout',auth:'private_url',docs:'https://help.cartpanda.com/pt-br/article/como-testar-webhooks-na-sua-loja-1kfjhn8/',fields:[],events:['order.created','order.paid','order.updated','order.refunded'],instructions:'Na Cartpanda, abra Admin → Notificações → Configurar Webhooks. Cadastre a mesma URL para Pedido criado, Pedido pago, Pedido atualizado e Pedido reembolsado. Este conector recebe pedidos JSON da loja; postbacks S2S de afiliado têm outro formato e não devem usar esta URL.'}
});
export const checkoutProviders=Object.freeze(Object.keys(webhookConnectors));
export function connector(provider){const c=webhookConnectors[provider];if(!c)throw new Error('Plataforma indisponível');return c;}
export function validateWebhookSetup(provider,input){
 const c=connector(provider),name=String(input.name||'').trim();
 if(name.length<1||name.length>120)throw new Error('Informe um nome para a conexão');
 const secrets={};for(const f of c.fields){const value=String(input[f.name]||'').trim();if(f.required&&(value.length<16||value.length>2000))throw new Error('Informe um token válido da plataforma');secrets[f.name]=value;}
 return {name,secrets};
}
export function webhookEndpoint(origin,provider,id,token){
 const url=new URL('/functions/v1/tracking-webhook',origin);
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Invalid callback origin');
 url.search=new URLSearchParams({provider,integration:id,ingress_key:token});return url.href;
}
