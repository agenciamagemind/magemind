/* Generated from tracking/integration-health.mjs. */
(()=>{
// Safe, actionable diagnostics: never render raw provider messages or credentials.
function integrationHealth(integration={}){
 const code=String(integration.error_code||''),provider=String(integration.provider||'');
 if(!integration.connected)return {kind:'disconnected',label:'Desconectado',reason:'A conexão está desativada.',action:'Reconecte quando quiser retomar as atualizações.'};
 if(!code||code==='sync_requested')return {kind:code?'queued':'healthy',label:code?'Sincronizando':'Conectado',reason:'',action:''};
 if(code==='meta_confirmation_required')return {kind:'authorization',label:'Confirmação na Meta',reason:'A Meta bloqueou temporariamente o acesso à API.',action:'Conclua a confirmação da conta na Meta e sincronize novamente.'};
 if(code==='token_revoked')return {kind:'authorization',label:'Acesso precisa ser renovado',reason:'A autorização expirou ou foi revogada.',action:provider==='meta'?'Abra Conexões e selecione Renovar acesso.':'Reconecte a conta em Integrações.'};
 if(code==='rate_limit')return {kind:'temporary',label:'Limite de consultas',reason:'A plataforma limitou temporariamente as consultas.',action:'A atualização será retomada automaticamente. Não é necessário desconectar.'};
 if(code==='meta_read_denied'||/^provider_http_400_(200|10)$/.test(code))return {kind:'authorization',label:'Permissão de leitura ausente',reason:'A Meta não liberou a leitura da conta de anúncios.',action:'Peça acesso ao administrador da conta na Meta e renove a conexão.'};
 if(/^provider_http_5\d\d/.test(code)||code==='provider_http_400_2'||code==='sync_failed')return {kind:'temporary',label:'Atualização temporariamente indisponível',reason:'Não foi possível concluir a sincronização com a plataforma.',action:'Tentaremos novamente automaticamente. Se persistir, fale com o suporte.'};
 return {kind:'error',label:'Requer atenção',reason:'A plataforma não aceitou a última sincronização.',action:'Tente sincronizar novamente. Se persistir, acione o suporte com o código '+code.replace(/[^a-zA-Z0-9_]/g,'').slice(0,60)+'.'};
}
function integrationNotification(notification={}){
 const provider=notification.integration_provider||notification.provider||notification.order_snapshot?.provider||'';
 const name=notification.integration_name||notification.name||notification.order_snapshot?.integration_name||'';
 const prefix=({meta:'Meta Ads',google:'Google Ads',tiktok:'TikTok Ads',kiwify:'Kiwify',hotmart:'Hotmart'}[provider]||'Integração')+(name?' · '+name:'');
 if(notification.failure_resolved)return {title:'Conexão restabelecida',body:prefix+': a sincronização voltou a funcionar.'};
 const code=notification.integration_error_code&&notification.integration_error_code!=='sync_requested'?notification.integration_error_code:notification.incident_error_code||notification.order_snapshot?.error_code;
 const health=integrationHealth({connected:true,provider,error_code:code||'unknown'});
 return {title:'Integração requer atenção',body:prefix+': '+health.reason+' '+health.action};
}

window.MagemindIntegrationHealth={integrationHealth,integrationNotification};
})();
