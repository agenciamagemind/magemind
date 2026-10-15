(() => {
 'use strict';
 const cfg=window.MAGEMIND_TRACKING_ENV;
 const pilot=cfg?.mode==='supabase-pilot';
 if(pilot){if(cfg.environmentId!=='magemind-tracking-pilot-v1'||cfg.supabaseUrl!=='https://tsawxmlfvnvepzgcztfc.supabase.co')throw new Error('Piloto inválido');}else if(!cfg||cfg.environment!=='test'||cfg.externalDelivery!==false||!/magemind-tracking-(local|test)-/.test(cfg.environmentId)||JSON.stringify(cfg).includes('tsawxmlfvnvepzgcztfc'))throw new Error('Configuração isolada de teste necessária');
 const $=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const tabs=[['overview','Menu'],['ads','Campanhas'],['orders','Pedidos'],['integrations','Integrações'],['settings','Configurações']];
 const routes={overview:'dashboard',ads:'campaigns',orders:'orders',integrations:'integrations',settings:'settings'};
 const brand=window.MagemindTrackingBrands;
 const periods=window.MagemindTrackingPeriods;
 const connections=window.MagemindTrackingConnections;
 const checkoutProviders=Object.keys(window.MagemindWebhookConnectors);

 const statusLabel={pending:'Pendente',paid:'Aprovado',refunded:'Devolvido',chargeback:'Chargeback',refused:'Recusado',cancelled:'Cancelado',disputed:'Em disputa'};
 const scale={BRL:2,USD:2,EUR:2,JPY:0,KWD:3};
 let user=null,workspaces=[],authMode='login',requestVersion=0,notificationIds=new Set(),notificationScope=null,notificationPollRunning=false;
 const notificationTitles={pending:'Venda pendente!',sale:'Venda aprovada!',renewal:'Renovação aprovada!',refused:'Venda recusada!',cancelled:'Venda cancelada!',refund:'Venda estornada!',chargeback:'Chargeback registrado!',disputed:'Venda em disputa!',failure:'Integração requer atenção'};
 const notificationBody=n=>n.category==='failure'?'Confira a conexão em Integrações':n.hide_amount?'Valor oculto':n.gross_minor==null?'':'Valor: '+money(['refund','chargeback'].includes(n.category)?n.refund_minor:n.gross_minor,n.currency,n.amount_scale);
 const notificationPreferences=[['pending','Pedidos pendentes'],['sales','Vendas aprovadas'],['renewals','Renovações'],['refusals','Pagamentos recusados'],['cancellations','Pedidos cancelados'],['refunds','Reembolsos'],['chargebacks','Chargebacks'],['disputes','Pagamentos em disputa'],['failures','Falhas de integração'],['hide_amount','Ocultar valores nos avisos']];
 let setup=null,costRules=[],costProducts=[],costHistory=false,celebrating=false,welcomePending=null,sessionStarted=Date.now(),onboardingExpanded=false;
 const day=timestamp=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(timestamp));
 const state={workspace:null,tab:'overview',preset:'week',...periods.range('week'),currency:'BRL',page:1,status:'',provider:'',channel:'',payment:'',search:'',account_id:'',entity_id:'',level:'campaign'};
 connections.configure({modal,brand,state,render,toast});
 const workspace=()=>workspaces.find(w=>w.id===state.workspace);
 const observer=()=>window.trackingObserver?.()===true;
 const money=(n,currency=state.currency,amountScale=scale[currency])=>n==null?'Indisponível':new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(Number(n)/10**amountScale);
 const dt=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:workspace()?.timezone||'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'Ainda não recebida';
 const dateLabel=value=>String(value||'').slice(0,10).split('-').reverse().join('/');
 function toast(message){window.toast(message);}
 function persist(){if(user){const {search,...safe}=state;localStorage.setItem('mm_tracking_state_'+user.user_id,JSON.stringify(safe));}}
 function clear(){requestVersion++;closePeriod();onboardingExpanded=false;window.MagemindTrackingBackend?.subscribe(null,()=>{});user=null;workspaces=[];setup=null;costRules=[];costProducts=[];welcomePending=null;state.workspace=null;state.search='';state.preset='week';Object.assign(state,periods.range('week'));notificationIds.clear();notificationScope=null;$('tracking-content').replaceChildren();$('tracking-notifications-mount')?.replaceChildren();$('tracking-module').hidden=true;$('dialog-content').replaceChildren();$('tracking-dialog').close();}
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
 function modal(title,html){$('dialog-title').textContent=title;$('dialog-content').innerHTML=html;$('tracking-dialog').showModal();}
 function metric(label,value,note='',cls=''){return '<article class="metric '+cls+'"><span class="metric-label">'+label+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></article>';}
 function empty(title,text,action=''){return '<div class="empty"><span class="eyebrow">COMECE PELA SUA OPERAÇÃO</span><h2>'+title+'</h2><p>'+text+'</p><div class="actions">'+action+'</div></div>';}
 function panel(title,html){return '<section class="panel"><div class="panel-head"><h2>'+title+'</h2></div><div class="panel-body">'+html+'</div></section>';}
 function lockView(html,title,action,platforms=[],small=false){return '<section class="mt-data-lock'+(small?' mt-mini-lock':'')+'"><div class="mt-data-preview" inert aria-hidden="true">'+html+'</div><div class="mt-data-overlay"><div class="mt-data-message">'+(platforms.length?'<div class="mt-connect-brands">'+platforms.map(p=>brand.logo(p)).join('')+'</div>':'')+'<h3>'+title+'</h3>'+button(action==='setup-costs'?'Configurar custos':'Conectar integração',action,'',true)+'</div></div></section>';}
 function tutorialHTML(){
  if(!isClient()||setup?.completed_at)return '';
  const definitions={checkout:['Conecte seu checkout','Receba pedidos e faturamento de Kiwify, Hotmart ou da sua API.','setup-checkouts','Conectar checkout'],ads:['Conecte sua conta de anúncios','Acompanhe investimento, campanhas, CPA e ROAS.','setup-ads','Conectar anúncios'],costs:['Configure custos e taxas','Defina o custo do produto e as taxas da sua operação para calcular o lucro.','setup-costs','Configurar custos'],journey:['Prepare a origem das vendas','Instale o script do seu site e confirme o primeiro acesso no funil.','setup-journey','Configurar rastreamento'],order:['Receba seu primeiro pedido','Assim que o checkout enviar um pedido, ele aparecerá automaticamente.','setup-orders','Ver pedidos']};
  return '<details class="mt-onboarding mt-compact-onboarding" '+(onboardingExpanded?'open':'')+'><summary><div class="mt-onboarding-head"><div><h2>Prepare sua operação para vender</h2><p>'+setup.tasks.filter(t=>t.done).length+' de 5 etapas concluídas</p></div><strong>'+setup.percent+'%</strong><span class="mt-disclosure-button"><span class="mt-when-closed">Ver etapas</span><span class="mt-when-open">Ocultar etapas</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></span></div><div class="mt-setup-progress" role="progressbar" aria-label="Configuração da conta" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+setup.percent+'"><span style="width:'+setup.percent+'%"></span></div></summary><ol class="mt-setup-steps">'+setup.tasks.map((t,index)=>{const [title,description,action,label]=definitions[t.id];return '<li class="'+(t.done?'completed':'')+'"><span class="mt-step-index" aria-hidden="true">'+(t.done?'✓':index+1)+'</span><div><h3>'+title+'</h3><p>'+description+'</p></div><div class="mt-step-actions">'+(t.done?'<span class="mt-step-done">Concluído</span>':button(label,action)+(t.id==='costs'?button('Não tenho custo de produto','setup-zero-cost'):'') )+'</div></li>';}).join('')+'</ol></details>';
 }
 document.addEventListener('toggle',e=>{if(e.target.matches?.('.mt-compact-onboarding')&&e.target.isConnected)onboardingExpanded=e.target.open;},true);
 function quietLock(html,label,mini=false,action=null){return '<section class="mt-passive-lock'+(mini?' mt-mini-passive':'')+'"><div class="mt-data-preview" inert aria-hidden="true">'+html+'</div><div class="mt-lock-content"><span class="mt-lock-caption"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'+label+'</span>'+(action?button(action==='setup-costs'?'Configurar custos':action==='setup-journey'?'Configurar rastreamento':'Conectar integração',action):'')+'</div></section>';}
 function sourceGuide(){
  const missing=[!setup.checkout_ready&&'Checkout',!setup.ads_ready&&'Anúncios',!setup.costs_ready&&'Custos e taxas',!setup.journey_ready&&'Rastreamento'].filter(Boolean);if(!missing.length)return '';
  const action=!setup.checkout_ready?'setup-checkouts':!setup.ads_ready?'setup-ads':!setup.costs_ready?'setup-costs':'setup-journey';
  const label=action==='setup-costs'?'Configurar custos':action==='setup-journey'?'Configurar rastreamento':'Conectar integrações';
  return '<div class="mt-source-guide"><div><strong>Complete sua configuração</strong><p>Para liberar os blocos restantes: '+missing.join(' · ')+'.</p></div>'+button(label+' →',action,'',true)+'</div>';
 }
 async function maybeCelebrate(){
  if(!isClient()||celebrating||Date.now()-sessionStarted<1800||$('tracking-dialog').open||document.querySelector('.overlay.open'))return;
  const uid=user?.user_id;if(!uid)return;
  if(welcomePending===uid){welcomePending=null;showWelcome();return;}
  if(!setup?.celebration_pending)return;
  celebrating=true;try{const r=await api('/onboarding/celebrate',{});if(DB.me?.id!==uid||!r.claimed)return;setup.celebration_pending=false;if($('tracking-dialog').open||document.querySelector('.overlay.open'))welcomePending=uid;else showWelcome();}catch{}finally{celebrating=false;}
 }
 function showWelcome(){modal('Tudo pronto','<div class="mt-welcome"><div class="mt-welcome-check" aria-hidden="true">✓</div><h2>Boas vendas!</h2><p>Sua configuração está completa. Acompanhe seus pedidos, campanhas e resultados pelo Menu.</p>'+button('Começar a acompanhar','welcome-close','',true)+'</div>');}
 function paginate(total,size=25){return '<div class="pagination"><span>'+total+' registros · Página '+state.page+' de '+Math.max(1,Math.ceil(total/size))+'</span><div class="actions">'+button('‹ Anterior','prev',''+(state.page===1?'disabled':''))+button('Próxima ›','next',state.page*size>=total?'disabled':'')+'</div></div>';}
 function table(headers,rows){return '<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';}
 const select=(id,label,options,value='')=>'<label>'+label+'<select id="'+id+'">'+options.map(([k,v])=>'<option value="'+esc(k)+'" '+(value===k?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>';
 function ordersFilters(){
  return '<div class="filters"><label class="search">Buscar pedido, produto ou comprador<input id="tracking-search" value="'+esc(state.search)+'" placeholder="Nome, e-mail, telefone ou pedido"></label>'+
   select('filter-status','Status',[['','Todos'],...Object.entries(statusLabel)],state.status)+select('filter-provider','Checkout',[['','Todos'],['custom','API própria'],...checkoutProviders.map(p=>[p,brand.name(p)])],state.provider)+select('filter-channel','Origem',[['','Todas'],['meta','Meta'],['google','Google'],['unattributed','Não atribuído']],state.channel)+select('filter-payment','Pagamento',[['','Todos'],['PIX','Pix'],['CREDIT_CARD','Cartão']],state.payment)+button('Filtrar','filter', '',true)+'</div>';
 }
 async function loadWorkspaces(){
  if(observer()){workspaces=(await api('/admin/catalog')).rows;state.workspace=null;$('tracking-workspace-label').style.display='none';window.MagemindTrackingBackend?.subscribe('observer',()=>{if(user&&!$('tracking-dialog').open)render();});return;}
  workspaces=await api('/workspaces');if(!workspaces.some(w=>w.id===state.workspace))state.workspace=workspaces[0]?.id||null;
  if(!state.workspace){const created=await api('/workspaces',{name:'Minha operação',currency:'BRL',timezone:'America/Sao_Paulo'});state.workspace=created.id;workspaces=await api('/workspaces');}
  $('tracking-workspace-label').style.display='none';
  window.MagemindTrackingBackend?.subscribe(state.workspace,()=>{if(user&&!$('tracking-dialog').open)render();});
 }
 let sessionReady=null;
 async function ready(){
  if(!DB.me||!window.trackingEnabled())return false;if(user?.user_id===DB.me.id&&(state.workspace||observer()))return true;
  if(sessionReady)return sessionReady;const uid=DB.me.id;
  sessionReady=(async()=>{sessionStarted=Date.now();onboardingExpanded=false;user={user_id:uid,email:DB.me.email};let saved={};try{saved=JSON.parse(localStorage.getItem('mm_tracking_state_'+uid)||'{}');for(const k of ['workspace','from','to','currency'])if(saved[k])state[k]=saved[k];}catch{}
   await loadWorkspaces();if(observer())Object.assign(state,{admin_client:'',admin_sort:'newest',admin_workspace:null});if(DB.me?.id!==uid){clear();return false;}state.simulation_only=workspace()?.simulation_only===true;state.preset=periods.presets.some(p=>p.id===saved.preset)?saved.preset:periods.validRange(saved.from,saved.to)?periods.infer(saved.from,saved.to,Date.now(),workspace()?.timezone):'week';syncInputs();return true;
  })().finally(()=>sessionReady=null);return sessionReady;
 }
 function syncInputs(){if(state.preset!=='custom')Object.assign(state,periods.range(state.preset,Date.now(),workspace()?.timezone||'America/Sao_Paulo'));for(const k of ['from','to','currency'])$('tracking-'+k).value=state[k];$('tracking-period-label').textContent=periods.presets.find(p=>p.id===state.preset)?.label||'Período personalizado';$('tracking-period-dates').textContent=state.from===state.to?dateLabel(state.from):dateLabel(state.from)+' — '+dateLabel(state.to);}
 async function render(){
  const version=++requestVersion;if(!await ready()||version!==requestVersion)return;syncInputs();persist();
  const nativePage=routes[state.tab],activePage=document.querySelector('.page.active')?.id;
  const subtitles=observer()?{campaigns:'Resultados e campanhas das operações dos clientes',orders:'Pedidos de todos os clientes e responsáveis',integrations:'Cobertura e situação das conexões dos clientes'}:{campaigns:'Desempenho e otimização dos seus anúncios',orders:'Vendas, pagamentos e informações dos compradores',integrations:'Contas de anúncios, checkouts e origem das vendas'};
  for(const [page,text] of Object.entries(subtitles)){const subtitle=$('pg-'+page)?.querySelector('.ph-sub');if(subtitle)subtitle.textContent=text;}
  if(activePage!=='pg-'+nativePage){$('tracking-module').hidden=true;return;}
  const mount=state.tab==='settings'?$('settings-panel-tracking'):$('tracking-'+nativePage+'-mount');
  if(!mount)return;mount.appendChild($('tracking-module'));$('tracking-module').hidden=false;
  $('tracking-toolbar').hidden=state.tab==='settings'||state.tab==='integrations';
  $('tracking-toolbar').querySelector('.period-label').textContent=state.tab==='overview'?'Visão geral da sua operação':'Período e filtros da operação';
  const el=$('tracking-content');el.innerHTML='<div class="stats-grid">'+[1,2,3,4].map(()=>'<div class="skeleton" aria-label="Carregando"></div>').join('')+'</div>';
  try{const uid=DB.me.id;if(observer()){
   $('tracking-workspace-label').style.display='none';$('tracking-module').classList.remove('mt-campaigns-locked');$('tracking-toolbar').removeAttribute('inert');$('tracking-toolbar').querySelector('.period-label').textContent='Acompanhamento das operações';
   const html=await window.MagemindTrackingAdmin.render({state,api,esc,money,dt,brand,button,select,table,pill,paginate,ads,ordersFilters,detail,modal,render,goTo,setCatalog:rows=>{workspaces=rows;},catalog:()=>workspaces,selectOperation:op=>{state.workspace=op?.id||null;state.admin_workspace=op?.id||null;state.simulation_only=op?.simulation_only===true;state.level='campaign';state.provider='';state.account_id='';state.entity_id='';state.page=1;}});
   if(version===requestVersion&&DB.me?.id===uid)el.innerHTML=html;return;
  }const status=await api('/onboarding');if(version!==requestVersion||DB.me?.id!==uid)return;setup=status;const html=await ({overview,orders,ads,integrations,settings})[state.tab]();if(version!==requestVersion||DB.me?.id!==uid)return;el.innerHTML=html;const locked=Boolean(el.querySelector('.mt-campaigns-lock,.mt-orders-lock'));$('tracking-module').classList.toggle('mt-campaigns-locked',locked);$('tracking-toolbar').toggleAttribute('inert',locked);maybeCelebrate();}
  catch(e){if(version===requestVersion&&user)el.innerHTML='<div class="error-state"><h2>Não foi possível carregar</h2><p>'+esc(e.message)+'</p>'+button('Tentar novamente','refresh')+'</div>';}
 }
 function route(page){closePeriod();if(!window.trackingEnabled()||observer()&&['settings','dashboard'].includes(page)){$('tracking-module').hidden=true;return;}const tab=Object.keys(routes).find(k=>routes[k]===page);requestVersion++;if(!tab){$('tracking-module').hidden=true;return;}if(state.tab!==tab){state.page=1;state.search='';state.provider='';state.status='';state.account_id='';state.entity_id='';if(observer()){state.admin_workspace=null;state.workspace=null;state.admin_sort=tab==='ads'?'spend':'newest';}}state.tab=tab;render();}
 async function overview(){
  const [s,f]=await Promise.all([api('/summary'),api('/funnel')]);
  const count=f.orders.reduce((n,x)=>n+(['paid','refunded','chargeback'].includes(x.status)?Number(x.orders):0),0);
  const roas=s.spend_minor?(Number(s.attributed_minor??(s.gross_minor-s.refund_minor))/s.spend_minor).toFixed(2)+'×':'—';
  const demands='<div class="mt-demand-summary"><div><span>Demandas concluídas</span><strong style="color:var(--emerald)">'+DB.demands.filter(d=>d.status==='Concluído').length+'</strong></div><div><span>Em produção</span><strong style="color:var(--amber)">'+DB.demands.filter(d=>d.status==='Em andamento').length+'</strong></div><div><span>Pendentes</span><strong>'+DB.demands.filter(d=>d.status==='Não iniciado').length+'</strong></div>'+button('Minhas demandas →','native-demands')+'</div>';
  const financeReady=setup.checkout_ready&&setup.ads_ready&&setup.costs_ready;
  const metrics=[metric('Faturamento',money(s.gross_minor),'Vendas aprovadas no período','green'),metric('Lucro estimado',money(s.estimated_minor),'Após taxas, mídia e custos','accent'),metric('Investimento em anúncios',money(s.spend_minor),'Meta Ads e Google Ads'),metric('Vendas aprovadas',count,'Pedidos com pagamento confirmado')];
  const financeAction=!setup.checkout_ready?'setup-checkouts':!setup.ads_ready?'setup-ads':'setup-costs';
  const stats='<div class="stats-grid">'+metrics.map((m,i)=>[setup.checkout_ready,financeReady,setup.ads_ready,setup.checkout_ready][i]?m:quietLock(m,i===1?'Configuração financeira':i===2?'Conta de anúncios':'Checkout',true,i===1?financeAction:null)).join('')+'</div>';
  const chart=panel('Evolução do faturamento',s.daily.length?chartHTML(s.daily):'<div class="mt-chart-placeholder" aria-hidden="true"></div><p>As vendas aprovadas aparecerão aqui.</p>');
  const financial=panel('Resumo financeiro','<div class="list-row"><span>Receita líquida</span><strong>'+money(s.recipient_minor)+'</strong></div><div class="list-row"><span>Devoluções</span><strong>'+money(s.refund_minor)+'</strong></div><div class="list-row"><span>Custos e despesas</span><strong>'+money(s.costs_minor==null?null:Number(s.costs_minor)+Number(s.expense_minor))+'</strong></div><div class="list-row"><span>ROAS</span><strong>'+roas+'</strong></div><div class="list-row"><span>CPA de venda</span><strong>'+(s.paid&&s.spend_minor!=null?money(Math.round(s.spend_minor/s.paid)):'—')+'</strong></div><div class="list-row"><span>Pedidos pendentes</span><strong>'+s.pending+'</strong></div><div class="actions">'+button('Ver todos os pedidos','tab-orders')+button('Configurar custos','tab-settings')+'</div>');
  if(!setup.checkout_ready&&!setup.ads_ready&&!setup.journey_ready){
   const preview='<div class="stats-grid">'+metrics.join('')+'</div><div class="two-cols">'+chart+financial+'</div>'+funnelHTML(f);
   return tutorialHTML()+demands+'<section class="mt-home-gate"><div class="mt-home-gate-head"><div class="mt-home-gate-copy"><span class="eyebrow">CONECTE SUA OPERAÇÃO</span><h2>Seus resultados, em um só lugar</h2><p>Conecte seu checkout e suas contas de anúncios para acompanhar vendas, faturamento e lucro.</p><div class="mt-connect-brands">'+['kiwify','hotmart','meta','google'].map(p=>brand.logo(p)).join('')+'<span>Checkouts e anúncios</span></div></div>'+button('Conectar integrações →','tab-integrations','',true)+'</div><div class="mt-home-preview mt-data-preview" inert aria-hidden="true">'+preview+'</div><div class="mt-home-gate-footer"><span>Pedidos e faturamento</span><span>Lucro e ROAS</span><span>Campanhas e funil</span></div></section>';
  }
  return tutorialHTML()+demands+sourceGuide()+stats+'<div class="two-cols">'+(setup.checkout_ready?chart:quietLock(chart,'Conecte um checkout para acompanhar o faturamento'))+(financeReady?financial:quietLock(financial,'Complete as fontes e os custos da sua operação',false,financeAction))+'</div>'+(setup.journey_ready?funnelHTML(f):quietLock(funnelHTML(f),'Configure o rastreamento para acompanhar o funil',false,'setup-journey'))+'<p class="small">'+(s.estimated_minor==null?'O lucro será calculado quando receita líquida, custos e investimento estiverem disponíveis. ':'Lucro estimado com os custos registrados. ')+'Última venda: '+dt(s.last_order)+'</p>';
 }
 function chartHTML(rows){
  const width=600,height=180,max=Math.max(1,...rows.map(x=>Number(x.gross_minor)));
  const points=rows.map((r,i)=>[20+i*(560/Math.max(1,rows.length-1)),160-Number(r.gross_minor)/max*135]);
  rows=rows.map(r=>({...r,date:String(r.date).slice(0,10)}));
  const line=points.map(([x,y])=>x+','+y).join(' ');
  return '<svg class="chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Receita aprovada por dia"><defs><linearGradient id="tracking-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a47df4" stop-opacity=".25"/><stop offset="100%" stop-color="#a47df4" stop-opacity="0"/></linearGradient></defs><path d="M20 160H580 M20 115H580 M20 70H580 M20 25H580" stroke="#2c2c40" fill="none"/><polygon points="20,160 '+line+' 580,160" fill="url(#tracking-chart-fill)"/><polyline points="'+line+'" stroke="#ad8aff" stroke-width="2.5" fill="none"/>'+points.map(([x,y],i)=>'<circle cx="'+x+'" cy="'+y+'" r="4" fill="#ad8aff"><title>'+esc(rows[i].date+': '+money(rows[i].gross_minor))+'</title></circle>').join('')+'</svg><div class="legend"><span>'+esc(rows[0].date)+'</span><span>Receita bruta de pedidos · '+esc(state.currency)+'</span><span>'+esc(rows.at(-1).date)+'</span></div>';
 }
 async function orders(){
  if(!setup.checkout_ready)return '<div class="mt-orders-lock">'+lockView('<div class="filters"><div class="mt-preview-line"></div></div>'+panel('Todos os pedidos',table(['Pedido','Comprador','Status','Pagamento','Valor'],[1,2,3,4].map(()=>'<tr>'+[1,2,3,4,5].map(()=>'<td><div class="mt-preview-line"></div></td>').join('')+'</tr>'))),'Conecte seu checkout para receber os pedidos','setup-checkouts',['kiwify','hotmart'])+'</div>';
  const data=await api('/list/orders',null,{search:state.search,status:state.status,provider:state.provider,channel:state.channel,payment:state.payment});
  return '<div class="panel-head"><span class="small">'+data.total+' pedidos no período</span>'+button('Exportar pedidos','export')+'</div>'+ordersFilters()+panel('Todos os pedidos',data.rows.length?table(['Pedido / checkout','Comprador','Status','Pagamento','Valor','Origem','Criado',''],data.rows.map(o=>'<tr><td>'+esc(o.external_id)+'<small>'+esc(o.provider)+'</small></td><td>'+esc(o.buyer_name||'Não informado')+'</td><td>'+pill(o.status)+(o.renewal?' <small>Renovação</small>':'')+'</td><td>'+esc(o.payment_method==='CREDIT_CARD'?'Cartão':o.payment_method==='PIX'?'Pix':o.payment_method||'—')+'</td><td>'+money(o.gross_minor)+'</td><td>'+esc(o.channel==='unattributed'?'Não atribuído':o.channel||'—')+'</td><td>'+dt(o.created_at)+'</td><td>'+button('Detalhes','order','data-id="'+esc(o.id)+'"')+'</td></tr>'))+paginate(data.total):'<p>Nenhum pedido encontrado. Ajuste a busca ou conecte seu checkout em Integrações.</p>');
 }

 async function ads(){
  const [d,opts,integrations]=await Promise.all([api('/ad-management'),api('/ad-options'),api('/integrations')]);
  const connected=integrations.filter(i=>['meta','google','tiktok'].includes(i.provider)&&i.connected);
  if(!connected.length){
   if(observer())return '<div class="mt-admin-empty"><div class="mt-connect-brands">'+['meta','google','tiktok'].map(p=>brand.logo(p)).join('')+'</div><h3>Esta operação ainda não tem contas de anúncios conectadas</h3><p>As campanhas aparecerão aqui quando o responsável conectar uma conta.</p></div>';
   const preview=['meta','google','tiktok'].map(p=>'<section class="mt-platform-group mt-platform-'+p+'"><div class="mt-platform-heading">'+brand.logo(p)+'<h2>'+brand.name(p)+'</h2></div><div class="mt-campaign-grid">'+[1,2].map(()=>'<article class="mt-campaign-card"><div class="mt-preview-line"></div><div class="mt-preview-line short"></div><div class="mt-preview-metrics">'+[1,2,3,4].map(()=>'<span></span>').join('')+'</div></article>').join('')+'</div></section>').join('');
   return '<div class="mt-campaigns-lock"><div class="mt-campaigns-preview" inert aria-hidden="true">'+preview+'</div><div class="mt-connect-overlay"><div class="mt-connect-message"><div class="mt-connect-brands">'+['meta','google','tiktok'].map(p=>brand.logo(p)).join('')+'</div><h2>Conecte sua conta de anúncios</h2><p>Veja suas campanhas, acompanhe os resultados e gerencie os anúncios por aqui.</p>'+button('Conectar conta de anúncios','ad-integrations','',true)+'</div></div></div>';
  }
  const levels={campaign:'Campanhas',group:'Conjuntos / grupos',ad:'Anúncios'};
  const rows=d.rows.filter(r=>r.connected&&r.level===state.level&&(!state.provider||r.provider===state.provider)&&(!state.account_id||r.account_id===state.account_id)&&(!state.entity_id||r.entity_id===state.entity_id||r.parent_id===state.entity_id||d.rows.find(p=>p.provider===r.provider&&p.account_id===r.account_id&&p.entity_id===r.parent_id)?.parent_id===state.entity_id));
  const toggle=r=>observer()?'<span class="pill '+(r.status==='ACTIVE'?'paid':'pending')+'">'+(r.status==='ACTIVE'?'Ativo':'Pausado')+'</span>':'<button class="status-switch" role="switch" aria-label="'+(r.status==='ACTIVE'?'Desativar ':'Ativar ')+esc(r.name)+'" aria-checked="'+(r.status==='ACTIVE')+'" data-action="ad-status" data-provider="'+esc(r.provider)+'" data-account="'+esc(r.account_id)+'" data-entity="'+esc(r.entity_id)+'" data-status="'+(r.status==='ACTIVE'?'PAUSED':'ACTIVE')+'" data-revision="'+r.revision+'" '+(!r.connected||(r.mode!=='simulated'&&!(pilot&&r.provider==='meta'))||!['owner','admin'].includes(workspace()?.role)?'disabled':'')+'><span aria-hidden="true"></span>'+(r.status==='ACTIVE'?'Ativo':'Pausado')+'</button>';
  const stat=(label,value)=>'<div><span>'+label+'</span><strong>'+esc(value)+'</strong></div>';
  const groups=['meta','google','tiktok'].map(p=>{const entries=rows.filter(r=>r.provider===p).sort((a,b)=>Number(b.effective_active)-Number(a.effective_active)||Number(b.status==='ACTIVE')-Number(a.status==='ACTIVE')||Number(b.spend_minor||0)-Number(a.spend_minor||0)||a.name.localeCompare(b.name,'pt-BR'));if(!entries.length)return '';return '<section class="mt-platform-group mt-platform-'+p+'" data-platform="'+p+'"><div class="mt-platform-heading">'+brand.logo(p)+'<h2>'+brand.name(p)+'</h2><span>'+entries.length+' '+levels[state.level].toLowerCase()+'</span></div><div class="mt-campaign-grid">'+entries.map(r=>'<article class="mt-campaign-card"><div class="mt-campaign-top"><div><h3>'+esc(r.name)+'</h3><span class="small">Conta '+esc(r.account_id)+'</span></div>'+toggle(r)+'</div>'+(r.status==='ACTIVE'&&!r.effective_active?'<p class="mt-parent-paused">Campanha ou conjunto pausado</p>':'')+'<div class="mt-campaign-metrics">'+stat('Investimento',r.spend_minor==null?'—':money(r.spend_minor))+stat('Vendas',r.checkout_purchases)+stat('CPA',r.checkout_purchases&&r.spend_minor!=null?money(Math.round(r.spend_minor/r.checkout_purchases)):'—')+stat('Impressões',Number(r.impressions||0).toLocaleString('pt-BR'))+stat('Cliques',Number(r.clicks||0).toLocaleString('pt-BR'))+stat('Conversões da rede',r.network_purchases??'—')+'</div></article>').join('')+'</div></section>';}).join('');
  return '<div class="mt-level-tabs">'+Object.entries(levels).map(([k,v])=>'<button class="quiet" data-action="ad-level" data-level="'+k+'" aria-pressed="'+(state.level===k)+'">'+v+'</button>').join('')+'</div><div class="filters">'+select('filter-provider','Plataforma',[['','Todas'],...['meta','google','tiktok'].filter(p=>connected.some(i=>i.provider===p)).map(p=>[p,brand.name(p)])],state.provider)+select('filter-account_id','Conta',[['','Todas'],...opts.accounts.map(a=>[a.account_id,brand.name(a.provider)+' / '+a.name])],state.account_id)+select('filter-entity_id','Campanha',[['','Todas'],...opts.entities.filter(e=>e.level==='campaign').map(e=>[e.entity_id,e.name])],state.entity_id)+button('Aplicar','filter')+'</div>'+(groups||'<div class="empty"><h2>Nenhuma campanha encontrada</h2><p>Ajuste os filtros para consultar as campanhas disponíveis neste período.</p></div>');
 }
 function funnelHTML(d){
  const stages=[['page_view','Visitas'],['view_content','Conteúdo'],['add_to_cart','Carrinho'],['checkout_click','Checkout'],['initiate_checkout','Checkout iniciado']];
  const max=Math.max(1,...d.rows.map(r=>Number(r.sessions)));
  return panel('Funil de vendas','<div class="two-cols"><div>'+stages.map(([key,label])=>{const n=Number(d.rows.find(r=>r.event_name===key)?.sessions||0);return '<div class="funnel-row"><span>'+label+'</span><div class="funnel-bar"><svg viewBox="0 0 100 22" preserveAspectRatio="none" width="100%" aria-hidden="true"><rect width="'+(n?Math.max(2,n/max*100):0)+'" height="22" fill="#8b5cf6"/></svg></div><strong>'+n+'</strong></div>';}).join('')+'</div><div>'+d.orders.map(r=>'<div class="list-row"><span>'+esc(statusLabel[r.status]||r.status)+'</span><strong>'+Number(r.orders)+'</strong></div>').join('')+'<p class="small">Visitas e etapas observadas no seu site. Os pedidos são confirmados pelo checkout.</p></div></div>');
 }
 async function integrations(){
  const data=await api('/integrations');
  const card=p=>{
   const rows=data.filter(i=>i.provider===p),checkout=checkoutProviders.includes(p),available=p==='meta'||checkout||p==='custom';
   const heading='<div class="mt-integration-brand">'+brand.logo(p)+'<h3>'+brand.name(p)+'</h3></div>';
   if(pilot&&!available)return '<article class="integration-card mt-integration-'+p+'">'+heading+'<p>Conector em preparação para uma próxima etapa.</p>'+pill('Em breve')+'</article>';
   return '<article class="integration-card mt-integration-'+p+'">'+heading+'<p>'+(p==='meta'?'Entre com sua conta Meta e escolha as contas de anúncios.':checkout?'Receba pedidos e pagamentos por webhook.':'Pedidos enviados pela API da sua operação.')+'</p>'+rows.map(i=>'<div class="list-row"><span>'+esc(i.name||brand.name(p))+'<small><br>'+esc(checkout?'Último pedido recebido: ':'Última atualização: ')+dt(i.last_received_at||i.last_sync_at)+'</small></span>'+pill(i.error_code&&i.error_code!=='sync_requested'?'Requer atenção':!i.connected?'Desconectado':i.error_code==='sync_requested'?'Sincronizando':checkout&&!i.last_received_at?'Aguardando pedidos':'Conectado')+'</div><div class="actions">'+(i.connected?(checkout?button('Ver webhook','webhook-details','data-id="'+esc(i.id)+'"'):p==='custom'?button('Credencial da API','token','data-id="'+esc(i.id)+'"'):button('Sincronizar','sync','data-id="'+esc(i.id)+'"'))+button('Desconectar','disconnect','data-id="'+esc(i.id)+'"'):button('Reconectar','connect','data-provider="'+p+'"'))+'</div>').join('')+(!rows.length||p==='meta'?'<div class="actions">'+button(rows.length?'Conectar outra conta':'Conectar','connect','data-provider="'+p+'"',true)+'</div>':'')+'</article>';
  };
  return brand.integrationSections(card)+panel('Origem das vendas','<p>UTMs identificam o anúncio que originou cada pedido. O script próprio permite acompanhar também as visitas e etapas do funil.</p><div class="actions">'+button('Script e UTMs','sites')+button('Selecionar produtos','products')+'</div>');
 }
 async function costs(){
  costRules=await api('/costs');const rows=costRules.filter(r=>costHistory||!r.archived_at);
  const labels={product:'Custo do produto',tax:'Imposto',fee:'Taxa de pagamento',expense:'Custo adicional'};
  const calculation=r=>r.calculation==='percentage'?Number(r.rate_bps)/100+'% sobre vendas aprovadas':r.calculation==='fixed_per_item'?money(r.amount_minor,r.currency)+' por unidade':r.calculation==='fixed_per_sale'?money(r.amount_minor,r.currency)+' por venda':r.calculation==='fixed_once'?money(r.amount_minor,r.currency)+' · despesa registrada':(r.amount_minor!=null?money(r.amount_minor,r.currency):'')+(r.rate_bps?' + '+Number(r.rate_bps)/100+'%':'');
  return '<div class="panel-head"><p class="small">As alterações valem para as próximas aprovações. Os custos das vendas anteriores ficam preservados.</p>'+button('Adicionar custo','cost-form','',true)+'</div><div class="actions mt-cost-tabs">'+button(costHistory?'Mostrar apenas ativos':'Ver histórico','cost-history','aria-pressed="'+costHistory+'"')+'</div>'+panel(costHistory?'Histórico de custos':'Custos ativos',rows.length?table(['Custo','Tipo','Cálculo','Aplicado a','Status',''],rows.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+esc(labels[r.category])+'</td><td>'+esc(calculation(r))+'</td><td>'+esc(r.product_id||'Todos os produtos')+'<small>'+esc(r.provider?brand.name(r.provider):'Todos os checkouts')+' · '+esc(r.currency)+'</small></td><td>'+pill(r.archived_at?'Encerrado':'Ativo')+'</td><td>'+(r.archived_at?'<small>Histórico preservado</small>':'<div class="actions">'+button('Editar','cost-edit','data-id="'+esc(r.id)+'"')+button('Remover','cost-remove','data-id="'+esc(r.id)+'"')+'</div>')+'</td></tr>')):'<p>Adicione o custo do produto, impostos e outras taxas para acompanhar seu lucro.</p>');
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
  modal('Pedido '+o.external_id,pill(o.status)+'<dl class="detail-grid">'+Object.entries({'Checkout':o.provider,'Pagamento':o.payment_method||'Indisponível','Bruto':money(o.gross_minor),'Receita do usuário':money(o.recipient_minor),'Devolvido':money(o.refund_minor),'Comprador':o.buyer_name||'Indisponível','E-mail':o.buyer_email||'Indisponível','Telefone':o.buyer_phone||'Indisponível','Criado':dt(o.created_at),'Aprovado':dt(o.approved_at),'Origem':a.channel||'Não atribuído','Evidência':a.evidence||'Indisponível','Anúncio':a.ad_id||'Sem anúncio validado','Confiança':a.confidence||'Baixa'}).map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>'+(o.money_components?.manual_fees?'<p class="mt-cost-explanation">A loja informou o valor bruto. O resultado é estimado com as taxas e os custos cadastrados na sua conta.</p>':'')+'<h3>Itens</h3>'+table(['Produto','Quantidade','Total da linha'],d.items.map(i=>'<tr><td>'+esc(i.name)+'</td><td>'+i.quantity+'</td><td>'+money(i.amount_minor)+'</td></tr>'))+'<h3>Origem da venda</h3><p>'+esc(a.channel==='unattributed'?'Não atribuído':a.channel||'Não informado')+' · '+esc(a.utm_campaign||'Sem campanha informada')+'</p><h3>Histórico auditável</h3><ul class="timeline">'+d.history.map(e=>'<li>'+dt(e.occurred_at)+'<strong>'+esc(statusLabel[e.status])+' · '+esc(e.processing)+'</strong><small>'+esc(e.reason||e.event_key)+'</small></li>').join('')+'</ul>');
 }
 async function customerDetail(id){
  const d=await api('/customer',null,{id});modal(d.customer.name||'Comprador','<p>'+esc(d.customer.email||'E-mail não informado')+' · '+esc(d.customer.phone||'Telefone não informado')+'</p>'+table(['Pedido','Status','Moeda','Total',''],d.orders.map(o=>'<tr><td>'+esc(o.external_id)+'</td><td>'+pill(o.status)+'</td><td>'+esc(o.currency)+'</td><td>'+esc(Number(o.gross_minor)/10**o.amount_scale)+'</td><td>'+button('Abrir','order','data-id="'+esc(o.id)+'"')+'</td></tr>'))+'<p class="small">Até 25 compras recentes. Identidade canônica '+esc(d.customer.provider)+' / '+esc(d.customer.external_id)+'.</p>');
 }
 async function sitesForm(){
  const sites=await api('/sites');
  modal('Script próprio e UTMs','<form data-form="site" class="form-grid"><label>Domínio do seu site<input name="domain" value="'+esc(location.hostname)+'" required></label><label>Domínios dos checkouts (vírgula)<input name="checkout_domains" value="pay.kiwify.com.br,pay.hotmart.com"></label><button class="primary wide">Cadastrar domínio</button></form>'+sites.map(s=>'<h3>'+esc(s.domain)+'</h3><pre class="code">'+esc('<script src="'+location.origin+'/magemind-collect-v1.js" data-endpoint="'+location.origin+cfg.apiBase+'/collect" data-site="'+s.public_key+'" data-checkouts="'+s.checkout_domains.join(',')+'" data-consent="denied"></script>')+'</pre><p class="small">Conceda consentimento pela API MagemindCollect.consent(true). Sem consentimento, nenhuma persistência ou envio ocorre.</p>').join('')+'<h3>Meta Ads</h3><pre class="code">utm_source=meta&amp;utm_medium=paid_social&amp;utm_campaign={{campaign.id}}&amp;utm_term={{adset.id}}&amp;utm_content={{ad.id}}</pre><h3>Google Ads</h3><pre class="code">utm_source=google&amp;utm_medium=cpc&amp;utm_campaign={campaignid}&amp;utm_term={adgroupid}&amp;utm_content={creative}</pre><p class="small">A ponte de click_id usa sck apenas se vazio e preserva valores legados. Confirme a devolução desse campo pelo checkout. Macros indisponíveis em um formato não são inventadas.</p>');
 }
 async function costForm(row=null){
  costProducts=await api('/cost-products');const category=row?.category||'product';
  const mode=row?.calculation==='legacy'?(category==='tax'?'percentage':category==='product'?'fixed_per_item':row.rate_bps?'percentage':'fixed_per_sale'):row?.calculation||'fixed_per_item';
  const known=costProducts.findIndex(p=>p.product_id===row?.product_id&&p.provider===row?.provider&&p.currency===row?.currency);
  modal(row?'Editar custo':'Adicionar custo','<form data-form="cost" class="form-grid"><input type="hidden" name="id" value="'+esc(row?.id||'')+'"><label>Nome do custo<input name="name" required maxlength="120" value="'+esc(row?.name||'')+'" placeholder="Ex.: Produto, imposto ou embalagem"></label>'+select('cost-category','Tipo de custo',[['product','Custo do produto'],['tax','Imposto'],['fee','Taxa de pagamento'],['expense','Custo adicional']],category)+select('cost-calculation','Como calcular',[['fixed_per_item','Valor fixo por unidade'],['fixed_per_sale','Valor fixo por venda aprovada'],['percentage','Porcentagem sobre vendas aprovadas']],mode)+select('cost-currency','Moeda',[['BRL','BRL'],['USD','USD'],['EUR','EUR'],['JPY','JPY'],['KWD','KWD']],row?.currency||state.currency)+'<label><span id="cost-amount-label">Valor em '+esc(row?.currency||state.currency)+'</span><input name="amount" inputmode="decimal" value="'+esc(row?.amount_minor!=null?(Number(row.amount_minor)/10**scale[row.currency]).toFixed(scale[row.currency]).replace('.',','):'')+'" placeholder="0,00"></label><label>Percentual (%)<input name="rate" inputmode="decimal" value="'+esc(row?.rate_bps!=null?(row.rate_bps/100).toFixed(2).replace('.',','):'')+'" placeholder="0,00"></label>'+select('cost-product','Produto',[['','Todos os produtos'],...costProducts.map((p,i)=>[String(i),p.name+' · '+brand.name(p.provider)+' · '+p.currency]),['manual','Informar ID do produto']],known>=0?String(known):row?.product_id?'manual':'')+'<label id="cost-product-id-label">ID do produto<input name="product_id" value="'+esc(row?.product_id||'')+'" maxlength="200" placeholder="ID recebido pelo checkout"></label>'+select('cost-provider','Checkout',[['','Todos os checkouts'],['kiwify','Kiwify'],['hotmart','Hotmart'],['cartpanda','Cartpanda'],['perfectpay','PerfectPay'],['custom','API própria']],row?.provider||'')+'<div class="mt-cost-explanation wide" id="cost-explanation" role="status"></div><button class="primary wide">'+(row?'Salvar alteração':'Adicionar custo')+'</button><p class="small wide">A configuração começa a valer agora, nas próximas aprovações. Editar ou remover não recalcula vendas anteriores.</p></form>');
  updateCostForm();
 }
 function updateCostForm(){
  const f=$('dialog-content').querySelector('[data-form="cost"]');if(!f)return;
  const cat=$('cost-category').value,c=$('cost-calculation'),product=cat==='product',tax=cat==='tax';
  for(const option of c.options)option.hidden=product?option.value!=='fixed_per_item':tax?option.value!=='percentage':option.value==='fixed_per_item';
  if(product)c.value='fixed_per_item';else if(tax)c.value='percentage';else if(c.value==='fixed_per_item')c.value='fixed_per_sale';
  c.disabled=product||tax;const percentage=c.value==='percentage';
  f.elements.amount.disabled=percentage;f.elements.amount.required=!percentage;f.elements.rate.disabled=!percentage;f.elements.rate.required=percentage;
  if(percentage)f.elements.amount.value='';else f.elements.rate.value='';
  $('cost-product').closest('label').hidden=!product;$('cost-product').disabled=!product;
  const value=$('cost-product').value,known=product&&/^\d+$/.test(value)?costProducts[Number(value)]:null,manual=product&&value==='manual';
  $('cost-product-id-label').hidden=!manual;f.elements.product_id.disabled=!manual;f.elements.product_id.required=manual;
  $('cost-provider').disabled=Boolean(known);if(known){$('cost-provider').value=known.provider;$('cost-currency').value=known.currency;}
  $('cost-currency').disabled=Boolean(known);const cur=$('cost-currency').value;
  $('cost-amount-label').textContent='Valor em '+cur+(product?' por unidade':' por venda');
  $('cost-explanation').innerHTML='<strong>'+esc(tax?'Imposto sobre o faturamento aprovado':product?'Custo por unidade vendida':percentage?'Percentual sobre as vendas aprovadas':'Valor aplicado a cada venda aprovada')+'</strong><p>'+esc(cat==='fee'?'A taxa é usada apenas quando o checkout não informa a receita líquida nem a taxa real, evitando desconto em duplicidade.':product?'O custo é multiplicado pela quantidade do produto no pedido. Produtos com uma configuração específica usam essa configuração.':percentage?'O percentual será aplicado sobre o valor bruto do pedido aprovado.':'O valor será descontado uma vez por pedido aprovado.')+'</p>';
 }
 document.addEventListener('change',e=>{if(e.target.closest('[data-form="cost"]'))updateCostForm();});
 function minorInput(value,s){if(!value)return null;const parts=value.replace(',','.').split('.');if(parts.length>2||!/^\d+$/.test(parts[0])||!/^[0-9]*$/.test(parts[1]||'')||(parts[1]||'').length>s)throw new Error('Precisão do valor inválida');const n=Number(BigInt(parts[0])*10n**BigInt(s)+BigInt((parts[1]||'').padEnd(s,'0')||'0'));if(!Number.isSafeInteger(n))throw new Error('Valor acima do limite permitido');return n;}
 async function action(name,el){
  if(observer()){if(name==='meta-platform')return connections.platform();if(name.startsWith('admin-'))return window.MagemindTrackingAdmin.action(name,el);if(!['filter','refresh','prev','next','ad-level','welcome-close'].includes(name))throw new Error('Este painel permite apenas visualizar as operações.');}
  if(name==='webhook-details')return connections.details(el.dataset.id);
  if(name==='connection-copy')return connections.copy();
  if(name==='meta-platform')return connections.platform();
  if(name==='connect'&&pilot){const p=el.dataset.provider;if(p==='meta')return connections.meta();if(checkoutProviders.includes(p))return connections.webhook(p);if(p==='custom')return connections.custom();throw new Error('Plataforma indisponível');}
  if(name==='welcome-close')return $('tracking-dialog').close();
  if(name==='setup-checkouts'||name==='setup-ads'||name==='ad-integrations'){goTo('integrations');await render();const heading=$(name==='setup-checkouts'?'integration-checkouts':'integration-ad-managers')?.querySelector('h2');heading?.scrollIntoView({block:'start',behavior:'smooth'});heading?.focus({preventScroll:true});return;}
  if(name==='setup-costs'){goTo('settings');selectSettingsTab('tracking');return;}
  if(name==='setup-orders')return goTo('orders');
  if(name==='setup-journey'){goTo('integrations');await render();return sitesForm();}
  if(name==='setup-zero-cost'){await api('/costs',{name:'Custo do produto',category:'product',calculation:'fixed_per_item',currency:state.currency,amount_minor:0,rate_bps:null,product_id:null,provider:null});toast('Produto sem custo configurado.');return render();}
  if(name==='cost-history'){costHistory=!costHistory;return render();}
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
  if(name==='filter'){for(const k of ['status','provider','channel','payment','account_id','entity_id'])if($('filter-'+k))state[k]=$('filter-'+k).value;state.search=$('tracking-search')?.value||'';state.page=1;return render();}
  if(name==='order')return detail(el.dataset.id);
  if(name==='customer')return customerDetail(el.dataset.id);
  if(name==='ad-level'){state.level=el.dataset.level;return render();}
  if(name==='ad-status'){await api('/ad-status',{provider:el.dataset.provider,account_id:el.dataset.account,entity_id:el.dataset.entity,status:el.dataset.status,revision:Number(el.dataset.revision)});toast(el.dataset.status==='ACTIVE'?'Veiculação ativada.':'Veiculação pausada.');return render();}
  if(name==='sites')return sitesForm();
  if(name==='cost-form')return costForm();
  if(name==='token'){const r=await api('/integration/token',{id:el.dataset.id});modal('Credencial privada da API','<p>'+esc(r.notice)+'</p><textarea readonly aria-label="Token privado da API">'+esc(r.token)+'</textarea><p class="small">Endpoint: POST '+esc(pilot?cfg.supabaseUrl+'/functions/v1/tracking-webhook?provider=custom':location.origin+cfg.apiBase+'/orders')+' · Authorization: Bearer TOKEN</p>');return;}
  if(name==='sync'||name==='revoke'){await api('/integration/sync',{id:el.dataset.id,fail:name==='revoke'});toast('Integração atualizada.');return render();}
  if(name==='disconnect'){await api('/integration/disconnect',{id:el.dataset.id});toast('Credencial revogada; histórico preservado.');return render();}
  if(name==='retry'){await api('/retry',{id:el.dataset.id});toast('Reenvio auditado colocado na fila.');return render();}
  if(name==='export'){
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
  if(!e.target.closest('.mt-root'))return;
  const tab=e.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;state.page=1;return render();}
  const target=e.target.closest('[data-action]');if(!target)return;
  if(!await ready())return;
  target.disabled=true;try{await action(target.dataset.action,target);}catch(err){toast(err.message);}finally{if(target.isConnected)target.disabled=false;}
 });
 document.addEventListener('submit',async e=>{
  const form=e.target.closest('.mt-root [data-form]');if(!form)return;e.preventDefault();const btn=form.querySelector('button[type=submit],button.primary');btn.disabled=true;
  try{
   const data=Object.fromEntries(new FormData(form)),type=form.dataset.form;
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
    const payload={name:data.name,category,calculation,currency,product_id:category==='product'?(known?.product_id||data.product_id||null):null,provider:$('cost-provider').value||null,amount_minor:calculation==='percentage'?null:minorInput(data.amount,scale[currency]),rate_bps:calculation==='percentage'?minorInput(data.rate,2):null};
    if(payload.rate_bps>10000)throw new Error('O percentual deve estar entre 0 e 100%.');
    await api(data.id?'/costs/edit':'/costs',data.id?{id:data.id,...payload}:payload);
   }
   if(type==='settings'){await api('/settings',{...data,attribution_days:Number(data.attribution_days),retention_days:Number(data.retention_days)});await loadWorkspaces();}
   if(type==='preferences'){const prefs={};for(const [k] of notificationPreferences)prefs[k]=form.elements[k].checked;await api('/preferences',prefs);}
   if(type==='checkout-credentials'){
    const secrets={hottok:data.hottok||undefined,access_token:data.access_token||undefined,account_id:data.account_id||undefined,recipientSource:$('recipient-source').value};
    const r=await window.MagemindTrackingBackend.edge({workspace:state.workspace,integration:data.integration,action:'checkout_credentials',secrets});
    modal('Webhook do checkout', '<p>Cadastre este endereço na sua integração. Na Kiwify a chave de ingresso identifica o endpoint; a aprovação continua dependendo da API de vendas.</p><textarea readonly>'+esc(r.webhook)+'</textarea><p class="small">A URL Kiwify é privada; não a compartilhe nem a inclua no script público.</p>');return;
   }
   $('tracking-dialog').close();toast('Alteração salva.');await render();
  }catch(err){toast(err.message);}finally{if(btn.isConnected)btn.disabled=false;}
 });

 async function pollNotifications(){
  if(observer()||notificationPollRunning)return;
  notificationPollRunning=true;try{
  if(!await ready())return;const uid=user.user_id,items=await api('/notifications');if(DB.me?.id!==uid)return;
  const scope=uid+':'+state.workspace,warmed=notificationScope===scope;
  if(!warmed){notificationScope=scope;notificationIds.clear();}
  const fresh=items.filter(n=>!notificationIds.has(n.id));for(const n of items)notificationIds.add(n.id);
  const read=new Set(JSON.parse(localStorage.getItem('mm_tracking_read_'+uid)||'[]'));
  DB.notifications=DB.notifications.filter(n=>!n.trackingWorkspaceId);
  for(const n of items){DB.notifications.push({id:'tracking-'+n.id,to:uid,icon:n.category==='pending'?'◷':['refund','chargeback'].includes(n.category)?'↩':['refused','cancelled','failure'].includes(n.category)?'!':'↗',iconBg:n.category==='pending'?'var(--amberbg)':['refused','cancelled','chargeback','failure'].includes(n.category)?'var(--rosebg)':'var(--emeraldbg)',title:notificationTitles[n.category]||'Atualização do pedido',body:notificationBody(n),date:'',time:n.created_at||n.delivered_at||n.next_attempt_at?dt(n.created_at||n.delivered_at||n.next_attempt_at):'',read:read.has('tracking-'+n.id),createdAt:n.created_at||n.delivered_at||n.next_attempt_at,trackingOrderId:n.order_id,trackingWorkspaceId:state.workspace});}
  updateNotifBadge();if($('notif-panel')?.style.display==='block')renderNotifPanel();
  if(warmed&&fresh.length)toast(fresh.length===1?[(notificationTitles[fresh[0].category]||'Atualização do pedido'),notificationBody(fresh[0])].filter(Boolean).join(' · '):fresh.length+' novas atualizações de pedidos');
  const status=await api('/onboarding');if(DB.me?.id!==uid)return;const changed=JSON.stringify(status)!==JSON.stringify(setup);setup=status;
  if(changed&&state.tab==='overview'&&!$('tracking-dialog').open&&document.querySelector('.page.active')?.id==='pg-dashboard')await render();else maybeCelebrate();
  }finally{notificationPollRunning=false;}
 }
 window.MagemindTrackingNative={route,open:()=>goTo('dashboard'),clear,renderDemandStatus(){const rows=[['Não iniciado','Pendentes','var(--text3)'],['Em andamento','Em produção','var(--amber)'],['Concluído','Concluídas','var(--emerald)']];const total=DB.demands.length;$('demand-status-bars').innerHTML=rows.map(([key,label,color])=>{const n=DB.demands.filter(d=>d.status===key).length;return '<div class="list-row" style="margin-bottom:12px;font-size:11px"><span>'+label+'</span><strong style="float:right;color:'+color+'">'+n+'</strong><div style="height:4px;background:var(--bg3);border-radius:4px;margin-top:6px"><div style="width:'+(total?n/total*100:0)+'%;height:4px;border-radius:4px;background:'+color+'"></div></div></div>';}).join('');}};
 window.MagemindTracking={open:()=>goTo('dashboard')};
 const previousMyNotifs=window.myNotifs;
 window.myNotifs=()=>{const rows=previousMyNotifs();return window.trackingEnabled()?rows.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)):rows;};
 const previousClickNotif=window.clickNotif;
 window.clickNotif=async(id,demandId)=>{const n=DB.notifications.find(x=>x.id===id);if(!n?.trackingWorkspaceId)return previousClickNotif(id,demandId);const key='mm_tracking_read_'+DB.me.id,read=new Set(JSON.parse(localStorage.getItem(key)||'[]'));read.add(id);localStorage.setItem(key,JSON.stringify([...read]));n.read=true;updateNotifBadge();closeNotifPanel();state.workspace=n.trackingWorkspaceId;goTo(n.trackingOrderId?'orders':'integrations');await render();if(n.trackingOrderId)await detail(n.trackingOrderId,n.trackingWorkspaceId);};
 const oldMarkAll=window.markAllRead;
 window.markAllRead=async()=>{if(!window.trackingEnabled())return oldMarkAll();const read=new Set(JSON.parse(localStorage.getItem('mm_tracking_read_'+DB.me.id)||'[]'));DB.notifications.filter(n=>n.trackingWorkspaceId).forEach(n=>{read.add(n.id);n.read=true;});localStorage.setItem('mm_tracking_read_'+DB.me.id,JSON.stringify([...read]));await oldMarkAll();updateNotifBadge();renderNotifPanel();};
 $('tracking-refresh').addEventListener('click',render);
 $('tracking-currency').addEventListener('change',()=>{state.currency=$('tracking-currency').value;state.page=1;render();});
 function closePeriod(){const p=$('tracking-period-popover');if(p?.matches(':popover-open'))p.hidePopover();}
 function positionPeriod(){
  const p=$('tracking-period-popover');if(!p.matches(':popover-open'))return;
  const r=$('tracking-period-toggle').getBoundingClientRect(),box=p.getBoundingClientRect();
  p.style.left=Math.max(16,Math.min(r.right-box.width,innerWidth-box.width-16))+'px';
  p.style.top=Math.max(16,Math.min(r.bottom+8,innerHeight-box.height-16))+'px';
 }
 function periodOptions(selected=state.preset){$('tracking-period-options').innerHTML=periods.presets.map(p=>'<button type="button" class="mt-period-option" data-period="'+p.id+'" aria-pressed="'+(p.id===selected)+'"><span>'+p.label+(p.hint?'<small>'+p.hint+'</small>':'')+'</span><span class="mt-period-check" aria-hidden="true">✓</span></button>').join('');}
 function showPeriod(){
  const p=$('tracking-period-popover');if(p.matches(':popover-open'))return closePeriod();
  periodOptions();$('tracking-custom-period').hidden=true;$('tracking-period-error').hidden=true;p.showPopover();positionPeriod();
  p.querySelector('[aria-pressed=true]')?.focus({preventScroll:true});
 }
 $('tracking-period-toggle').addEventListener('click',showPeriod);
 $('tracking-period-popover').addEventListener('toggle',e=>{$('tracking-period-toggle').setAttribute('aria-expanded',String(e.newState==='open'));});
 $('tracking-period-options').addEventListener('click',async e=>{
  const target=e.target.closest('[data-period]');if(!target)return;
  if(target.dataset.period==='custom'){periodOptions('custom');$('tracking-from').value=state.from;$('tracking-to').value=state.to;$('tracking-custom-period').hidden=false;$('tracking-period-error').hidden=true;positionPeriod();$('tracking-from').focus({preventScroll:true});return;}
  state.preset=target.dataset.period;state.page=1;closePeriod();syncInputs();persist();await render();$('tracking-period-toggle').focus({preventScroll:true});
 });
 $('tracking-custom-period').addEventListener('submit',async e=>{
  e.preventDefault();const from=$('tracking-from').value,to=$('tracking-to').value;
  if(!periods.validRange(from,to)){$('tracking-period-error').textContent='A data final deve ser igual ou posterior à data inicial.';$('tracking-period-error').hidden=false;positionPeriod();return;}
  Object.assign(state,{from,to,preset:'custom',page:1});closePeriod();syncInputs();persist();await render();$('tracking-period-toggle').focus({preventScroll:true});
 });
 $('tracking-period-cancel').addEventListener('click',()=>{closePeriod();$('tracking-period-toggle').focus({preventScroll:true});});
 $('tracking-period-popover').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closePeriod();$('tracking-period-toggle').focus({preventScroll:true});}});
 $('tracking-period-options').addEventListener('keydown',e=>{
  const buttons=[...e.currentTarget.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
  e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();
 });
 window.addEventListener('resize',positionPeriod);
 document.addEventListener('scroll',e=>{if(!$('tracking-period-popover').contains(e.target))positionPeriod();},true);
 $('close-dialog').addEventListener('click',()=>$('tracking-dialog').close());
 $('tracking-dialog').addEventListener('close',()=>$('dialog-content').replaceChildren());
 document.addEventListener('magemind:session-ready',async()=>{if(!window.trackingEnabled())return;route('dashboard');const callback=new URLSearchParams(location.search),grant=callback.get('tracking_oauth'),failed=callback.has('tracking_oauth_error');if(grant||failed){history.replaceState(null,'',location.pathname);try{await ready();if(grant&&callback.get('tracking_workspace')===state.workspace&&!observer()){goTo('integrations');await render();await connections.accounts(grant);}else toast('A autorização da Meta não foi concluída. Tente conectar novamente.');}catch(e){toast(e.message);}} pollNotifications().catch(()=>{});const qs=new URLSearchParams(location.search);if(qs.get('order')){await ready();if(qs.get('workspace')&&workspaces.some(w=>w.id===qs.get('workspace')))state.workspace=qs.get('workspace');goTo('orders');await render();detail(qs.get('order'),qs.get('workspace')||state.workspace).catch(e=>toast(e.message));}});
 document.addEventListener('magemind:tracking-signed-out',clear);
 navigator.serviceWorker?.addEventListener('message',async e=>{if(e.data?.type!=='OPEN_TRACKING_ORDER'||!await ready())return;await loadWorkspaces();if(!workspaces.some(w=>w.id===e.data.workspaceId))return;state.workspace=e.data.workspaceId;goTo(e.data.orderId?'orders':'integrations');await render();if(e.data.orderId)detail(e.data.orderId,e.data.workspaceId).catch(err=>toast(err.message));});
 setInterval(()=>{if(DB.me)pollNotifications().catch(()=>{});},5000);
 if(DB.me)route(document.querySelector('.page.active')?.id?.slice(3)||'dashboard');
})();
