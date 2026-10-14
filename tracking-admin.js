(() => {
 'use strict';
 let current=null,connectionRows=[];
 const number=n=>Number(n||0).toLocaleString('pt-BR');
 const eye='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
 const readOnly=()=>'<span class="mt-admin-readonly">'+eye+'Somente leitura</span>';
 function query(c){const s=c.state;return {admin_client:s.admin_client||'',admin_sort:s.admin_sort||'newest',search:s.search||'',status:s.status||'',provider:s.provider||'',channel:s.channel||'',payment:s.payment||''};}
 const call=(c,route,extra={})=>c.api('/admin/'+route,null,{...query(c),...extra});
 const money=(c,n)=>n==null?'—':c.money(n);
 function metric(c,label,value,hint='',tone=''){return '<div class="mt-admin-metric '+tone+'"><span>'+c.esc(label)+'</span><strong>'+c.esc(value)+'</strong>'+(hint?'<small>'+c.esc(hint)+'</small>':'')+'</div>';}
 function heading(c,title,subtitle,back=false,refresh=false){return '<div class="mt-admin-heading"><div>'+(back?c.button('← Todas as operações','admin-back'):'<span class="eyebrow">ACOMPANHAMENTO</span>')+'<h2>'+c.esc(title)+'</h2><p>'+c.esc(subtitle)+'</p></div><div class="mt-admin-heading-actions">'+readOnly()+(refresh?c.button('Atualizar indicadores','refresh'):'')+'</div></div>';}
 function filters(c,kind){
  const s=c.state,owners=new Map();for(const w of c.catalog())owners.set(w.owner_id,w.client_name);
  const clients=[['','Todos os clientes'],...[...owners].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR'))];
  return '<div class="mt-admin-filters">'+c.select('admin-client','Cliente',clients,s.admin_client||'')+
   (kind==='orders'?c.select('admin-sort','Ordem',[['newest','Mais recentes'],['oldest','Mais antigos'],['amount_desc','Maior valor'],['amount_asc','Menor valor'],['client','Nome do cliente']],['newest','oldest','amount_desc','amount_asc','client'].includes(s.admin_sort)?s.admin_sort:'newest'):
   kind==='operations'?c.select('admin-sort','Ordem',[['spend','Maior investimento'],['revenue','Maior faturamento']],s.admin_sort==='revenue'?'revenue':'spend'):
   c.select('admin-platform','Plataforma',[['','Todas as plataformas'],...['meta','google','tiktok','kiwify','hotmart','custom'].map(p=>[p,c.brand.name(p)])],s.admin_platform||''))+'</div>';
 }
 function operationCard(c,w){
  const s=w.s,profit=s.estimated_minor;
  return '<button type="button" class="mt-admin-operation" data-action="admin-operation" data-id="'+c.esc(w.id)+'"><div class="mt-admin-operation-head"><span class="mt-admin-avatar">'+c.esc(w.client_name.split(' ').map(x=>x[0]).slice(0,2).join(''))+'</span><div><h3>'+c.esc(w.client_name)+'</h3><p>'+c.esc(w.name===w.client_name?'Visão dos resultados':w.name)+'</p></div><span class="mt-admin-roas" title="Receita atribuída dividida pelo investimento em anúncios">'+(w.roas==null?'ROAS —':'ROAS '+Number(w.roas).toFixed(2)+'×')+'</span></div><div class="mt-admin-operation-metrics">'+
   metric(c,'Faturamento',money(c,s.gross_minor))+metric(c,'Investimento',money(c,s.spend_minor))+metric(c,'Lucro estimado',money(c,profit),'',profit==null?'':profit<0?'negative':'positive')+metric(c,'ROI',w.roi==null?'—':number(w.roi)+'%','',w.roi==null?'':w.roi<0?'negative':'positive')+'</div><div class="mt-admin-operation-footer"><span class="mt-admin-platforms">'+w.platforms.map(p=>c.brand.logo(p)).join('')+'<small>'+number(w.approved_orders)+' vendas aprovadas</small></span><span class="mt-admin-open">Ver campanhas →</span></div></button>';
 }
 async function operations(c){
  const d=await call(c,'operations'),s=d.summary,measured=d.rows.filter(w=>w.s.spend_minor!=null),measuredRevenue=measured.reduce((n,w)=>n+Number(w.s.attributed_minor||0),0),roas=s.spend_minor>0?Number(measuredRevenue/s.spend_minor).toFixed(2)+'×':'—';
  return heading(c,'Campanhas por cliente','Compare os resultados dos clientes e abra uma operação para acompanhar suas campanhas.')+filters(c,'operations')+
   '<div class="mt-admin-kpis">'+metric(c,'Operações',number(s.operations),number(s.clients)+' clientes')+metric(c,'Faturamento',money(c,s.gross_minor),number(s.approved_orders)+' vendas aprovadas')+metric(c,'Investimento em anúncios',money(c,s.spend_minor),number(s.spend_known)+' operações com dados no período')+metric(c,'ROAS',roas,number(s.spend_known)+' de '+number(s.operations)+' operações com mídia disponível')+'</div>'+
   '<div class="mt-admin-list-heading"><h3>'+number(d.rows.length)+' operações</h3><span>Valores em '+c.esc(c.state.currency)+' · ROI: lucro estimado / custo total</span></div>'+
   (d.rows.length?'<div class="mt-admin-operations">'+d.rows.map(w=>operationCard(c,w)).join('')+'</div>':'<div class="mt-admin-empty"><h3>Nenhuma operação encontrada</h3><p>As operações aparecerão aqui conforme os clientes começarem a usar o tracking. Ajuste o filtro para consultar outras contas.</p></div>');
 }
 async function orders(c){
  const d=await call(c,'orders');
  return heading(c,'Pedidos de todos os clientes','Consulte os pedidos das operações, filtre por cliente e escolha a ordem de exibição.')+filters(c,'orders')+c.ordersFilters()+'<div class="mt-admin-list-heading"><h3>'+number(d.total)+' pedidos encontrados</h3><span>'+c.esc(c.state.currency)+' · '+(c.state.admin_client?'Cliente selecionado':'Todos os clientes')+'</span></div>'+
   (d.rows.length?c.table(['Cliente','Pedido / checkout','Comprador','Status','Valor','Origem','Criado',''],d.rows.map(o=>'<tr><td><strong>'+c.esc(o.client_name)+'</strong><small>'+c.esc(o.operation_name)+'</small></td><td>'+c.esc(o.external_id)+'<small>'+c.esc(c.brand.name(o.provider))+'</small></td><td>'+c.esc(o.buyer_name||'Não informado')+'</td><td>'+c.pill(o.status)+'</td><td>'+money(c,o.gross_minor)+'</td><td>'+c.esc(o.channel==='unattributed'?'Não atribuído':o.channel||'—')+'</td><td>'+c.dt(o.created_at)+'</td><td>'+c.button('Detalhes','admin-order','data-id="'+c.esc(o.id)+'" data-workspace="'+c.esc(o.workspace_id)+'"')+'</td></tr>'))+c.paginate(d.total):'<div class="mt-admin-empty"><h3>Nenhum pedido neste filtro</h3><p>Altere o período, a busca ou o cliente para consultar outros pedidos.</p></div>');
 }
 async function integrations(c){
  const d=await call(c,'integrations',{admin_client:''});
  const card=p=>{const v=d.platforms.find(i=>i.provider===p)||{accounts:0,clients:0,connections:0,attention:0};
   return '<article class="integration-card mt-integration-'+p+'"><div class="mt-integration-brand">'+c.brand.logo(p)+'<h3>'+c.esc(c.brand.name(p))+'</h3></div><p>'+(['meta','google','tiktok'].includes(p)?'Contas, campanhas e desempenho dos anúncios.':'Pedidos, pagamentos e informações dos compradores.')+'</p><div class="list-row"><span class="small">Contas integradas</span><strong class="mt-admin-account-count">'+number(v.accounts)+'</strong></div><div class="mt-admin-platform-meta"><span>'+number(v.clients)+' clientes</span>'+(v.attention?'<span class="negative">'+number(v.attention)+' com atenção</span>':'')+'</div><div class="actions">'+c.button('Ver conexões','admin-connections','data-provider="'+p+'"')+'</div></article>';
  };
  return c.brand.integrationSections(card);
 }
 function connectionList(c,q=''){
  const term=q.trim().toLocaleLowerCase('pt-BR'),rows=connectionRows.filter(i=>[i.client_name,i.name,i.account_id].join(' ').toLocaleLowerCase('pt-BR').includes(term));
  return rows.length?c.table(['Cliente','Conta','Situação','Última atualização'],rows.map(i=>'<tr><td><strong>'+c.esc(i.client_name)+'</strong></td><td>'+c.esc(i.name||i.account_id)+'<small>'+c.esc(i.account_id)+'</small></td><td>'+c.pill(i.error_code&&i.error_code!=='sync_requested'?'Requer atenção':i.error_code==='sync_requested'?'Sincronizando':'Conectada')+'</td><td>'+c.esc(i.last_sync_at||i.last_received_at?c.dt(i.last_sync_at||i.last_received_at):'Aguardando dados')+'</td></tr>')):'<div class="mt-admin-empty"><h3>Nenhuma conexão encontrada</h3><p>As contas conectadas pelos clientes aparecerão aqui.</p></div>';
 }
 async function connections(c,provider){
  const d=await call(c,'integrations',{admin_client:''});connectionRows=d.rows.filter(i=>i.connected&&i.provider===provider);
  c.modal('Conexões · '+c.brand.name(provider),'<div class="mt-admin-connections-head">'+c.brand.logo(provider)+'<p>'+number(connectionRows.length)+' conexões ativas</p></div><label>Buscar cliente ou conta<input id="admin-connection-search" type="search" placeholder="Nome do cliente ou da conta" autocomplete="off"></label><div id="admin-connection-results">'+connectionList(c)+'</div>');
 }
 async function render(c){
  current=c;const catalog=await call(c,'catalog');c.setCatalog(catalog.rows);
  if(c.state.tab==='ads'&&c.state.admin_workspace){const op=catalog.rows.find(w=>w.id===c.state.admin_workspace);if(!op){c.selectOperation(null);return operations(c);}return heading(c,op.client_name,'Campanhas, conjuntos e anúncios deste cliente.',true)+await c.ads();}
  return c.state.tab==='orders'?orders(c):c.state.tab==='integrations'?integrations(c):operations(c);
 }
 async function action(name,el){const c=current;if(!c||!window.trackingObserver?.())return;
  if(name==='admin-operation'){const op=c.catalog().find(w=>w.id===el.dataset.id);if(!op)return;if(c.state.tab!=='ads')c.goTo('campaigns');c.selectOperation(op);await c.render();document.querySelector('#app .main')?.scrollTo({top:0});}
  else if(name==='admin-back'){c.selectOperation(null);await c.render();}
  else if(name==='admin-order')await c.detail(el.dataset.id,el.dataset.workspace);
  else if(name==='admin-connections')await connections(c,el.dataset.provider);
  else if(name==='admin-campaigns')c.goTo('campaigns');
 }
 document.addEventListener('change',async e=>{if(!current||!window.trackingObserver?.()||!['admin-client','admin-sort'].includes(e.target.id))return;const c=current,key=e.target.id.replace('admin-','admin_');c.state[key]=e.target.value;c.state.page=1;c.state.admin_workspace=null;c.state.workspace=null;try{await c.render();}catch(err){window.toast(err.message);}});
 document.addEventListener('input',e=>{if(e.target.id==='admin-connection-search'&&current&&window.trackingObserver?.())document.getElementById('admin-connection-results').innerHTML=connectionList(current,e.target.value);});
 window.MagemindTrackingAdmin={render,action};
})();
