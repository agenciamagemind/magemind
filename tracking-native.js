(() => {
 'use strict';
 const cfg=window.MAGEMIND_TRACKING_ENV;
 const pilot=cfg?.mode==='supabase-pilot';
 if(pilot){if(cfg.environmentId!=='magemind-tracking-pilot-v1'||cfg.supabaseUrl!=='https://tsawxmlfvnvepzgcztfc.supabase.co')throw new Error('Piloto inválido');}else if(!cfg||cfg.environment!=='test'||cfg.externalDelivery!==false||!/magemind-tracking-(local|test)-/.test(cfg.environmentId)||JSON.stringify(cfg).includes('tsawxmlfvnvepzgcztfc'))throw new Error('Configuração isolada de teste necessária');
 const $=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const tabs=[['overview','Dashboard'],['ads','Campanhas'],['orders','Pedidos'],['products','Produtos'],['integrations','Integrações'],['settings','Configurações']];
 const routes={overview:'dashboard',ads:'campaigns',orders:'orders',products:'products',integrations:'integrations',settings:'settings'};
 const brand=window.MagemindTrackingBrands;
 const periods=window.MagemindTrackingPeriods;
 const connections=window.MagemindTrackingConnections;
 const fees=window.MagemindTrackingFees;
 const catalog=window.MagemindTrackingProducts;
 const checkoutProviders=Object.keys(window.MagemindWebhookConnectors);
 const adProviders=['meta','google','tiktok'];
 const adViews=new Map();

 const statusLabel={pending:'Pendente',paid:'Aprovado',refunded:'Devolvido',chargeback:'Chargeback',refused:'Recusado',cancelled:'Cancelado',disputed:'Em disputa'};
 const scale={BRL:2,USD:2,EUR:2,JPY:0,KWD:3};
 let user=null,workspaces=[],authMode='login',requestVersion=0,notificationIds=new Set(),notificationScope=null,notificationPollRunning=false;
 const notificationTitles={pending:'Venda pendente!',sale:'Venda aprovada!',renewal:'Renovação aprovada!',refused:'Venda recusada!',cancelled:'Venda cancelada!',refund:'Venda estornada!',chargeback:'Chargeback registrado!',disputed:'Venda em disputa!',failure:'Integração requer atenção'};
 const failureCopy=n=>window.MagemindIntegrationHealth.integrationNotification(n);
 const notificationTitle=n=>n.category==='failure'?failureCopy(n).title:notificationTitles[n.category]||'Atualização do pedido';
 const notificationBody=n=>n.category==='failure'?failureCopy(n).body:n.hide_amount?'Valor oculto':n.gross_minor==null?'':'Valor: '+money(['refund','chargeback'].includes(n.category)?n.refund_minor:n.gross_minor,n.currency,n.amount_scale);
 const notificationPreferences=[['pending','Pedidos pendentes'],['sales','Vendas aprovadas'],['renewals','Renovações'],['refusals','Pagamentos recusados'],['cancellations','Pedidos cancelados'],['refunds','Reembolsos'],['chargebacks','Chargebacks'],['disputes','Pagamentos em disputa'],['failures','Falhas de integração'],['hide_amount','Ocultar valores nos avisos']];
 let setup=null,costRules=[],costProducts=[],costHistory=false,celebrating=false,welcomePending=null,sessionStarted=Date.now(),onboardingExpanded=false;
 const day=timestamp=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(timestamp));
 const state={workspace:null,tab:'overview',preset:'week',...periods.range('week'),currency:'BRL',page:1,status:'',provider:'',channel:'',payment:'',search:''};
 function campaignView(provider){
  const key=state.workspace+':'+provider;
  if(!adViews.has(key))adViews.set(key,{level:'campaign',sort:'spend_minor',direction:'desc',parent:'',account:'',accountIds:[],delivery:''});
  return adViews.get(key);
 }
 let costFlow=null,filterTimer=0,adDetailRequest=0;
 connections.configure({modal,brand,state,render,toast,api,configureFee});
 const workspace=()=>workspaces.find(w=>w.id===state.workspace);
 const observer=()=>window.trackingObserver?.()===true;
 const money=(n,currency=state.currency,amountScale=scale[currency])=>n==null?'Indisponível':new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(Number(n)/10**amountScale);
 window.MagemindDashboard.configure({api,toast,modal,money,brand,chart:chartHTML,demandsOpen:()=>goTo('demands'),refresh:render});
 const dt=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:workspace()?.timezone||'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'Ainda não recebida';
 const dateLabel=value=>String(value||'').slice(0,10).split('-').reverse().join('/');
 function toast(message,type){window.toast(message,type);}
 function persist(){if(user){const {search,...safe}=state;localStorage.setItem('mm_tracking_state_'+user.user_id,JSON.stringify(safe));}}
 function clear(){clearTimeout(filterTimer);filterTimer=0;adViews.clear();restoreTrackingToolbar();requestVersion++;renderedScope='';pendingData=false;syncFingerprint='';closePeriod();window.MagemindDashboard.clear();onboardingExpanded=false;window.MagemindTrackingBackend?.subscribe(null,()=>{});user=null;workspaces=[];setup=null;costRules=[];costProducts=[];costFlow=null;welcomePending=null;state.workspace=null;state.search='';state.preset='week';Object.assign(state,periods.range('week'));notificationIds.clear();notificationScope=null;$('tracking-content').replaceChildren();$('tracking-notifications-mount')?.replaceChildren();$('tracking-module').hidden=true;$('dialog-content').replaceChildren();$('tracking-dialog').close();}
 async function api(route,data,params={}){
  if(window.MagemindTrackingBackend)return window.MagemindTrackingBackend.call(route,data,params,state);
  const u=new URL(cfg.apiBase+route,location.origin);
  if(state.workspace)u.searchParams.set('workspace',state.workspace);
  for(const key of ['from','to','currency','page'])u.searchParams.set(key,state[key]);
  for(const [k,v] of Object.entries(params))if(v!=null&&v!=='')u.searchParams.set(k,v);
  const res=await fetch(u,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Magemind-Test':'1'},...(data?{method:'POST',body:JSON.stringify({...data,...(state.workspace?{workspace:state.workspace}:{})})}:{})});
  const body=await res.json();
  if(!res.ok){if(res.status===401&&user)clear();throw new Error(body.error||'Falha na solicitação');}return body;
 }
 const button=(label,action,attrs='',primary=false)=>'<button type="button" class="'+(primary?'primary':'quiet')+'" data-action="'+action+'" '+attrs+'>'+label+'</button>';
 const pill=status=>'<span class="pill '+esc(status)+'">'+esc(statusLabel[status]||status)+'</span>';
 function modal(title,html){
  const dialog=$('tracking-dialog');
  $('dialog-title').textContent=title;
  $('dialog-content').innerHTML=html;
  dialog.classList.toggle('mm-glass',Boolean(dialog.querySelector('.mt-connections-panel,.mt-payment-fee,.mt-account-picker,.mt-order-detail,.mt-ad-detail,[data-form=cost]')));
  dialog.scrollTop=0;
  if(dialog.open)window.focusDialogSurface(dialog);
  else window.openAccessibleDialog(dialog);
 }
 function metric(label,value,note='',cls=''){return '<article class="metric '+cls+'"><span class="metric-label">'+label+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></article>';}
 function empty(title,text,action=''){return '<div class="empty"><span class="eyebrow">COMECE PELA SUA OPERAÇÃO</span><h2>'+title+'</h2><p>'+text+'</p><div class="actions">'+action+'</div></div>';}
 function panel(title,html){return '<section class="panel"><div class="panel-head"><h2>'+title+'</h2></div><div class="panel-body">'+html+'</div></section>';}
 function connectionGate(page,platforms,title,description,action){
  const canManage=['owner','admin'].includes(workspace()?.role),heading=page+'-connect-title';
  return '<div class="mt-connection-gate"><section class="mt-connect-message mm-glass" aria-labelledby="'+heading+'">'+
   '<div class="mt-connect-brands">'+platforms.map(p=>brand.logo(p)).join('')+'</div>'+
   '<h1 id="'+heading+'">'+title+'</h1><p>'+description+'</p>'+
   (canManage?button('Abrir Integrações',action,'',true):'<p>Peça ao responsável pela operação para configurar a conexão em Integrações.</p>')+
   '</section></div>';
 }
 function tutorialHTML(){
  if(!isClient()||setup?.completed_at)return '';
  const definitions={checkout:['Conecte seu checkout','Receba pedidos e faturamento de Kiwify, Hotmart ou da sua API.','setup-checkouts','Conectar checkout'],ads:['Conecte sua conta de anúncios','Acompanhe investimento, campanhas, CPA e ROAS.','setup-ads','Conectar anúncios'],costs:['Configure custos e taxas','Cadastre os custos e as taxas da operação, ou informe que você não tem custos.','setup-costs','Configurar custos'],order:['Receba seu primeiro pedido','Assim que o checkout enviar um pedido, ele aparecerá automaticamente.','setup-orders','Ver pedidos']};
  const tasks=setup.tasks.filter(t=>definitions[t.id]),done=tasks.filter(t=>t.done).length,percent=Math.round(done/tasks.length*100);
  return '<details class="mt-onboarding mt-compact-onboarding" '+(onboardingExpanded?'open':'')+'><summary><div class="mt-onboarding-head"><div><h2>Acompanhe sua operação em um só lugar</h2><p>'+done+' de '+tasks.length+' etapas concluídas</p></div><strong>'+percent+'%</strong><span class="mt-disclosure-button"><span class="mt-when-closed">Ver etapas</span><span class="mt-when-open">Ocultar etapas</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></span></div><div class="mt-setup-progress" role="progressbar" aria-label="Configuração da conta" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+percent+'"><span style="width:'+percent+'%"></span></div></summary><ol class="mt-setup-steps">'+tasks.map((t,index)=>{const [title,description,action,label]=definitions[t.id];return '<li class="'+(t.done?'completed':'')+'"><span class="mt-step-index" aria-hidden="true">'+(t.done?'✓':index+1)+'</span><div><h3>'+title+'</h3><p>'+description+'</p></div><div class="mt-step-actions">'+(t.done?'<span class="mt-step-done">Concluído</span>':button(label,action)+(t.id==='costs'?button('Não tenho custos','setup-zero-cost'):'') )+'</div></li>';}).join('')+'</ol></details>';
 }
 document.addEventListener('toggle',e=>{if(e.target.matches?.('.mt-compact-onboarding')&&e.target.isConnected)onboardingExpanded=e.target.open;},true);
 function quietLock(html,label,mini=false,action=null){return '<section class="mt-passive-lock'+(mini?' mt-mini-passive':'')+'"><div class="mt-data-preview" inert aria-hidden="true">'+html+'</div><div class="mt-lock-content"><span class="mt-lock-caption"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'+label+'</span>'+(action?button(action==='setup-costs'?'Configurar custos':action==='setup-journey'?'Configurar rastreamento':'Conectar integração',action):'')+'</div></section>';}
 async function maybeCelebrate(){
  const canShow=()=>state.tab==='overview'&&$('pg-dashboard').classList.contains('active')&&
   !window.MagemindDashboard.isEditing()&&!document.querySelector('dialog[open],.overlay.open,.sidebar.mobile-open');
  if(!isClient()||celebrating||Date.now()-sessionStarted<1800||!canShow())return;
  const uid=user?.user_id;if(!uid)return;
  if(welcomePending===uid){welcomePending=null;showWelcome();return;}
  if(!setup?.celebration_pending)return;
  celebrating=true;try{const r=await api('/onboarding/celebrate',{});if(DB.me?.id!==uid||!r.claimed)return;setup.celebration_pending=false;if(canShow())showWelcome();else welcomePending=uid;}catch{}finally{celebrating=false;}
 }
 function showWelcome(){modal('Tudo pronto','<div class="mt-welcome"><div class="mt-welcome-check" aria-hidden="true">✓</div><h2>Seu painel está pronto!</h2><p>Acompanhe pedidos, campanhas e resultados da sua operação em um só lugar.</p>'+button('Começar a acompanhar','welcome-close','',true)+'</div>');}
 function paginate(total,size=25){return '<div class="pagination"><span>'+total+' registros · Página '+state.page+' de '+Math.max(1,Math.ceil(total/size))+'</span><div class="actions">'+button('‹ Anterior','prev',''+(state.page===1?'disabled':''))+button('Próxima ›','next',state.page*size>=total?'disabled':'')+'</div></div>';}
 function table(headers,rows){return '<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';}
 const select=(id,label,options,value='',attributes='')=>{
  const selected=Array.isArray(value)?value:[value];
  return '<label>'+label+'<select id="'+id+'" '+attributes+'>'+options.map(([k,v])=>'<option value="'+esc(k)+'" '+(selected.includes(k)?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>';
 };
 function ordersFilters(){
  const compact=!observer();
  return '<div class="filters'+(compact?' mt-compact-filters mt-order-filters':'')+'">'+(compact?'<span data-tracking-toolbar></span>':'')+
   '<label class="search"><input id="tracking-search" aria-label="Buscar pedidos" value="'+esc(state.search)+'" placeholder="Pedido, produto ou comprador"></label>'+
   select('filter-status','Status',[['','Todos'],...Object.entries(statusLabel)],state.status)+select('filter-provider','Checkout',[['','Todos'],['custom','API própria'],...checkoutProviders.map(p=>[p,brand.name(p)])],state.provider)+select('filter-channel','Origem',[['','Todas'],['meta','Meta'],['google','Google'],['unattributed','Não atribuído']],state.channel)+select('filter-payment','Pagamento',[['','Todos'],['PIX','Pix'],['CREDIT_CARD','Cartão']],state.payment)+
   (compact?'<div class="mt-filter-actions">'+button('Exportar pedidos','export')+'</div>':button('Filtrar','filter','',true))+'</div>';
 }
 const paymentLabel=method=>({CREDIT_CARD:'Cartão',DEBIT_CARD:'Débito',PIX:'Pix',BOLETO:'Boleto'}[method]||method||'—');
 function orderCards(rows,admin=false){
  return '<ul class="mt-order-cards">'+rows.map(o=>{
   const created=o.created_at?dt(o.created_at):'Data indisponível';
   const attrs=' data-id="'+esc(o.id)+'"'+(admin?' data-workspace="'+esc(o.workspace_id)+'"':'');
   const buyer=o.buyer_name||'Comprador não informado';
   return '<li><button type="button" class="mt-order-card" data-action="'+(admin?'admin-order':'order')+'"'+attrs+' aria-label="'+esc('Abrir pedido '+o.external_id+', '+buyer)+'">'+
    '<span class="mt-order-card-main"><strong>'+esc(buyer)+'</strong><small>'+esc(brand.name(o.provider))+' · #'+esc(o.external_id)+'</small></span>'+
    '<span class="mt-order-card-value"><strong>'+esc(money(o.gross_minor,o.currency,o.amount_scale))+'</strong>'+pill(o.status)+'</span>'+
    '<span class="mt-order-card-meta">'+esc([admin?o.client_name:null,o.payment_method?paymentLabel(o.payment_method):null,created,o.renewal?'Renovação':null].filter(Boolean).join(' · '))+'</span>'+
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></li>';
  }).join('')+'</ul>';
 }
 function syncHeaderActions(){
  const active=!$('tracking-module').hidden&&!observer();
  $('mobile-track-export').hidden=!(active&&state.tab==='orders'&&setup?.checkout_ready);
  $('mobile-track-connections').hidden=!(active&&state.tab==='ads'&&['owner','admin'].includes(workspace()?.role));
 }
 async function loadWorkspaces(){
  if(observer()){workspaces=(await api('/admin/catalog')).rows;state.workspace=null;$('tracking-workspace-label').style.display='none';window.MagemindTrackingBackend?.subscribe('observer',()=>{if(user)markPending();});return;}
  workspaces=await api('/workspaces');if(!workspaces.some(w=>w.id===state.workspace))state.workspace=workspaces[0]?.id||null;
  if(!state.workspace){const created=await api('/workspaces',{name:'Minha operação',currency:'BRL',timezone:'America/Sao_Paulo'});state.workspace=created.id;workspaces=await api('/workspaces');}
  $('tracking-workspace-label').style.display='none';
  window.MagemindTrackingBackend?.subscribe(state.workspace,()=>{if(user)markPending();});
 }
 let sessionReady=null;
 async function ready(){
  if(!DB.me||!window.trackingEnabled())return false;if(sessionReady)return sessionReady;
  if(user?.user_id===DB.me.id&&(state.workspace||observer()))return true;const uid=DB.me.id;
  sessionReady=(async()=>{sessionStarted=Date.now();onboardingExpanded=false;user={user_id:uid,email:DB.me.email};let saved={};try{saved=JSON.parse(localStorage.getItem('mm_tracking_state_'+uid)||'{}');for(const k of ['workspace','from','to'])if(saved[k])state[k]=saved[k];}catch{}
   await loadWorkspaces();if(observer())Object.assign(state,{admin_client:'',admin_sort:'newest',admin_workspace:null});if(DB.me?.id!==uid){clear();return false;}state.simulation_only=workspace()?.simulation_only===true;state.preset=periods.presets.some(p=>p.id===saved.preset)?saved.preset:periods.validRange(saved.from,saved.to)?periods.infer(saved.from,saved.to,Date.now(),workspace()?.timezone):'week';syncInputs();return true;
  })().finally(()=>sessionReady=null);return sessionReady;
 }
 function syncInputs(){state.currency='BRL';if(state.preset!=='custom')Object.assign(state,periods.range(state.preset,Date.now(),workspace()?.timezone||'America/Sao_Paulo'));for(const k of ['from','to','currency'])$('tracking-'+k).value=state[k];$('tracking-period-label').textContent=periods.presets.find(p=>p.id===state.preset)?.label||'Período personalizado';$('tracking-period-dates').textContent=state.from===state.to?dateLabel(state.from):dateLabel(state.from)+' — '+dateLabel(state.to);}
 let renderedScope='',pendingData=false,syncFingerprint='';
 function markPending(){pendingData=true;const label=$('tracking-sync-status');if(label&&['overview','ads','orders'].includes(state.tab)){label.textContent='Novos dados disponíveis · clique em Atualizar';label.classList.remove('is-stale');}}
 function restoreTrackingToolbar(){
  const toolbar=$('tracking-toolbar'),content=$('tracking-content'),refresh=$('tracking-refresh');
  if(refresh.parentElement!==toolbar)$('tracking-sync-status').before(refresh);
  if(toolbar.parentElement!==$('tracking-module'))content.before(toolbar);
  toolbar.removeAttribute('data-inline-filters');
 }
 function replaceContent(el,html){
  const scrolls=[...el.querySelectorAll('.mt-ad-table-scroll')].map(node=>({platform:node.closest('[data-platform]').dataset.platform,left:node.scrollLeft,top:node.scrollTop}));
  const filters=el.querySelector('.mt-compact-filters');
  const expanded=filters?.classList.contains('app-filter-expanded');
  const active=document.activeElement;
  const focus=el.contains(active)&&active.id&&(filters?.contains(active)||active.closest('.mt-platform-tools'))?{id:active.id,value:active.value,start:active.selectionStart,end:active.selectionEnd}:null;
  const toolbar=$('tracking-toolbar');
  if(el.contains(toolbar)){closePeriod();restoreTrackingToolbar();}
  el.innerHTML=html;
  const slot=el.querySelector('[data-tracking-toolbar]');
  toolbar.toggleAttribute('data-inline-filters',Boolean(slot));
  slot?.replaceWith(toolbar);
  el.querySelector('.mt-order-filters .mt-filter-actions')?.prepend($('tracking-refresh'));
  window.MagemindFilters?.enhanceSelects(el);
  syncHeaderActions();
  if(expanded)el.querySelector('.mt-compact-filters')?.classList.add('app-filter-expanded');
  if(focus){
   const target=$(focus.id);
   target?.focus({preventScroll:true});
   if(target?.tagName==='INPUT'&&focus.start!=null){
    if(filterTimer)target.value=focus.value;
    target.setSelectionRange(focus.start,focus.end);
   }
  }
  for(const saved of scrolls){const node=el.querySelector('[data-platform="'+saved.platform+'"] .mt-ad-table-scroll');if(node){node.scrollLeft=saved.left;node.scrollTop=saved.top;}}
 }
 async function render(options={}){
  if(state.tab==='overview'&&window.MagemindDashboard.isEditing())return;
  if(options.quiet&&(document.hidden||$('tracking-dialog').open||periodPopover.isOpen()||document.activeElement?.closest('input,select,textarea,[contenteditable=true],.mm-filter-popover')))return;
  const version=++requestVersion;if(!await ready()||version!==requestVersion)return;syncInputs();persist();
  const nativePage=routes[state.tab],activePage=document.querySelector('.page.active')?.id;
  const subtitles=observer()?{campaigns:'Resultados e campanhas das operações dos clientes',orders:'Pedidos de todos os clientes e responsáveis',integrations:'Cobertura e situação das conexões dos clientes'}:{campaigns:'Desempenho e otimização dos seus anúncios',orders:'Vendas, pagamentos e informações dos compradores',integrations:'Contas de anúncios, checkouts e origem das vendas'};
  for(const [page,text] of Object.entries(subtitles)){const subtitle=$('pg-'+page)?.querySelector('.ph-sub');if(subtitle)subtitle.textContent=text;}
  if(activePage!=='pg-'+nativePage){$('tracking-module').hidden=true;return;}
  const mount=state.tab==='settings'?$('settings-panel-tracking'):$('tracking-'+nativePage+'-mount');
  if(!mount)return;mount.appendChild($('tracking-module'));$('tracking-module').hidden=false;
  const toolbar=$('tracking-toolbar'), el=$('tracking-content'), scope=[DB.me.id,state.tab,state.workspace].join(':');
  toolbar.hidden=['settings','integrations','products'].includes(state.tab);
  toolbar.querySelector('.period-label').textContent=state.tab==='overview'?'Visão geral da sua operação':'Período e filtros da operação';
  if(renderedScope!==scope)restoreTrackingToolbar();
  if(state.tab==='overview'){
   if(toolbar.parentElement!==$('dashboard-toolbar-mount'))$('dashboard-toolbar-mount').append(toolbar);
  }else if(renderedScope!==scope||!el.contains(toolbar)){
   restoreTrackingToolbar();
  }
  if(!el.childElementCount||renderedScope!==scope)el.innerHTML='<div class="stats-grid">'+[1,2,3,4].map(()=>'<div class="skeleton" aria-label="Carregando"></div>').join('')+'</div>';
  renderedScope=scope;
  try{const uid=DB.me.id;if(observer()){
   $('tracking-workspace-label').style.display='none';$('tracking-toolbar').removeAttribute('inert');$('tracking-toolbar').querySelector('.period-label').textContent='Acompanhamento das operações';
   const html=await window.MagemindTrackingAdmin.render({state,api,esc,money,dt,brand,button,select,table,pill,paginate,ads,ordersFilters,orderCards,detail,modal,render,goTo,setCatalog:rows=>{workspaces=rows;},catalog:()=>workspaces,selectOperation:op=>{state.workspace=op?.id||null;state.admin_workspace=op?.id||null;state.simulation_only=op?.simulation_only===true;state.search='';state.status='';state.provider='';state.page=1;}});
   if(version===requestVersion&&DB.me?.id===uid){replaceContent(el,html);pendingData=false;syncFingerprint='';syncStatus(version).catch(()=>{});}return;
  }const status=await api('/onboarding');if(version!==requestVersion||DB.me?.id!==uid)return;setup=status;const html=await ({overview,orders,products:productList,ads,integrations,settings})[state.tab]();if(version!==requestVersion||DB.me?.id!==uid||state.tab==='overview'&&window.MagemindDashboard.isEditing())return;replaceContent(el,html);pendingData=false;syncFingerprint='';syncStatus(version).catch(()=>{});if(state.tab==='overview')window.MagemindDashboard.mount();$('tracking-toolbar').toggleAttribute('inert',Boolean(el.querySelector('.mt-connection-gate')));maybeCelebrate();}
  catch(e){if(version===requestVersion&&user)replaceContent(el,'<div class="error-state"><h2>Não foi possível carregar</h2><p>'+esc(e.message)+'</p>'+button('Tentar novamente','refresh')+'</div>');if(options.propagate)throw e;}
 }
 async function syncStatus(version){
  const label=$('tracking-sync-status');if(!label)return;
  if(!['overview','ads','orders'].includes(state.tab)){label.textContent='';return;}
  if(observer()){if(pendingData)markPending();else label.textContent='';return;}
  const rows=(await api('/integrations')).filter(i=>i.connected&&['meta','google','tiktok'].includes(i.provider)&&!i.account_id.startsWith('oauth:'));
  if(version!==requestVersion)return;
  const fingerprint=JSON.stringify(rows.map(i=>[i.id,i.last_sync_at,i.error_code,i.management_access]).sort());
  if(syncFingerprint&&syncFingerprint!==fingerprint){
   const focused=document.activeElement?.matches('input,select,textarea,button,[contenteditable=true]');
   if(state.tab==='ads'&&!document.hidden&&!focused&&!$('tracking-dialog').open&&!periodPopover.isOpen()&& !filterTimer){
    void render({quiet:true});
    return;
   }
   markPending();
  }
  syncFingerprint=fingerprint;
  if(!rows.length){if(pendingData)markPending();else label.textContent='';label.classList.remove('is-stale');return;}
  const issues=rows.map(i=>window.MagemindIntegrationHealth.integrationHealth(i)).filter(i=>['authorization','temporary','error'].includes(i.kind));
  const blocked=issues.some(i=>i.kind==='authorization'),failed=issues.length>0,queued=rows.some(i=>i.error_code==='sync_requested');
  const oldest=Math.min(...rows.map(i=>i.last_sync_at?new Date(i.last_sync_at).getTime():0));
  const stale=rows.some(i=>!i.last_sync_at||Date.now()-new Date(i.last_sync_at).getTime()>Math.max(180,(i.sync_interval_seconds||600)*2)*1000);
  label.classList.toggle('is-stale',blocked||failed||stale);
  const updated=oldest?'Atualizado às '+new Date(oldest).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:workspace()?.timezone||'America/Sao_Paulo'}):'Aguardando sincronização';
  label.textContent=queued&&!failed?'Sincronização solicitada':failed&&state.tab!=='ads'?issues[0].label:stale?'Última sincronização · '+(oldest?dt(oldest):'aguardando dados'):updated;
  if(pendingData&&!blocked&&!failed&&!queued)markPending();
  label.title=failed?issues[0].action:updated;
 }
 let refreshingAds=false;
 async function refreshData(options={}){
  if(refreshingAds||window.MagemindDashboard.isEditing())return;
  refreshingAds=true;$('tracking-refresh').setAttribute('aria-busy','true');$('tracking-refresh').disabled=true;
  try{if(await ready()&&!observer()&&['overview','ads'].includes(state.tab)&&state.workspace&&window.MagemindTrackingBackend?.edge)await window.MagemindTrackingBackend.edge({action:'queue_ads_sync',workspace:state.workspace});await render();}
  catch(e){if(options.propagate)throw e;toast(e.message);}finally{refreshingAds=false;$('tracking-refresh').removeAttribute('aria-busy');$('tracking-refresh').disabled=false;}
 }
 function route(page){adDetailRequest++;$('mobile-track-export').hidden=true;$('mobile-track-connections').hidden=true;closePeriod();clearTimeout(filterTimer);filterTimer=0;if(page!=='dashboard')restoreTrackingToolbar();if(page!=="dashboard")window.MagemindDashboard.leave();if(!window.trackingEnabled()||observer()&&['settings','dashboard','products'].includes(page)){$('tracking-module').hidden=true;return;}const tab=Object.keys(routes).find(k=>routes[k]===page);requestVersion++;if(!tab){$('tracking-module').hidden=true;return;}if(state.tab!==tab){state.page=1;state.search='';state.provider='';state.status='';if(observer()){state.admin_workspace=null;state.workspace=null;state.admin_sort=tab==='ads'?'spend':'newest';}}state.tab=tab;render();}
 async function overview(){
  const uid=user.user_id,w=state.workspace,[data,series]=await Promise.all([api('/dashboard'),api('/revenue-series')]);data.revenue_series=series;
  if(user?.user_id!==uid||state.workspace!==w||window.MagemindDashboard.isEditing())return '';
  return tutorialHTML()+await window.MagemindDashboard.render({data,demands:DB.demands,setup,userId:uid,workspace:w});
 }
 function chartHTML(rows){
  const width=600,height=180,max=Math.max(1,...rows.map(x=>Number(x.gross_minor)));
  const points=rows.map((r,i)=>[20+i*(560/Math.max(1,rows.length-1)),160-Number(r.gross_minor)/max*135]);
  rows=rows.map(r=>({...r,date:String(r.date).slice(0,10)}));
  const line=points.map(([x,y])=>x+','+y).join(' ');
  return '<svg class="chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Receita aprovada por dia"><defs><linearGradient id="tracking-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".25"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="M20 160H580 M20 115H580 M20 70H580 M20 25H580" stroke="var(--border2)" fill="none"/><polygon points="20,160 '+line+' 580,160" fill="url(#tracking-chart-fill)"/><polyline points="'+line+'" stroke="var(--accent)" stroke-width="2.5" fill="none"/>'+points.map(([x,y],i)=>'<circle cx="'+x+'" cy="'+y+'" r="4" fill="var(--accent)"><title>'+esc(rows[i].date+': '+money(rows[i].gross_minor))+'</title></circle>').join('')+'</svg><div class="legend"><span>'+esc(rows[0].date)+'</span><span>Receita bruta de pedidos · '+esc(state.currency)+'</span><span>'+esc(rows.at(-1).date)+'</span></div>';
 }
 async function orders(){
  if(!setup.checkout_ready)return connectionGate('orders',['kiwify','hotmart','cartpanda'],
   'Conecte seu checkout','Receba seus pedidos e acompanhe vendas e pagamentos por aqui.','setup-checkouts');
  const data=await api('/list/orders',null,{search:state.search,status:state.status,provider:state.provider,channel:state.channel,payment:state.payment});
  return ordersFilters()+panel('Todos os pedidos',data.rows.length?orderCards(data.rows)+table(['Pedido / checkout','Comprador','Status','Pagamento','Valor','Origem','Criado',''],data.rows.map(o=>'<tr><td>'+esc(o.external_id)+'<small>'+esc(o.provider)+'</small></td><td>'+esc(o.buyer_name||'Não informado')+'</td><td>'+pill(o.status)+(o.renewal?' <small>Renovação</small>':'')+'</td><td>'+esc(o.payment_method==='CREDIT_CARD'?'Cartão':o.payment_method==='PIX'?'Pix':o.payment_method||'—')+'</td><td>'+money(o.gross_minor)+'</td><td>'+esc(o.channel==='unattributed'?'Não atribuído':o.channel||'—')+'</td><td>'+dt(o.created_at)+'</td><td>'+button('Detalhes','order','data-id="'+esc(o.id)+'"')+'</td></tr>'))+paginate(data.total):'<p>Nenhum pedido encontrado. Ajuste a busca ou conecte seu checkout em Integrações.</p>');
 }

 const adLevels={campaign:['Campanhas','Campanha'],group:['Conjuntos / grupos','Conjunto / grupo'],ad:['Anúncios','Anúncio']};
 const adMetrics=[['spend_minor','Valor gasto'],['checkout_purchases','Vendas'],['cpa','CPA'],['impressions','Impressões'],['clicks','Cliques'],['ctr','CTR']];
 function adToggle(r,account){
   const canManage=!observer()&&['owner','admin'].includes(workspace()?.role);
   const health=window.MagemindIntegrationHealth.integrationHealth(account);
   const active=r.status==='ACTIVE',label=active?'Ativo':'Pausado';
   const unavailable=r.provider_status&&!['ACTIVE','PAUSED'].includes(r.provider_status);
   if(unavailable)return '<span class="pill">'+(r.provider_status==='ARCHIVED'?'Arquivado':r.provider_status==='DELETED'?'Excluído':'Indisponível')+'</span>';
   if(observer())return '<span class="pill '+(active?'paid':'pending')+'">'+label+'</span>';
   const disabled=!canManage||!r.connected||health.kind==='authorization'||account?.management_access===false||
    (r.mode!=='simulated'&&!(pilot&&r.provider==='meta'));
   const title=health.kind==='authorization'?health.action:account?.management_access===false?'Somente leitura. Confira as permissões em Conexões.':'';
   return '<button type="button" class="status-switch" role="switch" aria-label="'+(active?'Desativar ':'Ativar ')+esc(r.name)+'" aria-checked="'+active+'" data-action="ad-status" data-provider="'+esc(r.provider)+'" data-account="'+esc(r.account_id)+'" data-entity="'+esc(r.entity_id)+'" data-status="'+(active?'PAUSED':'ACTIVE')+'" data-revision="'+r.revision+'" '+(disabled?'disabled ':'')+(title?' title="'+esc(title)+'"':'')+'><span aria-hidden="true"></span>'+label+'</button>';
 }
  const number=n=>n==null?'—':Number(n).toLocaleString('pt-BR');
  const adCurrency=row=>row.account_currency||state.currency;
  const adMoneyMetric=key=>key==='spend_minor'||key==='cpa';
  const adValue=(r,k)=>k==='cpa'?(r.checkout_purchases&&r.spend_minor!=null?r.spend_minor/r.checkout_purchases:null):k==='ctr'?(r.impressions&&r.clicks!=null?r.clicks/r.impressions*100:null):r[k];
  function adFormat(row,key){
   const value=adValue(row,key);
   if(value==null)return '—';
   if(adMoneyMetric(key))return money(Math.round(value),adCurrency(row));
   if(key==='ctr')return value.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
   return number(value);
  }
 function adDetailButton(row){
  return button(esc(row.name)+'<span aria-hidden="true"> ›</span>','ad-detail',
   'data-provider="'+esc(row.provider)+'" data-account="'+esc(row.account_id)+'" data-entity="'+esc(row.entity_id)+'"');
 }
 function metaEditorUrl(row){
  const account=/^act_(\d+)$/.exec(row.account_id);
  if(!account||row.provider!=='meta'||!/^\d+$/.test(row.entity_id))return null;
  const [tab,param]={campaign:['campaigns','selected_campaign_ids'],group:['adsets','selected_adset_ids'],ad:['ads','selected_ad_ids']}[row.level];
  const url=new URL('https://adsmanager.facebook.com/adsmanager/manage/'+tab);
  url.search=new URLSearchParams({act:account[1],[param]:row.entity_id});
  return url.href;
 }
 async function adDetail(provider,accountId,entityId){
  const w=state.workspace,request=++adDetailRequest;
  const [report,integrations]=await Promise.all([api('/ad-management'),api('/integrations')]);
  if(request!==adDetailRequest||state.workspace!==w||state.tab!=='ads')return;
  const rows=report.rows.filter(r=>r.provider===provider&&r.account_id===accountId&&r.connected);
  const row=rows.find(r=>r.entity_id===entityId);
  if(!row)throw Error('Este item não está disponível na conta de anúncios conectada.');
  const integration=integrations.find(i=>i.provider===provider&&i.account_id===accountId&&i.connected);
  const parent=rows.find(r=>r.entity_id===row.parent_id);
  const children=rows.filter(r=>r.parent_id===row.entity_id);
  const next=row.level==='campaign'?'group':row.level==='group'?'ad':null;
  const groupTitle=next==='group'?'Conjuntos de anúncios':'Anúncios';
  const kind=adLevels[row.level][1];
  const editUrl=!observer()&&['owner','admin'].includes(workspace()?.role)?metaEditorUrl(row):null;
  const editingScope={campaign:'Nome, orçamento e estratégia da campanha.',group:'Público, posicionamentos, orçamento e calendário do conjunto.',ad:'Criativo, texto e destino do anúncio.'};
  const attrs='data-provider="'+esc(provider)+'" data-account="'+esc(accountId)+'" data-entity="'+esc(entityId)+'" data-level="'+row.level+'"';
  modal(row.name,'<div class="mt-ad-detail"><div class="mt-ad-detail-lead"><div><strong>'+esc(kind)+'</strong><small>'+esc(brand.name(provider))+' · '+esc(integration?.name||accountId)+'</small></div>'+adToggle(row,integration)+'</div>'+
   (parent?'<p class="mt-ad-parent">'+adDetailButton(parent)+'</p>':'')+
   '<section class="mt-ad-detail-card"><header><h3>Resultados</h3><small>'+esc($('tracking-period-dates').textContent)+'</small></header>'+
   '<dl class="mt-ad-detail-metrics">'+adMetrics.map(([key,label])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(adFormat(row,key))+'</dd></div>').join('')+'</dl></section>'+
   (editUrl?'<section class="mt-ad-detail-card"><h3>Configuração</h3><p>'+editingScope[row.level]+'</p><a class="btn btn-ghost" href="'+esc(editUrl)+'" target="_blank" rel="noopener noreferrer">Editar na Meta <span aria-hidden="true">↗</span></a></section>':'')+
   (next?'<section class="mt-ad-detail-card"><header><h3>'+groupTitle+'</h3><small>'+children.length+'</small></header>'+
    (children.length?'<ul class="mt-ad-detail-children">'+children.slice(0,8).map(child=>'<li>'+adDetailButton(child)+'<small>'+esc(adFormat(child,'spend_minor'))+' · '+esc(child.effective_active?'Ativo':'Sem veiculação')+'</small></li>').join('')+'</ul>'+
    button('Ver '+groupTitle.toLowerCase()+' na lista','ad-drill',attrs):'<p>Nenhum item vinculado foi encontrado.</p>')+'</section>':'')+'</div>');
 }
 async function ads(){
  const [d,opts,integrations]=await Promise.all([api('/ad-management'),api('/ad-options'),api('/integrations')]);
  const connected=integrations.filter(i=>adProviders.includes(i.provider)&&i.connected&&!i.account_id.startsWith('oauth:'));
  const canManage=!observer()&&['owner','admin'].includes(workspace()?.role);
  if(observer()&&!connected.length)return '<div class="mt-admin-empty"><div class="mt-connect-brands">'+adProviders.map(p=>brand.logo(p)).join('')+'</div><h3>Esta operação ainda não tem contas de anúncios conectadas</h3><p>As campanhas aparecerão aqui quando o responsável conectar uma conta.</p></div>';
  const platformHeading=p=>brand.logo(p)+'<h2>'+brand.name(p)+'</h2>';
  if(!connected.length)return connectionGate('campaign',adProviders,
   'Conecte sua conta de anúncios','Veja suas campanhas, acompanhe os resultados e gerencie os anúncios por aqui.','setup-ads');
  const query=state.search.toLocaleLowerCase('pt-BR');
  const rows=d.rows.filter(r=>r.connected&&(!query||r.name.toLocaleLowerCase('pt-BR').includes(query)));
  const groups=adProviders.map(p=>{
   const heading=platformHeading(p);
   if(!connected.some(i=>i.provider===p)){
    if(observer())return '';
    const cta=p==='meta'?(canManage?button('Conectar conta','campaign-link'):''):'<span class="mt-coming-soon">Em breve</span>';
    return '<section class="mt-platform-group mt-platform-'+p+' mt-ad-manager" data-platform="'+p+'">'+
     '<div class="mt-platform-heading">'+heading+cta+'</div></section>';
   }
   const view=campaignView(p);
   const {level,sort,direction}=view;
   const [plural,singular]=adLevels[level];
   const parent=d.rows.find(r=>r.provider===p&&r.entity_id===view.parent&&r.account_id===view.account);
   const cols=[['name',singular],...adMetrics];
   const compare=(a,b)=>{
    const x=adValue(a,sort),y=adValue(b,sort);
    if(x==null||y==null)return x==null?(y==null?0:1):-1;
    if(adMoneyMetric(sort)&&adCurrency(a)!==adCurrency(b))return adCurrency(a).localeCompare(adCurrency(b));
    return (typeof x==='string'?x.localeCompare(y,'pt-BR'):Number(x)-Number(y))*(direction==='asc'?1:-1)||a.name.localeCompare(b.name,'pt-BR');
   };
   const accounts=connected.filter(item=>item.provider===p);
   const selected=view.accountIds.filter(id=>accounts.some(a=>a.account_id===id));
   const entries=rows.filter(r=>r.provider===p&&r.level===level
    &&(!selected.length||selected.includes(r.account_id))
    &&(!view.delivery||(view.delivery==='ACTIVE'?r.effective_active:!r.effective_active))
    &&(!parent||(r.parent_id===parent.entity_id&&r.account_id===parent.account_id))).sort(compare);
   const countLabel=entries.length===1?singular:plural;
   const totals={};
   for(const key of ['checkout_purchases','impressions','clicks'])totals[key]=entries.every(row=>row[key]==null)?null:entries.reduce((sum,row)=>sum+Number(row[key]??0),0);
   const totalsByCurrency=new Map();
   for(const row of entries){
    const currency=adCurrency(row);
    if(!totalsByCurrency.has(currency))totalsByCurrency.set(currency,{account_currency:currency,spend_minor:null,checkout_purchases:0});
    const subtotal=totalsByCurrency.get(currency);
    if(row.spend_minor!=null)subtotal.spend_minor=(subtotal.spend_minor??0)+Number(row.spend_minor);
    subtotal.checkout_purchases+=Number(row.checkout_purchases??0);
   }
   const currencyTotals=[...totalsByCurrency.values()].sort((a,b)=>adCurrency(a).localeCompare(adCurrency(b)));
   const formatTotal=key=>{
    if(!adMoneyMetric(key))return esc(adFormat(totals,key));
    return currencyTotals.filter(row=>adValue(row,key)!=null)
     .map(row=>'<span class="mt-ad-money-total">'+esc(adFormat(row,key))+'</span>').join('')||'—';
   };
   const account=r=>opts.accounts.find(a=>a.provider===r.provider&&a.account_id===r.account_id)?.name||r.account_id;
   const metricCells=format=>adMetrics.map(([key,label])=>'<td role="cell" data-label="'+esc(label)+'">'+format(key)+'</td>').join('');
   const tabs='<div class="mt-level-tabs mt-manager-tabs" role="group" aria-label="Nível dos anúncios · '+brand.name(p)+'">'+
    Object.entries(adLevels).map(([key,[label]])=>'<button class="quiet" type="button" id="ad-level-'+p+'-'+key+'" data-action="ad-level" data-level="'+key+'" aria-pressed="'+(level===key)+'">'+label+'</button>').join('')+'</div>';
   const sortOptions=cols.flatMap(([key,label])=>[[key+':desc',label+' ↓'],[key+':asc',label+' ↑']]);
   const mobileSort='<div class="mt-ad-mobile-sort">'+select('ad-mobile-sort-'+p,'<span class="sr-only">Ordem</span>',sortOptions,sort+':'+direction,'data-trigger-label="Ordem"')+'</div>';
   const accountOptions=[['','Todas'],...accounts.map(item=>[item.account_id,item.name||item.account_id])];
   const accountFilter='<div class="mt-ad-accounts">'+select('ad-accounts-'+p,'<span class="sr-only">Contas</span>',accountOptions,selected.length?selected:'','multiple data-multi-filter')+'</div>';
   const filters='<div class="mt-ad-controls">'+mobileSort+accountFilter+
    '<div class="mt-ad-delivery">'+select('ad-delivery-'+p,'<span class="sr-only">Veiculação</span>',[['','Todas'],['ACTIVE','Ativa'],['PAUSED','Pausada']],view.delivery,'data-empty-label="Veiculação"')+'</div></div>';
   const breadcrumb=parent?'<div class="mt-ad-breadcrumb"><span>'+esc(parent.name)+'</span>'+button('Limpar seleção','ad-clear')+'</div>':'';
   return '<section class="mt-platform-group mt-platform-'+p+' mt-ad-manager" data-platform="'+p+'">'+
    '<header class="mt-platform-heading">'+heading+'<span class="mt-platform-count">'+entries.length+' '+countLabel.toLowerCase()+'</span></header>'+
    '<div class="mt-platform-tools">'+tabs+filters+breadcrumb+'</div>'+
    (entries.length?'<div class="mt-ad-table-scroll" tabindex="0" role="region" aria-label="'+plural+' · '+brand.name(p)+'">'+
    '<table class="mt-ad-table" role="table" data-mobile-table="scroll"><thead role="rowgroup"><tr role="row"><th scope="col">Veiculação</th>'+
     cols.map(([key,label])=>'<th scope="col" aria-sort="'+(sort===key?(direction==='asc'?'ascending':'descending'):'none')+'">'+
      '<button type="button" data-action="ad-sort" data-sort="'+key+'">'+label+' <span aria-hidden="true">'+(sort===key?(direction==='asc'?'↑':'↓'):'↕')+'</span></button></th>').join('')+
    '</tr></thead><tbody role="rowgroup">'+entries.map(r=>'<tr role="row" class="mt-ad-row"><td role="cell" class="mt-ad-state">'+adToggle(r,connected.find(i=>i.provider===r.provider&&i.account_id===r.account_id))+
      (r.status==='ACTIVE'&&!r.effective_active?'<small>Campanha ou conjunto pausado</small>':'')+'</td>'+
      '<td role="cell" class="mt-ad-name">'+adDetailButton(r)+
      '<small>'+esc(account(r))+'</small></td>'+metricCells(key=>esc(adFormat(r,key)))+'</tr>').join('')+
    '</tbody><tfoot role="rowgroup"><tr role="row"><td role="cell"></td><th scope="row" title="Soma das linhas filtradas. CPA e CTR são calculados sobre os totais.">Total · '+entries.length+'</th>'+
      metricCells(formatTotal)+'</tr></tfoot></table></div>':'<p class="mt-platform-empty">Nenhum resultado para os filtros selecionados.</p>')+'</section>';
  }).join('');
  const compact=!observer();
  return '<div class="filters mt-ad-filters'+(compact?' mt-compact-filters':'')+'">'+(compact?'<span data-tracking-toolbar></span>':'')+
    '<label class="search"><input id="tracking-search" type="search" aria-label="Pesquisar campanha, conjunto ou anúncio" value="'+esc(state.search)+'" placeholder="Pesquisar campanha, conjunto ou anúncio"></label>'+
    (compact?(canManage?'<div class="mt-filter-actions">'+connections.campaignControl(connected)+'</div>':''):button('Aplicar','filter'))+
    '</div>'+groups;
 }
 function integrationRecord(i){
  const p=i.provider,checkout=checkoutProviders.includes(p);
  const health=window.MagemindIntegrationHealth.integrationHealth(i);
  const problem=!['healthy','queued','disconnected'].includes(health.kind);
  const status=problem?health.label:!i.connected?'Desconectado':i.error_code==='sync_requested'?'Sincronizando':checkout&&!i.last_received_at?'Aguardando pedidos':'Conectado';
  const attrs='data-id="'+esc(i.id)+'"';
  const reconnect='data-provider="'+esc(p)+'"';
  const access=checkout?button('Ver webhook','webhook-details',attrs):p==='custom'?button('Credencial da API','token',attrs):button('Sincronizar','sync',attrs);
  return '<div class="list-row"><span>'+esc(i.name||brand.name(p))+'<small><br>'+esc(checkout?'Último pedido recebido: ':'Última atualização: ')+
   dt(i.last_received_at||i.last_sync_at)+'</small></span>'+pill(status)+'</div>'+
   (problem?'<div class="mt-integration-diagnostic" role="status"><strong>'+esc(health.reason)+'</strong><p>'+esc(health.action)+'</p></div>':'')+
   '<div class="actions">'+(i.connected?access+(health.kind==='authorization'?button('Renovar acesso','connect',reconnect):'')+
    button('Desconectar','disconnect',attrs):button('Reconectar','connect',reconnect))+'</div>';
 }
 async function checkoutConnection(provider){
  if(!checkoutProviders.includes(provider))return;
  const w=state.workspace;
  const rows=(await api('/integrations')).filter(i=>i.provider===provider);
  if(state.workspace!==w||state.tab!=='integrations')return;
  if(!rows.length)throw Error('A conexão deste checkout não está disponível.');
  modal(brand.name(provider),'<div class="mt-connections-panel mt-checkout-detail">'+rows.map(integrationRecord).join('')+'</div>');
 }
 async function integrations(){
  const data=await api('/integrations');
  const card=p=>{
   const rows=data.filter(i=>i.provider===p),checkout=checkoutProviders.includes(p);
   const heading='<div class="mt-integration-brand">'+brand.logo(p)+'<h3>'+brand.name(p)+'</h3></div>';
   if(p==='meta')return '<article class="integration-card mt-integration-meta">'+heading+connections.metaIntegrationCard(rows,['owner','admin'].includes(workspace()?.role))+'</article>';
   if(!checkout&&p!=='custom')return '<article class="integration-card mt-integration-'+p+'">'+heading+'<div class="actions"><span class="mt-integration-soon">Em breve</span></div></article>';
   const attrs='data-provider="'+esc(p)+'"';
   const body=rows.length?rows.map(integrationRecord).join(''):'<div class="actions">'+button('Conectar','connect',attrs,true)+'</div>';
   const compact=rows.some(i=>i.connected)?button('Gerenciar','checkout-connection',attrs):
    rows.length?button('Reconectar','connect',attrs):button('Conectar','connect',attrs,true);
   return '<article class="integration-card mt-integration-'+p+'">'+heading+
    (checkout?'<div class="mt-checkout-full">'+body+'</div><div class="mt-checkout-compact">'+compact+'</div>':
     '<p>Pedidos enviados pela API da sua operação.</p>'+body)+'</article>';
  };
  return brand.integrationSections(card)+panel('Origem das vendas','<div class="mt-sales-origin"><p>UTMs identificam o anúncio que originou cada pedido. O script próprio permite acompanhar também as visitas e etapas do funil.</p><div class="actions">'+button('Script e UTMs','sites')+button('Selecionar produtos','products')+'</div></div>');
 }
 const catalogContext=()=>({
  state,api,esc,money,dt,brand,button,select,paginate,modal,toast,render,
  costForm,minorInput,scale,hasCheckout:setup?.has_checkout,canWrite:['owner','admin'].includes(workspace()?.role),
  edge:(action,data)=>window.MagemindTrackingBackend.edge({action,workspace:state.workspace,...data})
 });
 const productList=()=>catalog.render(catalogContext());
 async function costs(){
  costRules=await api('/costs');
  const labels={product:'Custo do produto',tax:'Imposto',fee:'Taxa de pagamento',expense:'Custo adicional'};
  const calculation=r=>r.fee_schedule?fees.description(r,money):r.calculation==='percentage'?Number(r.rate_bps)/100+'% sobre vendas aprovadas':r.calculation==='fixed_per_item'?money(r.amount_minor,r.currency)+' por unidade':r.calculation==='fixed_per_sale'?money(r.amount_minor,r.currency)+' por venda':r.calculation==='fixed_once'?money(r.amount_minor,r.currency)+' · despesa registrada':(r.amount_minor!=null?money(r.amount_minor,r.currency):'')+(r.rate_bps?' + '+Number(r.rate_bps)/100+'%':'');
  const rows=costRules.filter(r=>costHistory||!r.archived_at).map(r=>{
   const data='data-id="'+esc(r.id)+'"';
   return {name:esc(r.name),type:esc(labels[r.category]),value:esc(calculation(r)),scope:esc(r.product_id||'Todos os produtos'),
    checkout:esc((r.provider?brand.name(r.provider):'Todos os checkouts')+' · '+r.currency),
    status:pill(r.archived_at?'Encerrado':'Ativo'),
    actions:r.archived_at?'<small>Histórico preservado</small>':'<div class="actions">'+button('Editar','cost-edit',data)+button('Remover','cost-remove',data)+'</div>'};
  });
  const cards='<ul class="mt-cost-cards">'+rows.map(r=>'<li class="mt-cost-card"><div class="mt-cost-card-main"><strong>'+r.name+'</strong>'+r.status+'</div>'+
   '<div class="mt-cost-card-value">'+r.value+'</div><div class="mt-cost-card-foot"><div><small>'+r.type+' · '+r.checkout+'</small><small>'+r.scope+'</small></div>'+r.actions+'</div></li>').join('')+'</ul>';
  const desktop=table(['Custo','Tipo','Cálculo','Aplicado a','Status',''],rows.map(r=>'<tr><td>'+r.name+'</td><td>'+r.type+'</td><td>'+r.value+
   '</td><td>'+r.scope+'<small>'+r.checkout+'</small></td><td>'+r.status+'</td><td>'+r.actions+'</td></tr>'));
  return '<div class="mt-cost-toolbar"><p class="small">As alterações valem para as próximas aprovações. Os custos das vendas anteriores ficam preservados.</p>'+
   '<div class="mt-cost-toolbar-actions">'+button('Adicionar custo','cost-form','',true)+button(costHistory?'Mostrar apenas ativos':'Ver histórico','cost-history','aria-pressed="'+costHistory+'"')+'</div></div>'+
   panel(costHistory?'Histórico de custos':'Custos ativos',rows.length?cards+desktop:'<p>Adicione um custo para acompanhar seu lucro.</p>');
 }

 async function settings(){
  const uid=user.user_id,s=await api('/settings'),p=s.preferences;
  if(DB.me?.id!==uid)return '';
  $('tracking-notifications-mount').innerHTML=panel('Notificações de pedidos','<p>Escolha as atualizações da central. Os avisos no aparelho usam a ativação de notificações deste dispositivo.</p><form data-form="preferences" class="form-grid">'+notificationPreferences.map(([key,label])=>'<label class="checkbox"><input type="checkbox" name="'+key+'" '+(p[key]?'checked':'')+'>'+label+'</label>').join('')+'<button class="primary wide">Salvar preferências</button></form>');
  return costs();
 }
 async function detail(id,workspaceId=state.workspace){
  const d=await api(observer()?'/admin/order':'/order',null,{id,workspace_id:workspaceId}),o=d.order,a=d.attribution||{};
  const dt=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:workspaces.find(w=>w.id===o.workspace_id)?.timezone||'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'Ainda não recebida';
  const money=n=>n==null?'Indisponível':new Intl.NumberFormat('pt-BR',{style:'currency',currency:o.currency}).format(Number(n)/10**o.amount_scale);
  modal('Pedido '+o.external_id,'<div class="mt-order-detail">'+pill(o.status)+'<dl class="detail-grid">'+Object.entries({'Checkout':o.provider,'Pagamento':o.payment_method==='CREDIT_CARD'?'Cartão'+(o.installments?' · '+o.installments+'×':''):o.payment_method==='PIX'?'Pix':o.payment_method||'Indisponível','Bruto':money(o.gross_minor),'Receita do usuário':money(o.recipient_minor),'Devolvido':money(o.refund_minor),'Comprador':o.buyer_name||'Indisponível','E-mail':o.buyer_email||'Indisponível','Telefone':o.buyer_phone||'Indisponível','Criado':dt(o.created_at),'Aprovado':dt(o.approved_at),'Origem':a.channel||'Não atribuído','Evidência':a.evidence||'Indisponível','Anúncio':a.ad_id||'Sem anúncio validado','Confiança':a.confidence||'Baixa'}).map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>'+(o.money_components?.manual_fees?'<p class="mt-cost-explanation">A loja informou o valor bruto. O resultado é estimado com as taxas e os custos cadastrados na sua conta.</p>':'')+'<h3>Itens</h3>'+table(['Produto','Quantidade','Total da linha'],d.items.map(i=>'<tr><td>'+esc(i.name)+'</td><td>'+i.quantity+'</td><td>'+money(i.amount_minor)+'</td></tr>'))+'<h3>Origem da venda</h3><p>'+esc(a.channel==='unattributed'?'Não atribuído':a.channel||'Não informado')+' · '+esc(a.utm_campaign||'Sem campanha informada')+'</p><h3>Histórico auditável</h3><ul class="timeline">'+d.history.map(e=>'<li>'+dt(e.occurred_at)+'<strong>'+esc(statusLabel[e.status])+' · '+esc(e.processing)+'</strong><small>'+esc(e.reason||e.event_key)+'</small></li>').join('')+'</ul></div>');
 }
 async function customerDetail(id){
  const d=await api('/customer',null,{id});modal(d.customer.name||'Comprador','<p>'+esc(d.customer.email||'E-mail não informado')+' · '+esc(d.customer.phone||'Telefone não informado')+'</p>'+table(['Pedido','Status','Moeda','Total',''],d.orders.map(o=>'<tr><td>'+esc(o.external_id)+'</td><td>'+pill(o.status)+'</td><td>'+esc(o.currency)+'</td><td>'+esc(Number(o.gross_minor)/10**o.amount_scale)+'</td><td>'+button('Abrir','order','data-id="'+esc(o.id)+'"')+'</td></tr>'))+'<p class="small">Até 25 compras recentes. Identidade canônica '+esc(d.customer.provider)+' / '+esc(d.customer.external_id)+'.</p>');
 }
 async function sitesForm(){
  const sites=await api('/sites');
  modal('Script próprio e UTMs','<form data-form="site" class="form-grid"><label>Domínio do seu site<input name="domain" value="'+esc(location.hostname)+'" required></label><label>Domínios dos checkouts (vírgula)<input name="checkout_domains" value="pay.kiwify.com.br,pay.hotmart.com"></label><button class="primary wide">Cadastrar domínio</button></form>'+sites.map(s=>'<h3>'+esc(s.domain)+'</h3><pre class="code">'+esc('<script src="'+location.origin+'/magemind-collect-v1.js" data-endpoint="'+location.origin+cfg.apiBase+'/collect" data-site="'+s.public_key+'" data-checkouts="'+s.checkout_domains.join(',')+'" data-consent="denied"></script>')+'</pre><p class="small">Conceda consentimento pela API MagemindCollect.consent(true). Sem consentimento, nenhuma persistência ou envio ocorre.</p>').join('')+'<h3>Meta Ads</h3><pre class="code">utm_source=meta&amp;utm_medium=paid_social&amp;utm_campaign={{campaign.id}}&amp;utm_term={{adset.id}}&amp;utm_content={{ad.id}}</pre><h3>Google Ads</h3><pre class="code">utm_source=google&amp;utm_medium=cpc&amp;utm_campaign={campaignid}&amp;utm_term={adgroupid}&amp;utm_content={creative}</pre><p class="small">A ponte de click_id usa sck apenas se vazio e preserva valores legados. Confirme a devolução desse campo pelo checkout. Macros indisponíveis em um formato não são inventadas.</p>');
 }
 async function configureFee(integration,finish){
  const rules=await api('/costs');
  const row=rules.find(r=>r.integration_id===integration.id&&!r.archived_at);
  return costForm(row,{integration,finish});
 }
 function finishCostFlow(){
  const finish=costFlow?.finish;
  costFlow=null;
  $('tracking-dialog').close();
  return finish?.();
 }
 async function costForm(row=null,flow=null,product=null){
  costFlow=flow;
  costProducts=product?[product]:flow?[]:await api('/cost-products');
  const integration=flow?.integration;
  const category=row?.category||(integration?'fee':product?'product':'');
  const legacyFee=category==='fee'&&row&&!row.fee_schedule;
  const mode=row?.calculation==='legacy'?(category==='tax'?'percentage':category==='product'?'fixed_per_item':row.rate_bps?'percentage':'fixed_per_sale'):row?.calculation||'fixed_per_item';
  const known=costProducts.findIndex(p=>p.product_id===(product||row)?.product_id&&p.provider===(product||row)?.provider&&p.currency===(product||row)?.currency);
  const currency=product?.currency||row?.currency||(integration?'BRL':workspace()?.currency||state.currency);
  const provider=product?.provider||integration?.provider||row?.provider||'';
  const decimal=(value,digits)=>value==null?'':(Number(value)/10**digits).toFixed(digits).replace('.',',');
  const header=integration?'<div class="mt-fee-integration wide">'+brand.logo(provider)+'<div><strong>'+esc(integration.name)+'</strong><p>Revise as tarifas antes de receber pedidos.</p></div></div>':'';
  modal(product?'Configurar custo':integration?'Configurar taxa de pagamento':row?'Editar custo':'Adicionar custo',
   '<form data-form="cost" class="form-grid" data-linked-fee="'+Boolean(integration||row?.integration_id)+'" data-provider="'+esc(provider)+'" data-currency="'+esc(currency)+'" data-fixed-product="'+Boolean(product)+'">'+
   '<input type="hidden" name="id" value="'+esc(row?.id||'')+'"><input type="hidden" name="integration_id" value="'+esc(integration?.id||row?.integration_id||'')+'">'+header+
   '<label '+(integration?'hidden':'')+'>Nome do custo<input name="name" required maxlength="120" value="'+esc(integration?.name||row?.name||product?.name?.slice(0,120)||'')+'" placeholder="Ex.: Produto, imposto ou embalagem" '+(integration||row?.integration_id?'readonly':'')+'></label>'+
   (integration?'<input id="cost-category" type="hidden" value="fee">':select('cost-category','Tipo de custo',[['','Selecione o tipo de custo'],['product','Custo do produto'],['tax','Imposto'],['fee','Taxa de pagamento'],['expense','Custo adicional']],category))+
   (legacyFee?select('fee-mode','Tipo de tarifa',[['general','Mesma tarifa para todos'],['schedule','Pix e cartão']], 'general'):'')+
   select('cost-calculation','Como calcular',[['fixed_per_item','Valor fixo por unidade'],['fixed_per_sale','Valor fixo por venda aprovada'],['percentage','Porcentagem sobre vendas aprovadas'],['fixed_once','Valor fixo único']],mode)+
   '<input type="hidden" id="cost-currency" value="'+esc(currency)+'">'+
   '<label><span id="cost-amount-label">Valor em '+esc(currency)+'</span><input name="amount" inputmode="decimal" value="'+decimal(row?.amount_minor,scale[currency])+'" placeholder="0,00"></label>'+
   '<label>Percentual (%)<input name="rate" inputmode="decimal" value="'+decimal(row?.rate_bps,2)+'" placeholder="0,00"></label>'+
   select('cost-product','Produto',[['','Todos os produtos'],...costProducts.map((p,i)=>[String(i),p.name+' · '+brand.name(p.provider)+' · '+p.currency]),['manual','Informar ID do produto']],known>=0?String(known):row?.product_id?'manual':'')+
   '<label id="cost-product-id-label">ID do produto<input name="product_id" value="'+esc(row?.product_id||'')+'" maxlength="200" placeholder="ID recebido pelo checkout"></label>'+
   select('cost-provider','Checkout',[['','Todos os checkouts'],...checkoutProviders.map(p=>[p,brand.name(p)]),['custom','API própria']],provider)+
   '<section class="mt-payment-fee wide" id="cost-payment-schedule" hidden></section>'+
   '<div class="mt-cost-explanation wide" id="cost-explanation" role="status"></div>'+
   '<p class="small wide" id="cost-effective-note">As alterações valem para as próximas aprovações.</p>'+
   '<div class="mt-fee-actions wide" id="cost-actions">'+(flow?'<button type="button" class="quiet mt-fee-danger" data-action="cost-skip">Não configurar agora</button>':'')+
   '<button type="submit" class="primary">'+(integration?'Salvar taxa':row?'Salvar alteração':'Adicionar custo')+'</button></div>'+
   '<p class="mt-form-error wide" role="alert" hidden></p></form>');
  const form=$('dialog-content').querySelector('[data-form="cost"]');
  const categoryField=$('cost-category');
  if(categoryField.tagName==='SELECT'){categoryField.options[0].disabled=true;categoryField.options[0].hidden=true;}
  if(product||row?.integration_id)categoryField.disabled=true;
  fees.fill($('cost-payment-schedule'),provider,currency,row?.fee_schedule,Boolean(integration&&!row));
  updateCostForm(form);
  window.MagemindFilters?.enhanceSelects(form);
 }
 function showCostField(field,visible,enabled=visible){
  field.closest('label').hidden=!visible;
  field.disabled=!enabled;
 }
 function updateCostForm(form){
  const cat=$('cost-category').value,c=$('cost-calculation'),product=cat==='product',tax=cat==='tax',fee=cat==='fee';
  const legacyMode=$('fee-mode'),schedule=fee&&legacyMode?.value!=='general';
  const selected=Boolean(cat),linked=form.dataset.linkedFee==='true';
  if(legacyMode)showCostField(legacyMode,fee);
  $('cost-payment-schedule').hidden=!schedule;

  const modes=product?['fixed_per_item']:tax?['percentage']:
   cat==='expense'?['fixed_per_sale','percentage','fixed_once']:['fixed_per_sale','percentage'];
  for(const option of c.options)option.hidden=!modes.includes(option.value);
  if(!modes.includes(c.value))c.value=modes[0];
  const showMode=selected&&!schedule&&!product&&!tax;
  showCostField(c,showMode);
  const percentage=c.value==='percentage';
  const showAmount=selected&&!schedule&&!percentage,showRate=selected&&!schedule&&percentage;
  showCostField(form.elements.amount,showAmount);
  showCostField(form.elements.rate,showRate);
  form.elements.amount.required=showAmount;
  form.elements.rate.required=showRate;

  const productField=$('cost-product');
  showCostField(productField,product,product&&form.dataset.fixedProduct!=='true');
  const value=productField.value,known=product&&/^\d+$/.test(value)?costProducts[Number(value)]:null;
  const manual=product&&value==='manual';
  showCostField(form.elements.product_id,manual);
  form.elements.product_id.required=manual;
  showCostField($('cost-provider'),selected&&!product&&!costFlow?.integration,!linked);
  const cur=known?.currency||form.dataset.currency;
  $('cost-currency').value=cur;
  $('cost-amount-label').textContent='Valor em '+cur+(product?' por unidade':c.value==='fixed_once'?'':' por venda');
  $('cost-effective-note').hidden=!selected;
  $('cost-actions').hidden=!selected;
  form.querySelector('[type=submit]').disabled=!selected;
  $('cost-explanation').hidden=!selected||schedule;
  if(!selected||schedule)return;
  $('cost-explanation').innerHTML='<strong>'+esc(tax?'Imposto sobre o faturamento aprovado':product?'Custo por unidade vendida':percentage?'Percentual sobre as vendas aprovadas':c.value==='fixed_once'?'Despesa única':'Valor aplicado a cada venda aprovada')+'</strong><p>'+esc(fee?'O valor informado pelo checkout tem prioridade.':product?'O custo é multiplicado pela quantidade vendida. A configuração do produto tem prioridade sobre o custo geral.':percentage?'O percentual será aplicado sobre o valor bruto do pedido aprovado.':c.value==='fixed_once'?'O valor será lançado uma vez.':'O valor fixo será descontado de cada venda aprovada.')+'</p>';
 }
 document.addEventListener('change',e=>{
  const form=e.target.closest('[data-form="cost"]');
  if(!form||!['cost-category','fee-mode','cost-calculation','cost-product'].includes(e.target.id))return;
  updateCostForm(form);
 });
 function minorInput(value,s){if(!value)return null;const parts=value.replace(',','.').split('.');if(parts.length>2||!/^\d+$/.test(parts[0])||!/^[0-9]*$/.test(parts[1]||'')||(parts[1]||'').length>s)throw new Error('Precisão do valor inválida');const n=Number(BigInt(parts[0])*10n**BigInt(s)+BigInt((parts[1]||'').padEnd(s,'0')||'0'));if(!Number.isSafeInteger(n))throw new Error('Valor acima do limite permitido');return n;}
 async function action(name,el){
  if(observer()){if(name==='meta-platform')return connections.platform();if(name.startsWith('admin-'))return window.MagemindTrackingAdmin.action(name,el);if(!['filter','refresh','prev','next','ad-level','ad-sort','ad-drill','ad-clear','ad-detail','dialog-close','welcome-close'].includes(name))throw new Error('Este painel permite apenas visualizar as operações.');}
  if(name.startsWith('catalog-'))return catalog.action(name,el,catalogContext());
  if(name.startsWith('campaign-')){
   if(!['owner','admin'].includes(workspace()?.role))throw new Error('Somente os responsáveis pela operação podem gerenciar as conexões.');
   return connections.campaignAction(name,el.dataset.id);
  }
  if(name==='checkout-connection')return checkoutConnection(el.dataset.provider);
  if(name==='webhook-details')return connections.details(el.dataset.id);
  if(name==='connection-copy')return connections.copy();
  if(name==='meta-platform')return connections.platform();
  if(name==='connect'&&window.MagemindTrackingBackend?.edge){const p=el.dataset.provider;if(p==='meta')return connections.hub();if(checkoutProviders.includes(p))return connections.webhook(p);if(p==='custom')return connections.custom();throw new Error('Plataforma indisponível');}
  if(name==='welcome-close')return $('tracking-dialog').close();
  if(name==='setup-checkouts'||name==='setup-ads'||name==='ad-integrations'){goTo('integrations');await render();const heading=$(name==='setup-checkouts'?'integration-checkouts':'integration-ad-managers')?.querySelector('h2');heading?.scrollIntoView({block:'start',behavior:'smooth'});heading?.focus({preventScroll:true});return;}
  if(name==='setup-costs'){goTo('settings');selectSettingsTab('tracking');return;}
  if(name==='setup-orders')return goTo('orders');
  if(name==='setup-journey'){goTo('integrations');await render();return sitesForm();}
  if(name==='setup-zero-cost'){await api('/costs',{name:'Sem custos',category:'product',calculation:'fixed_per_item',currency:state.currency,amount_minor:0,rate_bps:null,product_id:null,provider:null});toast('Operação sem custos configurada.');return render();}
  if(name==='cost-history'){costHistory=!costHistory;return render();}
  if(name==='cost-skip')return finishCostFlow();
  if(name==='cost-integration'){
   const integration=(await api('/integrations')).find(i=>i.id===el.dataset.id);
   if(!integration)throw new Error('Integração indisponível.');
   return configureFee(integration);
  }
  if(name==='cost-edit')return costForm(costRules.find(r=>r.id===el.dataset.id));
  if(name==='cost-remove')return modal('Remover custo','<p>O custo deixará de ser aplicado às próximas aprovações. As vendas anteriores e o histórico dos custos serão mantidos.</p><div class="actions">'+button('Cancelar','welcome-close')+button('Remover custo','cost-archive-confirm','data-id="'+esc(el.dataset.id)+'"',true)+'</div>');
  if(name==='cost-archive-confirm'){await api('/costs/archive',{id:el.dataset.id});$('tracking-dialog').close();toast('Custo removido. Histórico preservado.');return render();}
  if(name==='purchase-actions'){
   const rows=(await api('/integrations')).filter(i=>i.provider==='google'&&i.connected&&/^\d+$/.test(i.account_id));
   if(!rows.length)throw new Error('Selecione primeiro uma conta Google autorizada.');
   return modal('Conversões reportadas pelo Google',select('purchase-account','Conta',rows.map(i=>[i.id,i.name+' / '+i.account_id]))+button('Listar ações de compra','purchase-actions-list','',true));
  }
  if(name==='purchase-actions-list'){
   const id=$('purchase-account').value,r=await window.MagemindTrackingBackend.edge({workspace:state.workspace,integration:id,action:'purchase_actions'});
   return modal('Selecionar somente Purchase','<form data-form="purchase-actions"><input type="hidden" name="integration" value="'+esc(id)+'">'+r.actions.map(a=>'<label class="checkbox"><input type="checkbox" name="ids" value="'+esc(a.id)+'" '+(r.selected.includes(a.id)?'checked':'')+'>'+esc(a.name)+'</label>').join('')+'<button class="primary">Salvar ações de comparação</button><p class="small">Essas métricas seguem a atribuição da rede e data de interação; a receita própria continua vindo dos pedidos autenticados.</p></form>');
  }
  if(name==='products'){
   const integrations=(await api('/integrations')).filter(i=>['custom',...checkoutProviders].includes(i.provider));
   return modal('Produtos acompanhados','<form data-form="products">'+select('products-integration','Checkout',integrations.map(i=>[i.id,i.provider+' / '+i.account_id]))+'<label>IDs de produtos (vírgula; vazio = todos)<input name="ids" maxlength="2000" placeholder="ID recebido no pedido"></label><button class="primary">Salvar escopo de produtos</button><p class="small">Deixe vazio para acompanhar todos os produtos. O filtro considera o total do pedido que inclui os produtos selecionados, inclusive itens adicionais.</p></form>');
  }
  if(['oauth','accounts','select-account','checkout-credentials'].includes(name)&&!window.MagemindTrackingBackend)throw new Error('Conexões reais precisam do Supabase local configurado.');
  if(name==='oauth'){const r=await window.MagemindTrackingBackend.edge({action:'oauth_start',workspace:state.workspace,provider:el.dataset.provider});location.assign(r.url);return;}
  if(name==='accounts'){
   const r=await window.MagemindTrackingBackend.edge({action:'accounts',workspace:state.workspace,integration:el.dataset.id});
   return modal('Selecionar conta autorizada',table(['Conta','Moeda','Fuso',''],r.accounts.map(a=>'<tr><td>'+esc(a.name||a.account_id)+'<small>'+esc(a.account_id)+'</small></td><td>'+esc(a.currency||'Indisponível')+'</td><td>'+esc(a.timezone||'Indisponível')+'</td><td>'+(a.manager?'MCC — selecione cliente':button('Selecionar','select-account','data-id="'+esc(el.dataset.id)+'" data-account="'+esc(a.account_id)+'"'))+'</td></tr>')));
  }
  if(name==='select-account'){await window.MagemindTrackingBackend.edge({action:'select_account',workspace:state.workspace,integration:el.dataset.id,account_id:el.dataset.account});$('tracking-dialog').close();toast('Conta selecionada. Sincronização iniciada.');return render();}
  if(name==='checkout-credentials')return modal('Credenciais de checkout','<form data-form="checkout-credentials"><input type="hidden" name="integration" value="'+esc(el.dataset.id)+'"><input type="hidden" name="provider" value="'+esc(el.dataset.provider)+'"><label>Hottok Hotmart (quando aplicável)<input name="hottok" type="password" autocomplete="off"></label><label>Token OAuth de leitura (Kiwify ou conciliação Hotmart)<input name="access_token" type="password" autocomplete="off"></label><label>ID da conta Kiwify (quando aplicável)<input name="account_id"></label>'+select('recipient-source','Seu papel na receita',[['PRODUCER','Produtor'],['AFFILIATE','Afiliado'],['COPRODUCER','Coprodutor']])+'<button class="primary">Guardar credenciais no backend</button><p class="small">Campos privados são enviados à Edge Function autenticada, criptografados e removidos da tela ao fechar.</p></form>');
  if(name.startsWith('tab-')){const tab=name.slice(4);if(!routes[tab])return;goTo(routes[tab]);if(tab==='settings')selectSettingsTab('tracking');return;}
  if(name==='refresh')return render();
  if(name==='native-demands')return goTo('demands');
  if(name==='ad-integrations'){goTo('integrations');await render();const heading=$('integration-ad-managers')?.querySelector('h2');heading?.scrollIntoView({block:'start',behavior:'smooth'});heading?.focus({preventScroll:true});return;}
  if(name==='prev'||name==='next'){state.page+=name==='prev'?-1:1;return render();}
  if(name==='filter')return applyFilters();
  if(name==='order')return detail(el.dataset.id);
  if(name==='customer')return customerDetail(el.dataset.id);
  const platform=el.dataset.provider||el.closest('[data-platform]')?.dataset.platform;
  if(name==='ad-detail')return adDetail(platform,el.dataset.account,el.dataset.entity);
  if(name==='dialog-close')return $('tracking-dialog').close();
  if(platform&&['ad-level','ad-sort','ad-drill','ad-clear'].includes(name)){
   const view=campaignView(platform);
   if(name==='ad-sort'){
    view.direction=view.sort===el.dataset.sort&&view.direction==='desc'?'asc':'desc';
    view.sort=el.dataset.sort;
   }else if(name==='ad-drill'){
    view.account=el.dataset.account;
    view.parent=el.dataset.entity;
    view.level=el.dataset.level==='campaign'?'group':'ad';
    state.search='';
    $('tracking-dialog').close();
   }else{
    view.parent='';view.account='';
    if(name==='ad-level')view.level=el.dataset.level;
   }
   return render();
  }
  if(name==='ad-status'){
   const w=state.workspace;
   try{
    await api('/ad-status',{provider:el.dataset.provider,account_id:el.dataset.account,entity_id:el.dataset.entity,status:el.dataset.status,revision:Number(el.dataset.revision)});
    toast(el.dataset.status==='ACTIVE'?'Veiculação ativada.':'Veiculação pausada.');
    if(el.closest('.mt-ad-detail')&&$('tracking-dialog').open&&state.tab==='ads'&&state.workspace===w){
     await adDetail(el.dataset.provider,el.dataset.account,el.dataset.entity);
    }
    return render();
   }catch(error){
    if(state.tab==='ads'&&state.workspace===w){
     await render();
     if(error.code&&error.code!=='ad_status_conflict')return connections.hub(error.message,true);
    }
    throw error;
   }
  }
  if(name==='sites')return sitesForm();
  if(name==='cost-form')return costForm();
  if(name==='token'){const r=await api('/integration/token',{id:el.dataset.id});modal('Credencial privada da API','<p>'+esc(r.notice)+'</p><textarea readonly aria-label="Token privado da API">'+esc(r.token)+'</textarea><p class="small">Endpoint: POST '+esc(pilot?cfg.supabaseUrl+'/functions/v1/tracking-webhook?provider=custom':location.origin+cfg.apiBase+'/orders')+' · Authorization: Bearer TOKEN</p>');return;}
  if(name==='sync'||name==='revoke'){await api('/integration/sync',{id:el.dataset.id,fail:name==='revoke'});toast('Integração atualizada.');return render();}
  if(name==='disconnect'){await api('/integration/disconnect',{id:el.dataset.id});toast('Credencial revogada; histórico preservado.');if(el.closest('.mt-checkout-detail'))$('tracking-dialog').close();return render();}
  if(name==='retry'){await api('/retry',{id:el.dataset.id});toast('Reenvio auditado colocado na fila.');return render();}
  if(name==='export'){
   if(state.tab!=='orders'||!setup?.checkout_ready)return;
   if(window.MagemindTrackingBackend){
    const data=await api('/export',null,{search:state.search,status:state.status,provider:state.provider,channel:state.channel,payment:state.payment});
    const cell=v=>'"'+String(/^[\s]*[=+@-]/.test(String(v??''))?"'"+v:v??'').replaceAll('"','""')+'"';
    const csv=[['pedido','status','comprador','email','moeda','valor_unidades_menores','origem'],...data.rows.map(x=>[x.external_id,x.status,x.buyer_name,x.buyer_email,x.currency,x.gross_minor,x.channel])].map(row=>row.map(cell).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='pedidos-pagina-'+state.page+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
   }
   const u=new URL(cfg.apiBase+'/export',location.origin);for(const [k,v] of Object.entries(state))if(v!==null&&k!=='tab')u.searchParams.set(k,v);location.assign(u);return;
  }
 }
 document.addEventListener('click',async e=>{
  if(!e.target.closest('.mt-root,.mobile-tracking-action'))return;
  const tab=e.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;state.page=1;return render();}
  const target=e.target.closest('[data-action]');if(!target)return;
  if(!await ready())return;
  target.disabled=true;try{await action(target.dataset.action,target);}catch(err){toast(err.message,'err');}finally{if(target.isConnected)target.disabled=false;}
 });
 document.addEventListener('submit',async e=>{
  const form=e.target.closest('.mt-root [data-form]');if(!form)return;e.preventDefault();const btn=form.querySelector('button[type=submit],button.primary');btn.disabled=true;
  try{
   const data=Object.fromEntries(new FormData(form)),type=form.dataset.form;
   if(type.startsWith('catalog-')){
    await catalog.submit(type,form,data,catalogContext());
    return;
   }
   if(await connections.submit(type,form))return;
   if(type==='connect-real'){
    const r=await window.MagemindTrackingBackend.edge({action:'connect_real',workspace:state.workspace,...data});form.reset();$('tracking-dialog').close();await render();
    if(r.webhook)modal('Kiwify conectada','<p>O histórico será sincronizado automaticamente. Para receber novos pedidos assim que ocorrerem, cadastre este endereço em Apps → Webhooks da Kiwify, nos eventos de pedido, aprovação, cancelamento e devolução.</p><textarea readonly aria-label="Endereço do webhook">'+esc(r.webhook)+'</textarea><p class="small">Este endereço é privado e pertence apenas à sua operação.</p>');else toast('Conta verificada. Sincronização automática iniciada.');return;
   }
   if(type==='products')await api('/integration/products',{id:$('products-integration').value,ids:data.ids.split(',').map(x=>x.trim()).filter(Boolean)});
   if(type==='purchase-actions')await window.MagemindTrackingBackend.edge({workspace:state.workspace,integration:data.integration,action:'select_purchase_actions',ids:new FormData(form).getAll('ids')});
   if(type==='site'){await api('/sites',data);await sitesForm();return;}
   if(type==='cost'){
    const category=$('cost-category').value,calculation=$('cost-calculation').value,currency=$('cost-currency').value,known=category==='product'&&/^\d+$/.test($('cost-product').value)?costProducts[Number($('cost-product').value)]:null;
    if(!category)throw new Error('Selecione o tipo de custo.');
    const scheduled=category==='fee'&&$('fee-mode')?.value!=='general';
    const payload={name:data.name,category,calculation:scheduled?'fee_schedule':calculation,currency,product_id:category==='product'?(known?.product_id||data.product_id||null):null,provider:(category==='product'?(known?.provider||form.dataset.provider):$('cost-provider').value)||null,amount_minor:scheduled||calculation==='percentage'?null:minorInput(data.amount,scale[currency]),rate_bps:!scheduled&&calculation==='percentage'?minorInput(data.rate,2):null};
    if(scheduled){
     payload.fee_schedule=fees.read(form,currency,minorInput);
     if(data.integration_id)payload.integration_id=data.integration_id;
    }
    if(payload.rate_bps>10000)throw new Error('O percentual deve estar entre 0 e 100%.');
    await api(data.id?'/costs/edit':'/costs',data.id?{id:data.id,...payload}:payload);
    if(costFlow){await finishCostFlow();toast('Taxa salva em Configurações → Custos.');return;}
   }
   if(type==='settings'){await api('/settings',{...data,attribution_days:Number(data.attribution_days),retention_days:Number(data.retention_days)});await loadWorkspaces();}
   if(type==='preferences'){const prefs={};for(const [k] of notificationPreferences)prefs[k]=form.elements[k].checked;await api('/preferences',prefs);}
   if(type==='checkout-credentials'){
    const secrets={hottok:data.hottok||undefined,access_token:data.access_token||undefined,account_id:data.account_id||undefined,recipientSource:$('recipient-source').value};
    const r=await window.MagemindTrackingBackend.edge({workspace:state.workspace,integration:data.integration,action:'checkout_credentials',secrets});
    modal('Webhook do checkout', '<p>Cadastre este endereço na sua integração. Na Kiwify a chave de ingresso identifica o endpoint; a aprovação continua dependendo da API de vendas.</p><textarea readonly>'+esc(r.webhook)+'</textarea><p class="small">A URL Kiwify é privada; não a compartilhe nem a inclua no script público.</p>');return;
   }
   $('tracking-dialog').close();toast('Alteração salva.');await render();
  }catch(err){
   const status=form.querySelector('.mt-form-error');
   if(status){status.hidden=false;status.textContent=err.message;status.scrollIntoView({block:'nearest'});}
   else toast(err.message,'err');
  }finally{if(btn.isConnected)btn.disabled=false;}
 });

 async function pollNotifications(){
  if(observer()||notificationPollRunning)return;
  notificationPollRunning=true;try{
  if(!await ready())return;const uid=user.user_id,items=await api('/notifications');if(DB.me?.id!==uid)return;
  const scope=uid+':'+state.workspace,warmed=notificationScope===scope;
  if(!warmed){notificationScope=scope;notificationIds.clear();}
  const fresh=items.filter(n=>!notificationIds.has(n.id));if(warmed&&fresh.length)markPending();for(const n of items)notificationIds.add(n.id);
  const read=new Set(JSON.parse(localStorage.getItem('mm_tracking_read_'+uid)||'[]'));
  DB.notifications=DB.notifications.filter(n=>!n.trackingWorkspaceId);
  for(const n of items){DB.notifications.push({id:'tracking-'+n.id,to:uid,icon:n.category==='pending'?'◷':['refund','chargeback'].includes(n.category)?'↩':['refused','cancelled','failure'].includes(n.category)?'!':'↗',iconBg:n.category==='pending'?'var(--amberbg)':['refused','cancelled','chargeback','failure'].includes(n.category)?'var(--rosebg)':'var(--emeraldbg)',title:notificationTitle(n),body:notificationBody(n),date:'',time:n.created_at||n.delivered_at||n.next_attempt_at?dt(n.created_at||n.delivered_at||n.next_attempt_at):'',read:read.has('tracking-'+n.id),createdAt:n.created_at||n.delivered_at||n.next_attempt_at,trackingOrderId:n.order_id,trackingWorkspaceId:state.workspace});}
  updateNotifBadge();if(window.isNotifPanelOpen())renderNotifPanel();
  if(warmed&&fresh.length)toast(fresh.length===1?[notificationTitle(fresh[0]),notificationBody(fresh[0])].filter(Boolean).join(' · '):fresh.length+' novas atualizações de pedidos');
  const status=await api('/onboarding');if(DB.me?.id!==uid)return;const changed=JSON.stringify(status)!==JSON.stringify(setup);setup=status;
  if(changed&&state.tab==='overview')markPending();else maybeCelebrate();
  }finally{notificationPollRunning=false;}
 }
 window.MagemindTrackingNative={route,open:()=>goTo('dashboard'),clear,renderDemandStatus(){const rows=[['Não iniciado','Pendentes','var(--text3)'],['Em andamento','Em produção','var(--amber)'],['Concluído','Concluídas','var(--emerald)']];const total=DB.demands.length;$('demand-status-bars').innerHTML=rows.map(([key,label,color])=>{const n=DB.demands.filter(d=>d.status===key).length;return '<div class="list-row" style="margin-bottom:12px;font-size:11px"><span>'+label+'</span><strong style="float:right;color:'+color+'">'+n+'</strong><div style="height:4px;background:var(--bg3);border-radius:4px;margin-top:6px"><div style="width:'+(total?n/total*100:0)+'%;height:4px;border-radius:4px;background:'+color+'"></div></div></div>';}).join('');}};
 window.MagemindTracking={open:()=>goTo('dashboard')};
 window.MagemindTrackingNative.refresh=async()=>{await pollNotifications();if(state.tab!=='settings')await refreshData({propagate:true});};
 const previousMyNotifs=window.myNotifs;
 window.myNotifs=()=>{const rows=previousMyNotifs();return window.trackingEnabled()?rows.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)):rows;};
 const previousClickNotif=window.clickNotif;
 window.clickNotif=async(id,demandId)=>{const n=DB.notifications.find(x=>x.id===id);if(!n?.trackingWorkspaceId)return previousClickNotif(id,demandId);const key='mm_tracking_read_'+DB.me.id,read=new Set(JSON.parse(localStorage.getItem(key)||'[]'));read.add(id);localStorage.setItem(key,JSON.stringify([...read]));n.read=true;updateNotifBadge();closeNotifPanel();state.workspace=n.trackingWorkspaceId;goTo(n.trackingOrderId?'orders':'integrations');await render();if(n.trackingOrderId)await detail(n.trackingOrderId,n.trackingWorkspaceId);};
 const oldMarkAll=window.markAllRead;
 window.markAllRead=async()=>{if(!window.trackingEnabled())return oldMarkAll();const read=new Set(JSON.parse(localStorage.getItem('mm_tracking_read_'+DB.me.id)||'[]'));DB.notifications.filter(n=>n.trackingWorkspaceId).forEach(n=>{read.add(n.id);n.read=true;});localStorage.setItem('mm_tracking_read_'+DB.me.id,JSON.stringify([...read]));await oldMarkAll();updateNotifBadge();renderNotifPanel();};
 $('tracking-refresh').addEventListener('click',refreshData);
 function applyFilters(){
  clearTimeout(filterTimer);filterTimer=0;
  for(const name of ['status','provider','channel','payment']){
   const field=$('filter-'+name);if(field)state[name]=field.value;
  }
  state.search=$('tracking-search')?.value.trim()||'';state.page=1;
  return render();
 }
 function applyClientFilters(){applyFilters().catch(error=>toast(error.message,'err'));}
 document.addEventListener('keydown',event=>{
  if(event.target.id!=='tracking-search'||event.key!=='Enter'||event.isComposing)return;
  event.preventDefault();applyClientFilters();
 });
 document.addEventListener('input',event=>{
  if(event.target.id!=='tracking-search'||!event.target.closest('.mt-compact-filters,.mt-catalog-toolbar')||event.isComposing)return;
  clearTimeout(filterTimer);
  filterTimer=setTimeout(applyClientFilters,260);
 });
 $('tracking-currency').addEventListener('change',()=>{state.currency=$('tracking-currency').value;state.page=1;render();});
 const periodPopover=bindAnchoredPopover($('tracking-period-popover'),$('tracking-period-toggle'));
 function closePeriod(){periodPopover.close();}
 function periodOptions(selected=state.preset){$('tracking-period-options').innerHTML=periods.presets.map(p=>'<button type="button" class="mt-period-option" data-period="'+p.id+'" aria-pressed="'+(p.id===selected)+'"><span>'+p.label+(p.hint?'<small>'+p.hint+'</small>':'')+'</span><span class="mt-period-check" aria-hidden="true">✓</span></button>').join('');}
 function showPeriod(){
  const p=$('tracking-period-popover');if(periodPopover.isOpen())return periodPopover.close(true);
  periodOptions();$('tracking-custom-period').hidden=true;$('tracking-period-error').hidden=true;periodPopover.open();
  p.querySelector('[aria-pressed=true]')?.focus({preventScroll:true});
 }
 $('tracking-period-toggle').addEventListener('click',showPeriod);
 $('tracking-period-options').addEventListener('click',async e=>{
  const target=e.target.closest('[data-period]');if(!target)return;
  if(target.dataset.period==='custom'){periodOptions('custom');$('tracking-from').value=state.from;$('tracking-to').value=state.to;$('tracking-custom-period').hidden=false;$('tracking-period-error').hidden=true;periodPopover.position();$('tracking-from').focus();return;}
  state.preset=target.dataset.period;state.page=1;closePeriod();syncInputs();persist();await render();$('tracking-period-toggle').focus({preventScroll:true});
 });
 $('tracking-custom-period').addEventListener('submit',async e=>{
  e.preventDefault();const from=$('tracking-from').value,to=$('tracking-to').value;
  if(!periods.validRange(from,to)){$('tracking-period-error').textContent='A data final deve ser igual ou posterior à data inicial.';$('tracking-period-error').hidden=false;periodPopover.position();$('tracking-period-error').scrollIntoView({block:'nearest'});return;}
  Object.assign(state,{from,to,preset:'custom',page:1});closePeriod();syncInputs();persist();await render();$('tracking-period-toggle').focus({preventScroll:true});
 });
 $('tracking-period-cancel').addEventListener('click',()=>periodPopover.close(true));
 $('tracking-period-options').addEventListener('keydown',e=>{
  const buttons=[...e.currentTarget.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
  e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();
 });
 $('close-dialog').addEventListener('click',()=>finishCostFlow());
 $('tracking-dialog').addEventListener('cancel',event=>{
  if(!costFlow?.finish)return;
  event.preventDefault();
  finishCostFlow();
 });
 $('tracking-dialog').addEventListener('close',()=>{
  if(!$('tracking-dialog').open){adDetailRequest++;$('dialog-content').replaceChildren();costFlow=null;}
 });
 document.addEventListener('change',event=>{
  if(event.target.matches('.mt-compact-filters select[id^="filter-"]')){applyClientFilters();return;}
  const filter=event.target;
  if(state.tab!=='ads'||!filter.matches('.mt-ad-controls select'))return;
  const view=campaignView(filter.closest('[data-platform]').dataset.platform);
  if(filter.multiple){
   view.accountIds=[...filter.selectedOptions].map(option=>option.value).filter(Boolean);
   if(view.accountIds.length&&!view.accountIds.includes(view.account)){view.parent='';view.account='';}
  }else if(filter.closest('.mt-ad-delivery'))view.delivery=filter.value;
  else [view.sort,view.direction]=filter.value.split(':');
  void render();
 });
 document.addEventListener('magemind:session-ready',async()=>{
  if(!window.trackingEnabled())return;
  const url=new URL(location.href),callback=url.searchParams;
  const grant=callback.get('tracking_oauth'),failed=callback.get('tracking_oauth_error'),w=callback.get('tracking_workspace');
  if(grant||failed){
   for(const key of ['tracking_oauth','tracking_oauth_error','tracking_workspace'])callback.delete(key);
   history.replaceState(null,'',url.pathname+url.search+url.hash);
   const returnPage=connections.returnPage();
   try{
    if(await ready()&&!observer()){
     if(grant&&workspaces.some(row=>row.id===w))state.workspace=w;
     goTo(returnPage);
     try{
      if(grant&&w===state.workspace)await connections.accounts(grant,{fromOAuth:true});
      else{
       const messages={
        token_revoked:'A Meta devolveu uma autorização inválida. Renove o acesso com o perfil responsável pela conta de anúncios.',
        meta_confirmation_required:'Abra sua conta na Meta e conclua a verificação de segurança. Depois, renove o acesso em Conexões.',
        meta_read_denied:'Confira o acesso do seu perfil à conta de anúncios na Meta e tente conectar novamente.',
        rate_limit:'A Meta limitou as consultas temporariamente. Aguarde alguns minutos e tente renovar o acesso.'
       };
       await connections.hub(messages[failed]||'A autorização da Meta não foi concluída. Tente novamente em Conexões.',true);
      }
     }catch(error){await connections.hub(error.message,true);}
    }
   }catch(error){toast(error.message,'err');}
  }else route('dashboard');
  pollNotifications().catch(()=>{});
  if(callback.get('order')){
   await ready();
   if(callback.get('workspace')&&workspaces.some(row=>row.id===callback.get('workspace')))state.workspace=callback.get('workspace');
   goTo('orders');
   await render();
   detail(callback.get('order'),callback.get('workspace')||state.workspace).catch(error=>toast(error.message,'err'));
  }
 });
 document.addEventListener('magemind:tracking-signed-out',clear);
 navigator.serviceWorker?.addEventListener('message',async e=>{if(e.data?.type!=='OPEN_TRACKING_ORDER'||!await ready())return;await loadWorkspaces();if(!workspaces.some(w=>w.id===e.data.workspaceId))return;state.workspace=e.data.workspaceId;goTo(e.data.orderId?'orders':'integrations');await render();if(e.data.orderId)detail(e.data.orderId,e.data.workspaceId).catch(err=>toast(err.message));});
 setInterval(()=>{if(DB.me)pollNotifications().catch(()=>{});},5000);
 setInterval(()=>{if(DB.me&&window.trackingEnabled()&&['overview','ads','orders'].includes(state.tab)&&document.querySelector('.page.active')?.id==='pg-'+routes[state.tab])syncStatus(requestVersion).catch(()=>{});},30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&DB.me&&window.trackingEnabled()&&['overview','ads','orders'].includes(state.tab))syncStatus(requestVersion).catch(()=>{});});
 if(DB.me)route(document.querySelector('.page.active')?.id?.slice(3)||'dashboard');
})();
