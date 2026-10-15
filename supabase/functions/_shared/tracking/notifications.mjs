export const notificationTitles=Object.freeze({pending:'Venda pendente!',sale:'Venda aprovada!',renewal:'Renovação aprovada!',refused:'Venda recusada!',cancelled:'Venda cancelada!',refund:'Venda estornada!',chargeback:'Chargeback registrado!',disputed:'Venda em disputa!',failure:'Integração requer atenção'});
export function notificationMessage(category,order={},hidden=false){
 const title=notificationTitles[category]||'Atualização do pedido';
 const value=['refund','chargeback'].includes(category)?order.refund_minor:order.gross_minor;
 const amount=!hidden&&value!=null&&order.currency?new Intl.NumberFormat('pt-BR',{style:'currency',currency:order.currency}).format(Number(value)/10**Number(order.amount_scale??2)):null;
 return {title,body:category==='failure'?'Confira a conexão em Integrações.':hidden?'Valor oculto':amount?'Valor: '+amount:''};
}
export function notificationPush(delivery,origin){
 const url=new URL('/',origin);url.searchParams.set('workspace',delivery.workspace_id);
 if(delivery.order_id)url.searchParams.set('order',delivery.order_id);else url.searchParams.set('tab','integrations');
 const order=Object.keys(delivery.order_snapshot||{}).length?delivery.order_snapshot:delivery.order;
 return {...notificationMessage(delivery.category,order||{},delivery.preference?.hide_amount===true),notificationId:'tracking-'+delivery.id,workspaceId:delivery.workspace_id,orderId:delivery.order_id,integrationId:delivery.integration_id,url:url.href};
}
