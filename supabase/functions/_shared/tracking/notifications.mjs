export const notificationTitles=Object.freeze({pending:'Pedido pendente',sale:'Venda aprovada',renewal:'Renovação aprovada',refused:'Pagamento recusado',cancelled:'Pedido cancelado',refund:'Reembolso registrado',chargeback:'Chargeback registrado',disputed:'Pagamento em disputa',failure:'Integração requer atenção'});
export function notificationMessage(category,order={},hidden=true){
 const title=notificationTitles[category]||'Atualização do pedido';
 const descriptions={pending:'Aguardando confirmação do pagamento.',sale:'Pagamento confirmado na sua operação.',renewal:'Uma nova renovação foi confirmada.',refused:'O pagamento deste pedido foi recusado.',cancelled:'Este pedido foi cancelado.',refund:'Um reembolso foi registrado.',chargeback:'Uma contestação foi registrada.',disputed:'Este pagamento está em disputa.',failure:'Confira a conexão em Integrações.'};
 const value=['refund','chargeback'].includes(category)?order.refund_minor:order.gross_minor;
 const amount=!hidden&&value!=null&&order.currency?new Intl.NumberFormat('pt-BR',{style:'currency',currency:order.currency}).format(Number(value)/10**Number(order.amount_scale??2)):null;
 return {title,body:[descriptions[category]||'Confira as informações do pedido.',amount].filter(Boolean).join(' · ')};
}
export function notificationPush(delivery,origin){
 const url=new URL('/',origin);url.searchParams.set('workspace',delivery.workspace_id);
 if(delivery.order_id)url.searchParams.set('order',delivery.order_id);else url.searchParams.set('tab','integrations');
 const order=Object.keys(delivery.order_snapshot||{}).length?delivery.order_snapshot:delivery.order;
 return {...notificationMessage(delivery.category,order||{},delivery.preference?.hide_amount!==false),notificationId:'tracking-'+delivery.id,workspaceId:delivery.workspace_id,orderId:delivery.order_id,integrationId:delivery.integration_id,url:url.href};
}
