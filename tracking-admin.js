(() => {
 'use strict';
 let current=null;
 const number=n=>Number(n||0).toLocaleString('pt-BR');
 const eye='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
 const readOnly=()=>'<span class="mt-admin-readonly">'+eye+'Somente leitura</span>';
 function query(c){const s=c.state;return {admin_client:s.admin_client||'',admin_mode:s.admin_mode||'real',admin_sort:s.admin_sort||'newest',search:s.search||'',status:s.status||'',provider:s.provider||'',channel:s.channel||'',payment:s.payment||''};}
 const call=(c,route,extra={})=>c.api('/admin/'+route,null,{...query(c),...extra});
 const money=(c,n)=>n==null?'—':c.money(n);
 function metric(c,label,value,hint='',tone=''){return '<div class="mt-admin-metric '+tone+'"><span>'+c.esc(label)+'</span><strong>'+c.esc(value)+'</strong>'+(hint?'<small>'+c.esc(hint)+'</small>':'')+'</div>';}
 function heading(c,title,subtitle,back=false,refresh=false){return '<div class="mt-admin-heading"><div>'+(back?c.button('← Todas as operações','admin-back'):'<span class="eyebrow">ACOMPANHAMENTO</span>')+'<h2>'+c.esc(title)+'</h2><p>'+c.esc(subtitle)+'</p></div><div class="mt-admin-heading-actions">'+readOnly()+(refresh?c.button('Atualizar indicadores','refresh'):'')+'</div></div>';}
 function filters(c,kind){
  const s=c.state,owners=new Map();for(const w of c.catalog().filter(w=>w.simulation_only===(s.admin_mode==='demo')))owners.set(w.owner_id,w.client_name);
  const clients=[['','Todos os clientes e contas'],...[...owners].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR'))];
  return '<div class="mt-admin-filters">'+c.select('admin-client','Cliente / responsável',clients,s.admin_client||'')+c.select('admin-mode','Visualização',[['real','Operações reais'],['demo','Demonstrações']],s.admin_mode||'real')+
   (kind==='orders'?c.select('admin-sort','Ordenar pedidos',[['newest','Mais recentes'],['oldest','Mais antigos'],['amount_desc','Maior valor'],['amount_asc','Menor valor'],['client','Nome do cliente']],['newest','oldest','amount_desc','amount_asc','client'].includes(s.admin_sort)?s.admin_sort:'newest'):
   kind==='operations'?c.select('admin-sort','Ordenar operações',[['spend','Maior investimento'],['revenue','Maior faturamento']],s.admin_sort==='revenue'?'revenue':'spend'):
   c.select('admin-platform','Plataforma',[['','Todas as plataformas'],...['meta','google','tiktok','kiwify','hotmart','custom'].map(p=>[p,c.brand.name(p)])],s.admin_platform||''))+'</div>';
 }
 function operationCard(c,w){
  const s=w.s,profit=s.estimated_minor;
  return '<button type="button" class="mt-admin-operation" data-action="admin-operation" data-id="'+c.esc(w.id)+'"><div class="mt-admin-operation-head"><span class="mt-admin-avatar">'+c.esc(w.client_name.split(' ').map(x=>x[0]).slice(0,2).join(''))+'</span><div><h3>'+c.esc(w.client_name)+'</h3><p>'+c.esc(w.name)+'</p></div><span class="mt-admin-roas" title="Receita atribuída dividida pelo investimento em anúncios">'+(w.roas==null?'ROAS —':'ROAS '+Number(w.roas).toFixed(2)+'×')+'</span></div><div class="mt-admin-operation-metrics">'+
   metric(c,'Faturamento',money(c,s.gross_minor))+metric(c,'Investimento',money(c,s.spend_minor))+metric(c,'Lucro estimado',money(c,profit),'',profit==null?'':profit<0?'negative':'positive')+metric(c,'ROI',w.roi==null?'—':number(w.roi)+'%','',w.roi==null?'':w.roi<0?'negative':'positive')+'</div><div class="mt-admin-operation-footer"><span class="mt-admin-platforms">'+w.platforms.map(p=>c.brand.logo(p)).join('')+'<small>'+number(w.approved_orders)+' vendas aprovadas</small></span><span class="mt-admin-open">Ver campanhas →</span></div></button>';
 }
 async function operations(c){
  const d=await call(c,'operations'),s=d.summary,measured=d.rows.filter(w=>w.s.spend_minor!=null),measuredRevenue=measured.reduce((n,w)=>n+Number(w.s.attributed_minor||0),0),roas=s.spend_minor>0?Number(measuredRevenue/s.spend_minor).toFixed(2)+'×':'—';
  const overview=c.state.tab==='overview';
  return heading(c,overview?'Resultados das operações':'Campanhas por operação','Compare os resultados dos clientes e abra uma operação para acompanhar suas campanhas.')+filters(c,'operations')+
   '<div class="mt-admin-kpis">'+metric(c,'Operações',number(s.operations),number(s.clients)+' clientes / responsáveis')+metric(c,'Faturamento',money(c,s.gross_minor),number(s.approved_orders)+' vendas aprovadas')+metric(c,'Investimento em anúncios',money(c,s.spend_minor),number(s.spend_known)+' operações com dados no período')+metric(c,'ROAS',roas,number(s.spend_known)+' de '+number(s.operations)+' operações com mídia disponível')+'</div>'+
   '<div class="mt-admin-list-heading"><h3>'+number(d.rows.length)+' operações</h3><span>Valores em '+c.esc(c.state.currency)+' · ROI: lucro estimado / custo total</span></div>'+
   (d.rows.length?'<div class="mt-admin-operations">'+(overview?d.rows.slice(0,4):d.rows).map(w=>operationCard(c,w)).join('')+'</div>':'<div class="mt-admin-empty"><h3>Nenhuma operação encontrada</h3><p>As operações aparecerão aqui conforme os clientes começarem a usar o tracking. Ajuste o filtro para consultar outras contas.</p></div>')+
   (overview&&d.rows.length>4?'<div class="actions">'+c.button('Ver todas as operações','admin-campaigns','',true)+'</div>':'');
 }
 async function orders(c){
  const d=await call(c,'orders');
  return heading(c,'Pedidos de todos os clientes','Consulte os pedidos das operações, filtre por responsável e escolha a ordem de exibição.')+filters(c,'orders')+c.ordersFilters()+'<div class="mt-admin-list-heading"><h3>'+number(d.total)+' pedidos encontrados</h3><span>'+c.esc(c.state.currency)+' · '+(c.state.admin_client?'Cliente selecionado':'Todos os clientes')+'</span></div>'+
   (d.rows.length?c.table(['Cliente / operação','Pedido / checkout','Comprador','Status','Valor','Origem','Criado',''],d.rows.map(o=>'<tr><td><strong>'+c.esc(o.client_name)+'</strong><small>'+c.esc(o.operation_name)+'</small></td><td>'+c.esc(o.external_id)+'<small>'+c.esc(c.brand.name(o.provider))+'</small></td><td>'+c.esc(o.buyer_name||'Não informado')+'</td><td>'+c.pill(o.status)+'</td><td>'+money(c,o.gross_minor)+'</td><td>'+c.esc(o.channel==='unattributed'?'Não atribuído':o.channel||'—')+'</td><td>'+c.dt(o.created_at)+'</td><td>'+c.button('Detalhes','admin-order','data-id="'+c.esc(o.id)+'" data-workspace="'+c.esc(o.workspace_id)+'"')+'</td></tr>'))+c.paginate(d.total):'<div class="mt-admin-empty"><h3>Nenhum pedido neste filtro</h3><p>Altere o período, a busca ou o cliente para consultar outros pedidos.</p></div>');
 }
 async function integrations(c){
  const d=await call(c,'integrations'),rows=d.rows.filter(i=>!c.state.admin_platform||i.provider===c.state.admin_platform),active=d.rows.filter(i=>i.connected),attention=active.filter(i=>i.error_code&&i.error_code!=='sync_requested');
  const card=p=>{const v=d.platforms.find(i=>i.provider===p)||{accounts:0,clients:0,connections:0,attention:0};return '<button type="button" class="mt-admin-platform-card" data-action="admin-platform" data-provider="'+p+'"><div class="mt-integration-brand">'+c.brand.logo(p)+'<h3>'+c.esc(c.brand.name(p))+'</h3></div><strong class="mt-admin-account-count">'+number(v.accounts)+'<small>contas conectadas</small></strong><div class="mt-admin-platform-meta"><span>'+number(v.clients)+' clientes</span><span>'+number(v.connections)+' conexões</span>'+(v.attention?'<span class="negative">'+number(v.attention)+' com atenção</span>':'')+'</div><span class="mt-admin-open">Ver conexões →</span></button>';};
  return heading(c,'Integrações das operações','Acompanhe a cobertura e a situação das conexões de cada cliente.',false,true)+filters(c,'integrations')+'<div class="mt-admin-kpis">'+metric(c,'Contas conectadas',number(d.platforms.reduce((n,p)=>n+Number(p.accounts),0)))+metric(c,'Operações conectadas',number(new Set(active.map(i=>i.workspace_id)).size))+metric(c,'Conexões com atenção',number(attention.length),'',attention.length?'negative':'')+'</div><h3 class="mt-admin-section-title">Gerenciadores de anúncios</h3><div class="mt-admin-platform-grid">'+['meta','google','tiktok'].map(card).join('')+'</div><h3 class="mt-admin-section-title">Checkouts e outras fontes</h3><div class="mt-admin-platform-grid">'+['kiwify','hotmart','custom'].map(card).join('')+'</div><div class="mt-admin-list-heading"><h3>Conexões por operação</h3><span>'+number(rows.length)+' conexões</span></div>'+
   (rows.length?c.table(['Cliente / operação','Plataforma','Conta','Situação','Última atualização'],rows.map(i=>'<tr><td><strong>'+c.esc(i.client_name)+'</strong><small>'+c.esc(i.operation_name)+'</small></td><td>'+c.esc(c.brand.name(i.provider))+'</td><td>'+c.esc(i.account_id)+'</td><td>'+c.pill(!i.connected?'Desconectada':i.error_code&&i.error_code!=='sync_requested'?'Requer atenção':i.error_code==='sync_requested'?'Sincronizando':'Conectada')+'</td><td>'+c.esc(i.last_sync_at||i.last_received_at?c.dt(i.last_sync_at||i.last_received_at):'Aguardando dados')+'</td></tr>')):'<div class="mt-admin-empty"><h3>Nenhuma conexão neste filtro</h3><p>As plataformas conectadas pelos responsáveis aparecerão aqui.</p></div>');
 }
 async function render(c){
  current=c;const catalog=await call(c,'catalog');c.setCatalog(catalog.rows);
  if(c.state.tab==='ads'&&c.state.admin_workspace){const op=catalog.rows.find(w=>w.id===c.state.admin_workspace);if(!op){c.selectOperation(null);return operations(c);}return heading(c,op.client_name,op.name,true)+'<div class="mt-admin-detail-caption">Campanhas, conjuntos e anúncios desta operação</div>'+await c.ads();}
  return c.state.tab==='orders'?orders(c):c.state.tab==='integrations'?integrations(c):operations(c);
 }
 async function action(name,el){const c=current;if(!c||!window.trackingObserver?.())return;
  if(name==='admin-operation'){const op=c.catalog().find(w=>w.id===el.dataset.id);if(!op)return;if(c.state.tab!=='ads')c.goTo('campaigns');c.selectOperation(op);await c.render();document.querySelector('#app .main')?.scrollTo({top:0});}
  else if(name==='admin-back'){c.selectOperation(null);await c.render();}
  else if(name==='admin-order')await c.detail(el.dataset.id,el.dataset.workspace);
  else if(name==='admin-platform'){c.state.admin_platform=el.dataset.provider;await c.render();}
  else if(name==='admin-campaigns')c.goTo('campaigns');
 }
 document.addEventListener('change',async e=>{if(!current||!window.trackingObserver?.()||!['admin-client','admin-mode','admin-sort','admin-platform'].includes(e.target.id))return;const c=current,key=e.target.id.replace('admin-','admin_');c.state[key]=e.target.value;c.state.page=1;c.state.admin_workspace=null;c.state.workspace=null;try{await c.render();}catch(err){window.toast(err.message);}});
 window.MagemindTrackingAdmin={render,action};
})();
