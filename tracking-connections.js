(() => {
 'use strict';
 const specs=window.MagemindWebhookConnectors;
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const edge=data=>window.MagemindTrackingBackend.edge({workspace:c.state.workspace,...data});
 const api=window.MAGEMIND_TRACKING_ENV.supabaseUrl+'/functions/v1/tracking-api?callback=meta';
 const adPlatforms=['meta','google','tiktok'];
 const metaId=id=>/^act_\d+$/.test(id||'');
 const authKey='magemind-meta-return';
 const linkIcon='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 13a4 4 0 0 0 6 .3l3.1-3.1a4 4 0 0 0-5.7-5.7l-1.7 1.7M14 11a4 4 0 0 0-6-.3l-3.1 3.1a4 4 0 0 0 5.7 5.7l1.7-1.7" stroke-linecap="round"/></svg>';
 let c;
 const configure=context=>{c=context;};
 const status=i=>window.MagemindIntegrationHealth.integrationHealth(i);
 const action=(label,name,id='',style='quiet')=>'<button type="button" class="'+style+'" data-action="'+name+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+label+'</button>';
 const support=(message='Olá! Preciso de ajuda com a conexão de anúncios na Magemind.')=>{
  const phone=typeof getAgencyPhone==='function'?String(getAgencyPhone()||'').replace(/\D/g,''):'';
  const url=phone?'https://wa.me/'+phone+'?text='+encodeURIComponent(message):'mailto:contato@magemind.com.br?body='+encodeURIComponent(message);
  return '<a class="mt-support-link" href="'+url+'" target="_blank" rel="noopener noreferrer">Falar com o suporte</a>';
 };
 const accessHelp='Confira sua função na conta de anúncios da Meta. Peça ao administrador acesso para gerenciar campanhas e renove a conexão.';
 function webhook(provider){
  const s=specs[provider];
  if(!s)throw new Error('Plataforma indisponível');
  const roles={PRODUCER:'Produtor',AFFILIATE:'Afiliado',COPRODUCER:'Coprodutor'};
  const fields=s.fields.map(f=>'<label class="wide">'+esc(f.label)+'<input type="'+f.type+'" name="'+f.name+'" '+(f.required?'required':'')+' autocomplete="off" '+(f.type==='password'?'minlength="16" maxlength="2000"':'maxlength="254"')+'></label>').join('');
  const participation=s.manualFees?'<input type="hidden" name="recipientSource" value="PRODUCER">':
   '<label class="wide">Minha participação na venda<select name="recipientSource">'+(s.roles||Object.keys(roles)).map(role=>'<option value="'+role+'">'+roles[role]+'</option>').join('')+'</select></label>';
  c.modal('Conectar '+s.name,'<div class="mt-webhook-heading">'+c.brand.logo(provider)+'<p>Receba os pedidos diretamente da plataforma.</p></div>'+
   '<form data-form="webhook-create" class="form-grid"><input type="hidden" name="provider" value="'+provider+'">'+
   '<label class="wide">Nome da conexão<input name="name" required maxlength="120" placeholder="Ex.: Minha loja '+s.name+'" autocomplete="off"></label>'+
   fields+participation+'<a class="small wide" href="'+s.docs+'" target="_blank" rel="noopener noreferrer">Instruções oficiais da '+s.name+' ↗</a>'+
   '<p class="small wide">Uma conexão por plataforma. Ao reconectar, atualize o endereço no checkout.</p>'+
   '<button type="submit" class="primary wide">Criar webhook</button><p class="mt-form-error wide" role="alert" hidden></p></form>');
 }
 function showWebhook(provider,url,id){
  const s=specs[provider];
  c.modal('Webhook · '+s.name,
   '<div class="mt-webhook-heading">'+c.brand.logo(provider)+'<div><strong>Endereço da sua conexão</strong><p>Cadastre este endereço na plataforma para começar a receber pedidos.</p></div></div>'+
   '<p>'+esc(s.instructions)+'</p><label>URL privada<textarea id="mt-webhook-url" readonly rows="3">'+esc(url)+'</textarea></label>'+
   '<div class="actions">'+action('Copiar URL','connection-copy','','primary')+
   '<a href="'+s.docs+'" target="_blank" rel="noopener noreferrer">Abrir instruções ↗</a></div>'+
   '<div class="mt-webhook-events"><strong>Eventos recomendados</strong><p>'+s.events.map(esc).join(' · ')+'</p></div>'+
   '<p class="small">Mantenha este endereço em sigilo. O painel mostra a conexão como ativa ao receber o primeiro evento válido.</p>'+
   (id?action('Configurar taxa','cost-integration',id):''));
 }
 async function meta(integration=null){
  const r=await edge({action:'oauth_start',provider:'meta',...(integration?{integration}:{})});
  try{sessionStorage.setItem(authKey,c.state.tab==='ads'?'campaigns':'integrations');}catch{}
  location.assign(r.url);
 }
 function returnPage(){
  let route;
  try{route=sessionStorage.getItem(authKey);sessionStorage.removeItem(authKey);}catch{}
  return route==='campaigns'?'campaigns':'integrations';
 }
 function campaignControl(rows){
  const problem=rows.map(status).find(item=>item.kind==='authorization')||rows.map(status).find(item=>['temporary','error'].includes(item.kind));
  return '<button type="button" class="quiet mt-connection-trigger" data-action="campaign-connections"'+
   (problem?' title="'+esc(problem.label+' · '+problem.action)+'"':'')+'>'+linkIcon+' Conexões'+
   (problem?'<span class="mt-connection-dot" aria-hidden="true"></span><span class="sr-only"> · requer atenção</span>':'')+'</button>';
 }
 function accountCard(account){
  const health=status(account);
  const readonly=account.management_access===false&&account.connected;
  const real=account.provider==='meta'&&metaId(account.account_id)&&account.mode!=='simulated';
  const date=account.last_sync_at?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(account.last_sync_at)):null;
  return '<article class="mt-account-card"><header><div><strong>'+esc(account.name||account.account_id)+'</strong><small>'+esc(account.account_id)+'</small></div>'+
   '<span class="mt-connection-chip" data-kind="'+esc(readonly&&health.kind==='healthy'?'authorization':health.kind)+'">'+esc(readonly&&health.kind==='healthy'?'Somente leitura':health.label)+'</span></header>'+
   (date?'<p class="small">Dados de '+esc(date)+'</p>':'')+
   (health.action&&account.connected?'<p>'+esc(health.action)+'</p>':readonly?'<p>'+accessHelp+'</p>':'')+
   '<div class="mt-account-actions">'+
    (real&&account.connected?action('Testar conexão','campaign-test',account.id):'')+
    (account.connected&&health.kind!=='authorization'?action('Sincronizar','campaign-sync',account.id):'')+
    (real&&(!account.connected||health.kind==='authorization'||readonly)?action('Renovar acesso','campaign-renew',account.id):'')+
    (account.connected?action('Desconectar conta','campaign-disconnect',account.id,'quiet mt-fee-danger'):'')+
   '</div></article>';
 }
 async function hub(note='',problem=false){
  const rows=(await c.api('/integrations')).filter(x=>adPlatforms.includes(x.provider)&&!x.account_id.startsWith('oauth:'));
  const active=rows.filter(i=>i.connected);
  const groups=new Map();
  for(const account of active){
   const key=account.provider_profile_id||'existing-'+account.provider;
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(account);
  }
  const needsAttention=list=>list.some(account=>status(account).kind==='authorization');
  const blocks=[...groups.values()].sort((left,right)=>Number(needsAttention(right))-Number(needsAttention(left))).map(list=>{
   const first=list[0],profile=first.provider_profile_id;
   const canAdd=list.find(i=>i.provider==='meta'&&i.mode!=='simulated'&&status(i).kind!=='authorization');
   return '<section class="mt-meta-profile"><div class="mt-meta-profile-heading">'+c.brand.logo(first.provider)+
    '<div><h3>'+esc(first.provider_profile_name||(first.provider==='meta'?'Contas Meta Ads':c.brand.name(first.provider)))+'</h3>'+
    '<p>'+list.length+(list.length===1?' conta vinculada':' contas vinculadas')+'</p></div></div>'+
    '<div class="mt-profile-actions">'+
     (canAdd?action('Adicionar contas','campaign-add',canAdd.id):'')+
     (profile?action('Desconectar perfil','campaign-profile-disconnect',profile,'quiet mt-fee-danger'):'')+
    '</div><div class="mt-connection-accounts">'+list.map(accountCard).join('')+'</div></section>';
  }).join('');
  const inactive=rows.filter(i=>!i.connected);
  c.modal('Conexões de anúncios',
   '<div class="mt-connections-panel"><header><p>Gerencie o acesso e a sincronização das contas que aparecem em Campanhas.</p>'+
   action(linkIcon+(active.length?' Conectar outro perfil Meta':' Conectar perfil Meta'),'campaign-link','','primary')+'</header>'+
   (note?'<p class="mt-connection-feedback'+(problem?' is-error':'')+'" role="status">'+esc(note)+'</p>':'')+
   (blocks||'<p class="mt-connection-empty">Assim que você conectar um perfil, suas contas de anúncios aparecerão aqui.</p>')+
   (inactive.length?'<details class="mt-inactive-accounts"><summary>Contas desconectadas · '+inactive.length+'</summary><div class="mt-connection-accounts">'+inactive.map(accountCard).join('')+'</div></details>':'')+
   '<footer>'+support()+'</footer></div>');
 }
 function normalizeSearch(text){return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');}
 function updateSelection(form){
  const boxes=[...form.querySelectorAll('[name="accounts"]')];
  const total=boxes.filter(box=>box.checked).length;
  form.querySelector('[data-account-count]').textContent=total+' de 20 selecionadas';
  form.querySelector('[type="submit"]').disabled=total<1||total>20;
 }
 async function accounts(grant,{addOnly=false}={}){
  const r=await edge({action:'oauth_accounts',grant});
  if(r.renewed){
   const note='Acesso renovado para '+r.renewed.name+'. Sincronização solicitada.';
   await c.render();
   return hub(note+(r.renewed.management_access===false?' '+accessHelp:''));
  }
  const items=r.accounts.filter(a=>!addOnly||!a.connected).sort((a,b)=>Number(b.needs_access)-Number(a.needs_access)||a.name.localeCompare(b.name,'pt-BR'));
  const choices=items.map((a,index)=>'<label class="mt-account-option" data-account-query="'+esc(normalizeSearch(a.name+' '+a.account_id+' '+a.currency))+'">'+
   '<input type="checkbox" name="accounts" value="'+esc(a.account_id)+'"'+(a.needs_access&&index<20?' checked':'')+'><span><strong>'+esc(a.name)+'</strong>'+
   '<small>'+esc(a.account_id)+' · '+esc(a.currency)+' · '+esc(a.timezone)+'</small>'+
   (a.connected?'<small class="mt-account-caption">'+(a.needs_access?'Renovação necessária':'Já conectada')+'</small>':a.management_access===false?'<small class="mt-account-caption">Somente leitura</small>':'')+'</span></label>').join('');
  c.modal('Selecionar contas Meta Ads','<div class="mt-webhook-heading">'+c.brand.logo('meta')+
   '<div><strong>'+esc(r.profile||'Seu perfil Meta')+'</strong><p>Selecione as contas que deseja acompanhar.</p></div></div>'+
   (items.length?'<form data-form="oauth-accounts"><input type="hidden" name="grant" value="'+esc(grant)+'">'+
    '<div class="mt-account-picker-head"><label>Buscar conta<input type="search" name="account_search" placeholder="Nome ou número"></label>'+
    '<span class="small" data-account-count role="status"></span></div>'+
    '<div class="mt-connection-accounts mt-account-picker">'+choices+'<p data-empty-accounts class="small" hidden>Nenhuma conta encontrada.</p></div>'+
    '<p class="mt-form-error" role="alert" hidden></p>'+
    '<div class="mt-fee-actions">'+action('Voltar para conexões','campaign-connections')+'<button type="submit" class="primary">Conectar contas</button></div></form>':
    '<p>'+(addOnly?'As contas autorizadas deste perfil já estão conectadas.':'Nenhuma conta compatível. Confira as permissões de anúncios no Gerenciador de Negócios da Meta.')+'</p>'+
    '<div class="mt-fee-actions">'+action('Voltar para conexões','campaign-connections')+support()+'</div>'));
  const form=document.querySelector('[data-form="oauth-accounts"]');
  if(!form)return;
  updateSelection(form);
  form.addEventListener('change',()=>updateSelection(form));
  form.elements.account_search.addEventListener('input',()=>{
   const search=normalizeSearch(form.elements.account_search.value.trim());
   const options=[...form.querySelectorAll('[data-account-query]')];
   for(const item of options)item.hidden=!item.dataset.accountQuery.includes(search);
   form.querySelector('[data-empty-accounts]').hidden=options.some(item=>!item.hidden);
  });
 }
 async function campaignAction(name,id){
  if(name==='campaign-connections')return hub();
  if(name==='campaign-integrate'&&['google','tiktok'].includes(id)){
   const platform=c.brand.name(id);
   return c.modal('Conectar '+platform,'<p>A conexão com '+esc(platform)+' ainda precisa ser habilitada pela Magemind. Fale com a equipe para solicitar a ativação.</p>'+
    '<div class="actions">'+support('Olá! Quero solicitar a conexão com '+platform+' no painel da Magemind.')+'</div>');
  }
  if(name==='campaign-link'||name==='campaign-renew'){
   try{return await meta(name==='campaign-renew'?id:null);}
   catch(error){return hub(error.message,true);}
  }
  if(name==='campaign-add'){
   try{const r=await edge({action:'meta_profile_add',integration:id});return await accounts(r.grant,{addOnly:true});}
   catch(error){await c.render();return hub(error.message,true);}
  }
  if(name==='campaign-test'){
   try{
    const r=await edge({action:'meta_test',integration:id});
    await c.render();
    return await hub(r.management_access===false?'Leitura confirmada. '+accessHelp:'Conexão com a Meta testada com sucesso.');
   }catch(error){await c.render();return hub(error.message,true);}
  }
  if(name==='campaign-sync'){
   try{
    const r=await c.api('/integration/sync',{id});
    await c.render();
    return hub(r?.status==='rate_limit'?'A Meta está limitando as consultas. A próxima tentativa será automática.':'Sincronização solicitada.');
   }catch(error){return hub(error.message,true);}
  }
  if(name==='campaign-disconnect'||name==='campaign-profile-disconnect'){
   const profile=name==='campaign-profile-disconnect';
   return c.modal(profile?'Desconectar perfil Meta?':'Desconectar conta de anúncios?',
    '<p>'+(profile?'As contas deste perfil':'Esta conta')+' sairão da visualização atual. Você pode reconectar para voltar a sincronizar. O histórico permanece na Magemind.</p>'+
    '<div class="mt-fee-actions">'+action('Cancelar','campaign-connections')+
    action('Desconectar',profile?'campaign-profile-confirm':'campaign-disconnect-confirm',id,'quiet mt-fee-danger')+'</div>');
  }
  if(name==='campaign-profile-confirm'||name==='campaign-disconnect-confirm'){
   await c.api(name==='campaign-profile-confirm'?'/meta/disconnect-profile':'/integration/disconnect',{id});
   await c.render();
   return hub('Conexão desconectada.');
  }
 }
 async function platform(){
  const s=await edge({action:'platform_status'});if(!s.can_configure)throw new Error('Configuração exclusiva do administrador master');
  c.modal('Login da Meta · configuração do aplicativo','<p>Cadastre o aplicativo da Magemind no Meta for Developers e configure o login para empresas. Este cadastro é feito uma vez para a plataforma.</p><label>URI de redirecionamento OAuth<textarea readonly rows="2">'+esc(api)+'</textarea></label><form data-form="meta-platform" class="form-grid"><label>App ID<input name="app_id" required inputmode="numeric" pattern="[0-9]{5,30}" value="'+esc(s.app_id)+'" autocomplete="off"></label><label>Config ID (Login para Empresas)<input name="config_id" inputmode="numeric" pattern="[0-9]{5,30}" value="'+esc(s.config_id)+'" autocomplete="off"></label><label class="wide">Segredo do aplicativo<input type="password" name="client_secret" '+(s.configured?'':'required')+' minlength="32" maxlength="32" autocomplete="off" placeholder="'+(s.configured?'Deixe vazio para manter o segredo atual':'Informe o segredo gerado pela Meta')+'"></label><label class="checkbox wide"><input type="checkbox" name="allow_management" '+(s.allow_management?'checked':'')+'>Permitir que o cliente ative ou pause seus próprios anúncios (ads_management).</label><button class="primary wide">Salvar configuração privada</button><p class="small wide">O segredo é cifrado no servidor e nunca volta para o navegador. Em modo de desenvolvimento, a Meta só permite usuários com função no aplicativo. Acesso de outros usuários depende da aprovação das permissões pela Meta.</p></form>');
 }
 async function submit(type,form){
  const p=Object.fromEntries(new FormData(form));
  if(type==='api-create'){
   const r=await edge({...p,action:'create_api'});
   await c.render();
   c.modal('API de pedidos','<p>Envie pedidos normalizados por POST para o endereço abaixo.</p><label>Endpoint<textarea readonly>'+esc(r.endpoint)+'</textarea></label><label>Credencial privada (exibida uma vez)<textarea readonly>'+esc(r.token)+'</textarea></label><p>Use o cabeçalho Authorization: Bearer TOKEN. O corpo segue o contrato de pedido versão 1: valores inteiros em centavos, identidade do pedido, itens, status e datas. Pedidos reais devem usar is_test: false.</p><p class="small">Mantenha a credencial no servidor da sua integração. Gerar uma nova credencial revoga a anterior e preserva o histórico.</p>');
   return true;
  }
  if(type==='webhook-create'){
   const r=await edge({...p,action:'create_webhook',manual_fees:specs[p.provider].manualFees===true});
   form.reset();
   const finish=()=>showWebhook(p.provider,r.webhook,r.integration);
   try{
    await c.render();
    await c.configureFee({id:r.integration,name:p.name,provider:p.provider},finish);
   }catch{
    finish();
    c.toast('Webhook criado. Abra Configurações → Custos para revisar a tarifa.','err');
   }
   return true;
  }
  if(type==='oauth-accounts'){
   const ids=new FormData(form).getAll('accounts');
   if(!ids.length||ids.length>20)throw new Error('Selecione de uma a vinte contas.');
   const result=await edge({action:'oauth_select',grant:p.grant,accounts:ids});
   await c.render();
   await hub(result.connected===1?'Conta conectada. Sincronização na fila.':'Contas conectadas. Sincronização na fila.');
   return true;
  }
  if(type==='meta-platform'){
   await edge({...p,action:'platform_save',allow_management:form.elements.allow_management.checked});
   form.reset();
   document.getElementById('tracking-dialog').close();
   await c.render();
   c.toast('Configuração privada salva.');
   return true;
  }
  return false;
 }
 window.MagemindTrackingConnections={
  configure,webhook,showWebhook,meta,accounts,platform,submit,campaignControl,campaignAction,returnPage,hub,support,
  custom(){c.modal('API de pedidos','<form data-form="api-create"><label>Nome da conexão<input name="name" required maxlength="120" placeholder="Ex.: Minha integração"></label><button class="primary">Gerar credencial privada</button><p class="small">Integração para desenvolvedores: envia pedidos no contrato padronizado da Magemind.</p></form>');},
  async details(id){const r=await edge({action:'webhook_details',integration:id});showWebhook(r.provider,r.webhook,id);},
  async copy(){await navigator.clipboard.writeText(document.getElementById('mt-webhook-url').value);c.toast('URL copiada.');}
 };
})();
