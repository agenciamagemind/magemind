(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=value=>escapeHTML(value);
 let context=null,owner=null,flight=null,bucket='',panel,dialog,expanded=false,loadError=false,epoch=0;
 const today=()=>MagemindCore.civilDate();
 const matches=(d,scope)=>d.status!=='Concluído'&&Boolean(d.date)&&(scope==='late'?d.date<today():scope==='today'?d.date===today():d.date>today());
 function clear(){epoch++;context=null;owner=null;flight=null;bucket='';loadError=false;DB.demandPeople={};if(panel){panel.hidden=true;panel.replaceChildren();}dialog?.close();$('production-dialog-body')?.replaceChildren();}
 function cadence(plan){
  if(plan.delivery_cadence||plan.deliveryCadence){const s=MagemindSolutions.schedule(plan);return{recurring:['daily','weekly'].includes(s.cadence),text:MagemindSolutions.describe(plan)};}
  const text=String((plan.includes||'')+' '+plan.name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const explicit=text.match(/(\d+)\s*criativos?\s*(?:por|\/)\s*(dia|semana|mes)/);
  const period=explicit?.[2]||(plan.type==='Diario'||plan.category==='infinite_plus'?'dia':plan.type==='Semanal'?'semana':plan.type==='Mensal'?'mes':plan.category==='weekly_monthly'?'semana':'pacote');
  const quantity=explicit?Number(explicit[1]):Number(plan.qty)||0;
  return {recurring:period!=='pacote',text:quantity?`${quantity} criativo${quantity===1?'':'s'} / ${period==='mes'?'mês':period}`:'Volume a definir'};
 }
 async function load(){
  if(!DB.me)return;
  if(flight&&owner===DB.me.id)return flight;
  const uid=DB.me.id,version=epoch;owner=uid;
  flight=(async()=>{
   let response;try{response=await supa.rpc('get_demand_workspace_context');}catch(error){response={error};}
   if(DB.me?.id!==uid||version!==epoch)return;
   const {data,error}=response;loadError=Boolean(error);
   if(error){console.error('[Magemind] Contexto da produção:',error.message);render();return;}
   context=data||{people:[],clients:[]};DB.demandPeople=Object.fromEntries((context.people||[]).map(p=>[p.id,p]));
   DB.demands.forEach(d=>{const p=DB.demandPeople[d.assigneeId];if(p)Object.assign(d,{assignee:p.name,assigneePhoto:p.photo,assigneeAv:p.av||avatarInitials(p.name)});});
   render();
  })().finally(()=>{if(owner===uid&&version===epoch)flight=null;});
  return flight;
 }
 function filter(rows){return isOperationalStaff()&&bucket?rows.filter(d=>matches(d,bucket)):rows;}
 function summary(){
  const rows=getRoleDemands(),labels={late:'Atrasadas',today:'Para hoje',future:'Próximas'};
  return '<div class="production-counts">'+Object.entries(labels).map(([key,label])=>`<button type="button" data-production-scope="${key}" aria-pressed="${bucket===key}"><strong>${rows.filter(d=>matches(d,key)).length}</strong><span>${label}</span></button>`).join('')+'</div>'+(bucket?'<button type="button" class="production-reset" data-production-action="reset">Limpar filtro de prazo ×</button>':'');
 }
 function render(){
  if(!panel||!DB.me)return;
  const enabled=isOperationalStaff();panel.hidden=!enabled;
  if(!enabled){panel.replaceChildren();return;}
  const selected=$('client-filter-dd').value;
  const scopeRows=isEditor()?DB.demands.filter(d=>d.assigneeId===DB.me.id):DB.demands;
  const candidates=(context?.clients||[]).map(c=>{
   const demands=scopeRows.filter(d=>d.client===c.id),pending=demands.filter(d=>d.status!=='Concluído'),plans=(c.plans||[]).filter(p=>cadence(p).recurring);
   return {c,demands,pending,plans,late:pending.filter(d=>matches(d,'late')).length};
  }).filter(x=>x.pending.length||(x.plans.length&&x.c.status==='Ativo')).sort((a,b)=>b.late-a.late||b.pending.length-a.pending.length||a.c.name.localeCompare(b.c.name));
  const clientCard=({c,demands,pending,plans,late})=>`<article class="production-client ${selected===c.id?'is-selected':''}">
   <div class="production-client-heading"><span class="av av-xs">${clientAvatarHTML(c.id,c.name)}</span><div><h4>${esc(c.name)}</h4><small>${c.status==='Pausado'?'Conta pausada':c.status==='Inativo'?'Conta inativa':plans.length?'Plano mensal':'Produção avulsa'}</small></div>${late?`<span class="production-late">${late} em atraso</span>`:''}</div>
   ${plans.map(p=>`<div class="production-plan"><strong>${esc(p.name)}</strong><small>${esc(cadence(p).text)}</small></div>`).join('')}
   <div class="production-client-stats"><span><strong>${pending.length}</strong> pendentes</span><span><strong>${demands.filter(d=>d.status==='Concluído').length}</strong> concluídas</span></div>
   <div class="production-client-actions"><button type="button" data-production-client="${esc(c.id)}" aria-pressed="${selected===c.id}">Ver demandas <span aria-hidden="true">↗</span></button><button type="button" data-production-info="${esc(c.id)}" aria-label="Informações de ${esc(c.name)}">Informações</button></div>
  </article>`;
  const groups=[
   {key:'recurring',title:'Clientes com produção recorrente',clients:candidates.filter(x=>x.plans.length),empty:'Nenhum cliente com produção recorrente no momento.'},
   {key:'one-off',title:'Clientes com produção avulsa',clients:candidates.filter(x=>!x.plans.length),empty:'Nenhum cliente com produção avulsa pendente.'}
  ].map(({key,title,clients,empty})=>`<section class="production-client-group" data-production-group="${key}" aria-labelledby="production-${key}-title"><div class="production-list-heading"><h3 id="production-${key}-title">${title}</h3><small>${clients.length}</small></div><div class="production-group-cards">${clients.map(clientCard).join('')||`<p class="production-empty">${empty}</p>`}</div></section>`).join('');
  const details=panel.querySelector('details');if(details)expanded=details.open;
  panel.innerHTML=`<details ${expanded?'open':''}><summary><span><strong>${isEditor()?'Minha produção':isClient()?'Sua produção':'Visão da produção'}</strong><small>${isEditor()?'Demandas atribuídas a você':'Prazos e acompanhamento dos clientes'}</small></span><span aria-hidden="true">⌄</span></summary><div class="production-body">${summary()}${isEditor()?'<p class="production-caption">Contagem das demandas atribuídas a você.</p>':''}${loadError?'<p class="production-caption" role="status">Não foi possível atualizar o acompanhamento.</p><button type="button" class="production-reset" data-production-action="retry">Tentar novamente</button>':''}<div class="production-client-list">${context?groups:loadError?'':'<p class="production-empty">Carregando acompanhamento…</p>'}</div></div></details>`;
 }
 function showInfo(id){
  const c=context?.clients?.find(c=>c.id===id);if(!c)return;
  const admin=isCEO()||isManager(),canWrite=admin||isGestor()||isEditor();
  const plans=(c.plans||[]).map(p=>`<li><strong>${esc(p.name)}</strong><span>${esc(cadence(p).text)}</span></li>`).join('');
  dialog.dataset.clientId=id;$('production-dialog-title').textContent=c.name;
  $('production-dialog-body').innerHTML=`${admin?`<div class="production-contact"><div><small>E-mail</small><span>${esc(c.email||'Não informado')}</span></div><div><small>Telefone</small><span>${esc(c.phone||'Não informado')}</span></div></div>`:''}<section><h3>Planos e entregas</h3><ul class="production-dialog-plans">${plans||'<li>Sem plano vinculado</li>'}</ul></section><section><h3>Briefing de produção</h3>${canWrite?`<p class="production-caption">Compartilhado com a equipe que trabalha nas demandas. Use somente orientações de produção.</p><textarea id="production-brief" aria-label="Briefing de produção" maxlength="12000" placeholder="Público, linguagem, referências e orientações para os criativos…">${esc(c.production_brief||'')}</textarea><div class="production-save-row"><span id="production-save-status" role="status"></span><button type="button" class="btn btn-primary btn-sm" data-production-save="${esc(c.id)}">Salvar briefing</button></div>`:`<p class="production-brief-text">${esc(c.production_brief||'O briefing de produção ainda não foi informado pela gestão.')}</p>`}</section>${admin?`<section><h3>Observações administrativas</h3><p class="production-brief-text">${esc(c.notes||'Sem observações administrativas.')}</p></section>`:''}`;
  dialog.showModal();
 }
 function init(){
  const board=$('kanban-board'),list=$('demand-list-view');if(!board||!list)return;
  const layout=document.createElement('div'),area=document.createElement('div');layout.className='demand-workspace';area.className='demand-board-area';board.before(layout);area.append(board,list);layout.append(area);
  panel=document.createElement('aside');panel.id='demand-production-panel';panel.setAttribute('aria-label','Acompanhamento da produção');panel.hidden=true;layout.append(panel);
  expanded=matchMedia('(min-width:901px)').matches;
  dialog=document.createElement('dialog');dialog.id='production-client-dialog';dialog.setAttribute('aria-labelledby','production-dialog-title');dialog.innerHTML='<div class="production-dialog-head"><h2 id="production-dialog-title"></h2><button type="button" data-production-close aria-label="Fechar informações do cliente">×</button></div><div id="production-dialog-body"></div>';document.body.append(dialog);
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  document.addEventListener('click',async e=>{
   const el=e.target.closest('[data-production-scope],[data-production-action],[data-production-client],[data-production-info],[data-production-close],[data-production-save]');if(!el||!DB.me)return;
   if(el.hasAttribute('data-production-close'))return dialog.close();
   if(el.dataset.productionAction==='retry')return load();
   if(el.hasAttribute('data-production-info'))return showInfo(el.dataset.productionInfo);
   if(el.hasAttribute('data-production-save')){
    if(!(isAdmin()||isGestor()||isEditor()))return;el.disabled=true;const savingUser=DB.me.id,savingEpoch=epoch;
    try{const id=el.dataset.productionSave,text=$('production-brief').value,client=context.clients.find(c=>c.id===id);const {error}=await supa.rpc('save_production_brief',{p_client_id:id,p_brief:text,p_expected_brief:client.production_brief||''});if(error)throw error;if(DB.me?.id!==savingUser||epoch!==savingEpoch)return;client.production_brief=text;if(dialog.dataset.clientId===id)$('production-save-status').textContent='Briefing salvo.';}
    catch(error){if(DB.me?.id!==savingUser||epoch!==savingEpoch)return;const status=$('production-save-status');if(status)status.textContent=error.message?.includes('outra pessoa')?'Este briefing mudou. Feche e reabra para revisar antes de salvar.':'Não foi possível salvar. Tente novamente.';if(error.message?.includes('outra pessoa'))await load();console.error(error);}finally{el.disabled=false;}return;
   }
   if(el.hasAttribute('data-production-client')){bucket='';$('mine-filter-chk').checked=false;const select=$('client-filter-dd');select.value=el.dataset.productionClient;select.dispatchEvent(new Event('change',{bubbles:true}));window.MagemindDemandFilters?.sync();}
   else if(el.hasAttribute('data-production-scope'))bucket=bucket===el.dataset.productionScope?'':el.dataset.productionScope;
   else bucket='';
   renderKanban();
  });
 }
 window.MagemindDemandWorkspace={load,render,filter,clear,cadence};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
