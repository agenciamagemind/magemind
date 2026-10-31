/* Referral membership, rules and attribution share the server's current policy. */
(() => {
 'use strict';
 const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const date=value=>value?new Date(value).toLocaleDateString('pt-BR'):'—';
 const percent=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
 const roles={client:'Cliente',gestor:'Gestor',editor:'Editor',affiliate:'Afiliado'};
 const paths={gift:'M20 12v8H4v-8M2 7h20v5H2zM12 7v13M12 7H7.5A2.5 2.5 0 1 1 10 4.5L12 7Zm0 0h4.5A2.5 2.5 0 1 0 14 4.5L12 7Z',link:'m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',copy:'M9 9h11v11H9zM5 15H3V3h12v2',arrow:'M5 12h14m-5-5 5 5-5 5',check:'m5 12 4 4L19 6',search:'m20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z',refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1'};
 const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.gift}"/></svg>`;
 let data=null,owner=null,epoch=0,inflight=null,error='',busy=false,search='',filter='all';
 const page=()=>document.getElementById('pg-affiliates');
 const visible=()=>page()?.classList.contains('active');
 const host=()=>document.getElementById(data?.state==='admin'?'referral-admin-view':'referral-member-view');
 function cache(value,uid){
  if(DB.me?.id!==uid)return;
  if(value.state==='suspended'){
   value={...value,rate:null,code:null,finance_access:false,wallet:null,clients:[],sales:[],withdrawals:[]};
   if(document.getElementById('modal-withdrawal-request')?.classList.contains('open'))closeModal('modal-withdrawal-request');
   for(const id of ['wd-amount','wd-pix-key']){const field=document.getElementById(id);if(field)field.value='';}
   DB.withdrawals=[];
  }
  DB.me.referralSuspended=value.state==='suspended';
  owner=uid;data=value;error='';
  if(value.state==='admin'){
   for(const p of value.participants||[]){const u=DB.users.find(u=>u.id===p.id);if(u){u.affiliateStatus=p.state==='suspended'?'locked':'approved';u.commissionRate=Number(p.rate);}}
   const selected=document.getElementById('c-affiliate')?.value;
   populateClientAffiliateSelect(selected);
  }else if(value.state!=='unavailable'){
   DB.me.affiliateStatus=value.affiliate_status;DB.me.commissionRate=Number(value.rate);DB.me.referralFinanceAccess=Boolean(value.finance_access);
   DB.referralWallet=value.wallet;DB.wallet=value.wallet;
   DB.referralClients=(value.clients||[]).map(c=>({id:c.client_id,name:c.client_name,status:c.client_status,createdAt:c.registered_at,demandCount:Number(c.demand_count),commissionTotal:Number(c.commission_total)}));
   DB.referralSales=(value.sales||[]).map(s=>({id:s.sale_id,client:s.client_id,clientName:s.client_name,value:Number(s.commission_value),status:s.sale_status,date:s.sale_date}));
   DB.referralWithdrawals=value.withdrawals||[];
   if(isAffiliate()){DB.clients=DB.referralClients.map(c=>({...c,affiliateId:uid,email:'',phone:'',notes:'',plan:'',planIds:[]}));DB.sales=DB.referralSales.map(s=>({...s,isCommissionValue:true,service:'',desc:'',assignee:''}));DB.withdrawals=DB.referralWithdrawals;}
   if(value.state==='suspended'){buildNav();if(isAffiliate()&&['pg-dashboard','pg-sales','pg-clients'].includes(document.querySelector('.page.active')?.id))goTo('affiliates');}
  }
 }
 async function load({render:shouldRender=true}={}){
  const uid=DB.me?.id;if(!uid)return null;
  if(owner&&owner!==uid)clear();
  if(!inflight){
   const token=epoch;
   const request=(async()=>{const result=await supa.rpc('get_referral_portal');if(result.error)throw result.error;
    if(!result.data?.state)throw new Error('Não foi possível carregar o programa.');
    if(epoch===token&&DB.me?.id===uid)cache(result.data,uid);return result.data;
   })();inflight=request;
   request.finally(()=>{if(inflight===request)inflight=null;}).catch(()=>{});
  }
  try{const result=await inflight;if(shouldRender)render();return result;}
  catch(cause){if(DB.me?.id===uid){error=cause.message||'Não foi possível carregar o programa.';if(shouldRender)render();}throw cause;}
 }
 function clear(){epoch++;inflight=null;data=null;owner=null;error='';busy=false;search='';filter='all';closeRules();document.getElementById('referral-rules-content')?.replaceChildren();syncHelp();for(const id of ['referral-admin-view','referral-member-view'])document.getElementById(id)?.replaceChildren();}
 const stat=(label,value,sub='',accent='')=>`<div class="rf-stat ${accent}"><span>${e(label)}</span><strong>${e(value)}</strong>${sub?`<small>${e(sub)}</small>`:''}</div>`;
 const empty=text=>`<div class="rf-empty">${e(text)}</div>`;
 function rules(){
  const article=data.rules?.article,prices=article?.examples||{},rate=Number(data.rate??data.rules?.default_rate??10);
  const gain=price=>Math.round(Math.round(Number(price||0)*100)*Math.round(rate*100)/10000)/100;
  const monthly=gain(prices.monthly),pack=gain(prices.package);
  const values={default_rate:percent(data.rules?.default_rate??10),rate:percent(rate),monthly_price:money(prices.monthly),monthly_gain:money(monthly),five_monthly_gain:money(monthly*5),ten_monthly_gain:money(monthly*10),package_price:money(prices.package),package_gain:money(pack),service_price:money(prices.service),service_gain:money(gain(prices.service)),combined_gain:money(monthly+pack)};
  const text=p=>e(String(p??'').replace(/\bCEO\s*(?:ou|e)\s*gerentes?\b/gi,'equipe interna').replace(/\{\{([a-z_]+)\}\}/g,(_,key)=>values[key]??''));
  const paragraphs=items=>(items||[]).map(p=>`<p>${text(p)}</p>`).join('');
  const list=items=>items?.length?`<ul>${items.map(p=>`<li>${text(p)}</li>`).join('')}</ul>`:'';
  const body=s=>`${paragraphs(s.paragraphs)}${list(s.items)}${s.after?`<p>${text(s.after)}</p>`:''}${s.note?`<aside class="rf-doc-note">${text(s.note)}</aside>`:''}`;
  const doc=article?.document;
  if(doc)return `<article class="rf-rules rf-rules-article rf-document"><header class="rf-doc-intro"><h1>${text(doc.title)}</h1><p>${text(doc.intro)}</p></header>${doc.sections.map((s,i)=>`<section class="rf-doc-section"><h2>${text(s.title)}</h2>${body(s)}${(s.subsections||[]).map(sub=>`<div class="rf-doc-subsection"><h3>${text(sub.title)}</h3>${body(sub)}</div>`).join('')}</section>`).join('')}</article>`;
  return `<article class="rf-rules rf-rules-article">${paragraphs(article?.paragraphs||(data.rules?.sections||[]).flatMap(s=>s.paragraphs||[]))}</article>`;
 }
 function welcome(){return `<div class="rf-terms rf-welcome-article">${rules()}
  <form id="rf-accept-form" class="rf-consent"><label><input id="rf-ack" type="checkbox" required><span class="rf-check" aria-hidden="true">${icon('check')}</span><span>${e(data.rules?.acknowledgement)}</span></label><button class="btn btn-primary" id="rf-join" type="submit" disabled>Concordar e participar ${icon('arrow')}</button><small>Seu aceite fica registrado com a versão destas regras.</small></form></div>${data.finance_access?finance():''}`;}
 function finance(){const w=data.wallet||{},clients=data.clients||[];
  if(data.state==='suspended')return '';
  return `<div class="rf-stats">${stat('Disponível para saque',money(w.available),'Comissões aprovadas','rf-highlight')}${stat('Em análise',money(w.under_review),'Saques em processamento')}${stat('Recebido',money(w.withdrawn),'Pagamentos registrados')}${stat('Comissão pendente',money(w.pending_commission),'Ainda não disponível')}</div>
  <div class="rf-finance-action"><p>Os valores já registrados permanecem disponíveis para consulta e saque.</p><button type="button" class="btn btn-primary btn-sm" data-rf-action="withdraw" ${Number(w.available)<1?'disabled':''}>Solicitar saque</button></div>
  <div class="rf-lower"><section class="rf-card"><div class="rf-section-heading"><div><h3>Clientes indicados <span class="rf-count">${clients.length}</span></h3><p>Cadastros vinculados à sua indicação</p></div></div>${clients.length?`<div class="rf-table-scroll"><table><thead><tr><th>Cliente</th><th>Demandas</th><th>Comissão</th><th>Status</th></tr></thead><tbody>${clients.map(c=>`<tr><td><strong>${e(c.client_name)}</strong><small>Desde ${date(c.registered_at)}</small></td><td>${Number(c.demand_count||0)}</td><td class="financial-value">${money(c.commission_total)}</td><td><span class="rf-badge ${c.client_status==='Ativo'?'active':''}">${e(c.client_status)}</span></td></tr>`).join('')}</tbody></table></div>`:empty('Quando um novo cliente se cadastrar pelo seu link, ele aparecerá aqui.')}</section>
  <section class="rf-card"><div class="rf-section-heading"><div><h3>Histórico de saques</h3><p>Acompanhe cada etapa do pagamento</p></div></div>${data.withdrawals?.length?`<div class="rf-table-scroll"><table><thead><tr><th>Solicitação</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>${data.withdrawals.map(w=>`<tr><td>${date(w.requested_at)}</td><td class="financial-value">${money(w.amount)}</td><td><span class="rf-badge ${w.status==='paid'?'active':w.status==='rejected'?'suspended':''}">${e({pending:'Em análise',approved:'Aprovado',paid:'Pago',rejected:'Recusado',cancelled:'Cancelado',reversed:'Estornado'}[w.status]||w.status)}</span>${w.rejection_reason?`<small>${e(w.rejection_reason)}</small>`:''}</td><td>${w.status==='pending'?`<button type="button" class="btn btn-ghost btn-xs" data-rf-cancel="${e(w.id)}">Cancelar</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('Seus pedidos de saque aparecerão aqui.')}</section></div>`;}
 function member(){
  if(data.state==='needs_acceptance')return welcome();
  if(data.state==='unavailable')return empty('Este perfil utiliza uma carteira própria. Acesse Saques para acompanhar seus valores.');
  if(data.state==='suspended')return `<div class="rf-locked"><div class="rf-lock-message" role="status"><div class="rf-lock-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg></div><h2>Participação suspensa</h2><p>O acesso aos dados do Indique &amp; Ganhe e à solicitação de saques está bloqueado.</p><small>Seu histórico e saldo estão preservados. Somente a equipe interna pode reativar sua participação.</small></div></div>`;
  const active=data.state==='active',link=active?`https://app.magemind.com.br/?ref=${data.code}`:'';
  return `${active?`<section class="rf-link-card"><div><span class="rf-link-icon">${icon('link')}</span><h3>Seu link de indicação</h3><p>O cadastro pelo link identifica você automaticamente como responsável pela indicação.</p></div><div class="rf-link-field"><input id="rf-personal-link" aria-label="Seu link de indicação" readonly value="${e(link)}"><button type="button" class="btn btn-primary btn-sm" data-rf-action="copy">${icon('copy')}<span>Copiar link</span></button></div><div class="rf-link-foot"><span><b>${percent(data.rate)}</b> nas vendas elegíveis da Magemind</span><span>${data.clients?.length||0} clientes indicados</span></div></section>`:`<div class="rf-suspended">${icon('shield')}<div><strong>Participação suspensa</strong><p>Seu link está desativado e novas comissões estão suspensas. A reativação depende da equipe interna. O histórico, os saldos e os clientes já vinculados foram preservados.</p></div></div>`}
  ${finance()}`;
 }
 function admin(){const people=data.participants||[],active=people.filter(p=>p.state!=='suspended').length;
  return `<div class="rf-admin-actions"><button type="button" class="btn btn-ghost btn-sm" data-rf-action="payments">Gerenciar saques ${icon('arrow')}</button></div>
  <div class="rf-stats">${stat('Participantes',people.length,'Com histórico no programa')}${stat('Participações ativas',active,'Inclui aceites a confirmar')}${stat('Participações suspensas',people.length-active,'Link e novas comissões pausados')}${stat('Comissões geradas',money(people.reduce((n,p)=>n+Number(p.earned||0),0)),'Histórico dos participantes','rf-highlight')}</div>
  <section class="rf-card"><div class="rf-section-heading rf-admin-controls"><div><h3>Participantes</h3><p>Alterar a taxa afeta apenas novas comissões.</p></div><div class="rf-filters"><label class="rf-search">${icon('search')}<input id="rf-search" placeholder="Buscar nome ou e-mail" aria-label="Buscar participante por nome ou e-mail" value="${e(search)}"></label><select id="rf-state" aria-label="Status dos participantes"><option value="all">Todos os status</option><option value="active" ${filter==='active'?'selected':''}>Ativos</option><option value="needs_acceptance" ${filter==='needs_acceptance'?'selected':''}>Aceite a confirmar</option><option value="suspended" ${filter==='suspended'?'selected':''}>Suspensos</option></select></div></div><div id="rf-participants">${participantRows()}</div></section>
  `;
 }
 function participantRows(){const query=search.trim().toLocaleLowerCase('pt-BR'),people=(data.participants||[]).filter(p=>(filter==='all'||p.state===filter)&&(!query||`${p.name} ${p.email}`.toLocaleLowerCase('pt-BR').includes(query)));
  if(!people.length)return empty(search||filter!=='all'?'Nenhum participante encontrado com esses filtros.':'Os participantes aparecerão aqui quando confirmarem as regras.');
  return `<div class="rf-table-scroll"><table class="rf-participant-table"><thead><tr><th>Participante</th><th>Comissão</th><th>Indicados</th><th>Disponível</th><th>Participação</th><th>Ações</th></tr></thead><tbody>${people.map(p=>`<tr><td><div class="rf-person"><span class="rf-initials">${e(p.name.split(/\s+/).filter(Boolean).map(n=>n[0]).slice(0,2).join('').toUpperCase())}</span><div><strong>${e(p.name)}</strong><small>${e(p.email)} · ${e(roles[p.role]||p.role)}</small></div></div></td><td><form data-rf-rate-form="${e(p.id)}" class="rf-rate-form"><label><input type="number" aria-label="Comissão de ${e(p.name)}" min="0" max="100" step="0.01" required value="${Number(p.rate)}" ${p.account_active?'':'disabled'}><span>%</span></label><button type="submit" class="btn btn-ghost btn-xs" ${p.account_active?'':'disabled'}>Salvar</button></form></td><td>${Number(p.clients)}</td><td class="financial-value">${money(p.available)}</td><td><span class="rf-badge ${p.state}">${{active:'Ativo',needs_acceptance:'Aceite a confirmar',suspended:'Suspenso'}[p.state]}</span><small>${!p.account_active?'Conta inativa':p.accepted_at?'Aceite em '+date(p.accepted_at):'O participante confirma no próprio painel'}</small></td><td><button type="button" class="btn ${p.state==='suspended'?'btn-ghost':'btn-danger'} btn-xs" data-rf-${p.state==='suspended'?'restore':'suspend'}="${e(p.id)}" ${p.state==='suspended'&&!p.account_active?'disabled':''}>${p.state==='suspended'?'Reativar':'Suspender'}</button></td></tr>`).join('')}</tbody></table></div>`;
 }
 function render(){
  syncHelp();
  if(!visible())return;
  const adminView=isAdmin();document.getElementById('referral-admin-view').classList.toggle('active',adminView);document.getElementById('referral-member-view').classList.toggle('active',!adminView);
  const target=document.getElementById(adminView?'referral-admin-view':'referral-member-view');
  if(!data||owner!==DB.me?.id){target.innerHTML=`<div class="rf-root">${error?`<div class="rf-load-error" role="alert"><h3>Não foi possível carregar o programa</h3><p>Seus dados continuam preservados. Tente novamente.</p><button type="button" class="btn btn-primary btn-sm" data-rf-action="retry">Tentar novamente</button></div>`:`<div class="rf-empty" role="status"><span class="rf-spinner"></span> Carregando programa…</div>`}</div>`;return;}
  target.innerHTML=`<div class="rf-root">${error?'<div class="rf-suspended" role="alert">Não foi possível atualizar. Os dados abaixo são da última consulta. <button type="button" class="btn btn-ghost btn-xs" data-rf-action="retry">Tentar novamente</button></div>':''}${data.state==='admin'?admin():member()}</div>`;
  if(document.getElementById('referral-rules-dialog')?.open)renderRules();
 }
 function syncHelp(){
  const button=document.getElementById('referral-rules-help');if(!button)return;
  button.hidden=!visible()||!DB.me;button.disabled=!data?.rules||owner!==DB.me?.id;
  if(button.hidden||button.disabled)closeRules();
 }
 function renderRules(){document.getElementById('referral-rules-content').innerHTML=`<div class="rf-root">${rules()}</div>`;}
 function closeRules(){const dialog=document.getElementById('referral-rules-dialog');if(dialog?.open)dialog.close();}
 function initHelp(){
  const wrapper=document.getElementById('notif-wrapper');if(!wrapper||document.getElementById('referral-rules-help'))return;
  const button=document.createElement('button');button.id='referral-rules-help';button.type='button';button.className='btn btn-ghost btn-icon';button.hidden=true;button.disabled=true;button.title='Regras do programa';button.setAttribute('aria-label','Regras do programa');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','referral-rules-dialog');
  button.innerHTML='<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.6-2.5 1.8-2.5 3.5M12 16.5h.01"/></svg>';
  wrapper.prepend(button);
  const slot=document.createElement('div');slot.id='referral-mobile-help-slot';page().querySelector('.ph').append(slot);
  const mobile=matchMedia('(max-width:900px)');
  const place=()=>{const target=mobile.matches?slot:wrapper;if(button.parentElement!==target)target.prepend(button);};
  mobile.addEventListener('change',place);place();
  const dialog=document.createElement('dialog');dialog.id='referral-rules-dialog';dialog.setAttribute('aria-labelledby','referral-rules-title');dialog.innerHTML='<div class="rf-dialog-head"><div><h2 id="referral-rules-title">Regras do programa</h2><p>Indique &amp; Ganhe Magemind</p></div><button type="button" class="btn btn-ghost btn-icon" aria-label="Fechar regras">×</button></div><div id="referral-rules-content" class="rf-dialog-body"></div>';
  document.body.append(dialog);
  button.addEventListener('click',()=>{if(!visible()||!data?.rules||owner!==DB.me?.id)return;closeNotifPanel();renderRules();window.openAccessibleDialog(dialog);});
  dialog.querySelector('button').addEventListener('click',closeRules);
  let backdropDown=false;
  const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;};
  dialog.addEventListener('pointerdown',event=>{backdropDown=event.target===dialog&&outside(event);});
  dialog.addEventListener('click',event=>{if(backdropDown&&event.target===dialog&&outside(event))closeRules();backdropDown=false;});
  new MutationObserver(syncHelp).observe(page(),{attributes:true,attributeFilter:['class']});syncHelp();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initHelp,{once:true});else initHelp();
 async function mutate(fn,args,message){if(busy)return;busy=true;const uid=DB.me?.id;try{
  const {data:result,error:cause}=await supa.rpc(fn,args);if(cause)throw cause;if(DB.me?.id!==uid)return;
  if(result?.state)cache(result,uid);else await load({render:false});if(fn==='accept_referral_terms'&&typeof setupRealtime==='function')setupRealtime();render();toast(message,'ok');
 }catch(cause){if(DB.me?.id===uid){toast(cause.message||'Não foi possível salvar. Tente novamente.','err');await load().catch(()=>{});}}
 finally{busy=false;}
 }
 async function suspend(id){if(!isAdmin())return;const p=data?.participants?.find(p=>p.id===id);if(!p)return;
  if(!confirm(`Suspender a participação de ${p.name} no Indique & Ganhe?\n\nO link será desativado e novas comissões ficarão suspensas. Os clientes vinculados, o saldo e o histórico serão preservados. A reativação depende da equipe interna.`))return;
  await mutate('admin_remove_referral_participant',{p_profile_id:id},'Participação suspensa. Histórico preservado.');}
 async function updateRate(id,value){if(!isAdmin())return;const rate=Number(value);if(!Number.isFinite(rate)||rate<0||rate>100){toast('Informe um percentual entre 0 e 100.','err');return;}
  await mutate('admin_update_affiliate_commission',{p_affiliate_id:id,p_rate:rate},'Taxa atualizada para novas comissões.');}
 document.addEventListener('submit',event=>{
  if(event.target.id==='rf-accept-form'){event.preventDefault();if(!event.target.querySelector('#rf-ack')?.checked||busy)return;
   event.target.querySelector('button').disabled=true;event.target.querySelector('button').textContent='Confirmando…';mutate('accept_referral_terms',{p_version:data.version,p_accepted:true},'Você já participa. Seu link está pronto para divulgar.');
  }else if(event.target.matches('[data-rf-rate-form]')){event.preventDefault();updateRate(event.target.dataset.rfRateForm,event.target.querySelector('input').value);}
 });
 document.addEventListener('input',event=>{
  if(event.target.id==='rf-ack')document.getElementById('rf-join').disabled=!event.target.checked||busy;
  if(event.target.id==='rf-search'){search=event.target.value;document.getElementById('rf-participants').innerHTML=participantRows();}
 });
 document.addEventListener('change',event=>{if(event.target.id==='rf-state'){filter=event.target.value;document.getElementById('rf-participants').innerHTML=participantRows();}});
 document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-rf-action],[data-rf-suspend],[data-rf-restore],[data-rf-cancel]');if(!button||button.disabled||!page()?.contains(button))return;
  const action=button.dataset.rfAction;
  if(action==='retry'){load().catch(()=>{});return;}
  if(action==='payments'){goTo('withdrawals');return;}
  if(action==='withdraw'){openWithdrawalRequest();return;}
  if(action==='copy'){try{await navigator.clipboard.writeText(document.getElementById('rf-personal-link').value);toast('Link copiado. Pronto para compartilhar!','ok');}catch{const input=document.getElementById('rf-personal-link');input.focus();input.select();toast('Selecione e copie o link exibido.','ok');}return;}
  if(button.dataset.rfCancel){cancelWithdrawal(button.dataset.rfCancel).catch(cause=>toast(cause.message,'err'));return;}
  if(button.dataset.rfSuspend){suspend(button.dataset.rfSuspend);return;}
  if(button.dataset.rfRestore&&isAdmin()){const id=button.dataset.rfRestore,p=data?.participants.find(p=>p.id===id);if(p&&confirm(`Reativar a participação de ${p.name}?\n\nO link e as novas comissões serão liberados após o aceite das regras pelo participante. Vendas do período de suspensão não serão recalculadas.`))mutate('admin_restore_referral_participant',{p_profile_id:id},'Participação reativada.');}
 });
 window.MagemindReferrals={load,render,clear,suspend,updateRate};
})();
