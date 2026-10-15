(() => {
 'use strict';
 const catalog={
  net:['Faturamento líquido','Financeiro','metric','Receita líquida informada pelo checkout, após devoluções. As taxas já descontadas pelo checkout não são cobradas novamente.'],
  spend:['Gasto com anúncios','Financeiro','metric','Investimento das contas de anúncios selecionadas no período.'],
  roas:['ROAS','Financeiro','metric','Faturamento líquido dividido pelo gasto com anúncios. Sem investimento no período, a razão não se aplica.'],
  profit:['Lucro estimado','Financeiro','metric','Receita líquida menos anúncios, custos de produto, impostos, taxas adicionais e despesas. Taxas incluídas no líquido não são descontadas outra vez.'],
  gross:['Faturamento bruto','Financeiro','metric','Valor bruto das aprovações registradas no período.'],
  approved:['Vendas aprovadas','Vendas','metric','Quantidade de pedidos aprovados no período, incluindo os que receberam uma devolução posteriormente.'],
  pending:['Vendas pendentes','Vendas','metric','Valor e quantidade dos pedidos criados no período que ainda aguardam aprovação.'],
  product_cost:['Custo de produto','Financeiro','metric','Custos de produto das aprovações do período. Valores registrados são preservados.'],
  refunds:['Vendas reembolsadas','Vendas','metric','Valores devolvidos no período, separados de chargebacks.'],
  tax:['Imposto total','Financeiro','metric','Impostos configurados sobre as aprovações do período.'],
  chargebacks:['Chargeback','Vendas','metric','Valores de chargeback registrados no período.'],
  margin:['Margem','Financeiro','metric','Lucro dividido pelo faturamento líquido, em porcentagem.'],
  roi:['ROI','Financeiro','metric','Lucro dividido pelo investimento total da operação: anúncios, custos, impostos e despesas adicionais.'],
  fees:['Taxas','Financeiro','metric','Taxas informadas pelo checkout, mais taxas adicionais aplicáveis. Taxas cadastradas são usadas quando o checkout não informa a taxa real. As taxas incluídas na receita líquida são exibidas para consulta e não são descontadas novamente do lucro.'],
  expenses:['Despesas adicionais','Financeiro','metric','Custos adicionais por venda e despesas do período.'],
  refund_rate:['Taxa de reembolso','Vendas','metric','Pedidos reembolsados no período divididos pelas aprovações do período.'],
  chargeback_rate:['Taxa de chargeback','Vendas','metric','Pedidos com chargeback no período divididos pelas aprovações do período.'],
  payments:['Vendas por pagamento','Gráficos','payments','Distribuição dos valores brutos aprovados por forma de pagamento.'],
  products:['Vendas por produto','Gráficos','ranking','Produtos dos pedidos aprovados, ordenados pelo valor bruto vendido.'],
  sources:['Vendas por origem','Gráficos','ranking','Origem informada pelos pedidos. Pedidos sem origem continuam contabilizados como não atribuídos.'],
  revenue:['Evolução do faturamento','Gráficos','chart','Faturamento bruto aprovado por dia.'],
  approval:['Taxa de aprovação','Vendas','approval','Aprovações entre os pedidos criados no período, por forma de pagamento.'],
  demands:['Resumo de demandas','Demandas','demands','Situação atual das demandas da sua conta. Não depende do filtro financeiro de datas.'],
  demand_list:['Demandas recentes','Demandas','demand_list','Últimas demandas da sua operação e suas situações atuais.']
 };
 let ctx=null,data=null,saved={},draft=null,drafts={},editing=false,device=null,search='',saving=false,drag=null,dragFrame=0,gridObserver=null,sessionKey=null;
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const currentDevice=()=>matchMedia('(max-width:900px)').matches?'mobile':'desktop';
 const cols=()=>device==='mobile'?4:12;
 const clone=v=>JSON.parse(JSON.stringify(v));
 const b=(label,action,attrs='')=>'<button type="button" data-dashboard-action="'+action+'" '+attrs+'>'+label+'</button>';
 const icon=(name)=>({move:'<path d="M12 3v18M3 12h18m-9-9L9 6m3-3 3 3m6 6-3-3m3 3-3 3m-6 6-3-3m3 3 3-3M3 12l3-3m-3 3 3 3"/>',resize:'<path d="M21 14v7h-7m7-7-7 7M3 10V3h7M3 10l7-7"/>',edit:'<path d="m14 5 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'}[name]||'');
 const svg=name=>'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">'+icon(name)+'</svg>';
 function minimum(id){return catalog[id]?.[2]==='metric'?2:(device==='mobile'?4:3);}
 function overlaps(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
 function vacant(items,w,h,startY=0,preferredX=0){
  for(let y=Math.max(0,startY);y<=95;y++)for(const x of [preferredX,...Array.from({length:cols()-w+1},(_,i)=>i)].filter((x,i,a)=>x>=0&&x+w<=cols()&&a.indexOf(x)===i)){const r={x,y,w,h};if(items.every(it=>!overlaps(it,r)))return r;}
  throw Error('Não há espaço para outro bloco. Remova um bloco ou reduza seus tamanhos.');
 }
 function normalize(items){
  const result=[];
  for(const r of Array.isArray(items)?items:[]){if(!catalog[r?.id]||result.some(it=>it.id===r.id))continue;const w=Math.max(minimum(r.id),Math.min(cols(),Number(r.w)||3)),h=Math.max(catalog[r.id][2]==='metric'?1:2,Math.min(4,Number(r.h)||1));let item={id:r.id,x:Math.max(0,Math.min(cols()-w,Number(r.x)||0)),y:Math.max(0,Math.min(95,Number(r.y)||0)),w,h};if(result.some(it=>overlaps(it,item)))item={...item,...vacant(result,w,h,item.y,item.x)};result.push(item);}
  return result;
 }
 function defaults(){
  if(device==='mobile'){const result=[];for(const id of ['net','spend','profit','roas','demands','pending','approved','product_cost','fees','refunds','tax','chargebacks','margin','roi','expenses','payments','products','revenue']){const w=catalog[id][2]==='metric'?2:4,h=catalog[id][2]==='metric'?1:3;result.push({id,...vacant(result,w,h)});}return result;}
  return normalize([
   ['net',0,0,3,1],['spend',3,0,3,1],['roas',6,0,2,1],['profit',8,0,4,1],
   ['products',0,1,4,3],['pending',4,1,3,1],['product_cost',7,1,2,1],['demands',9,1,3,3],
   ['refunds',4,2,3,1],['tax',7,2,2,1],['fees',4,3,3,1],['margin',7,3,2,1],
   ['payments',0,4,4,3],['revenue',4,4,5,3],['expenses',9,4,3,1],['roi',9,5,3,1],['chargebacks',9,6,3,1],['approved',0,7,3,1],['approval',3,7,3,3],['sources',6,7,3,3],['demand_list',9,7,3,3]
  ].map(([id,x,y,w,h])=>({id,x,y,w,h})));
 }
 const layout=()=>editing?draft:saved[device]?.layout||defaults();
 function move(id,change){
  const item=draft.find(i=>i.id===id);if(!item)return;
  const moved={...item,...change};moved.w=Math.max(minimum(id),Math.min(cols(),moved.w));moved.h=Math.max(catalog[id][2]==='metric'?1:2,Math.min(4,moved.h));moved.x=Math.max(0,Math.min(cols()-moved.w,moved.x));moved.y=Math.max(0,Math.min(95,moved.y));
  const rest=draft.filter(i=>i.id!==id),placed=[moved];
  for(const r of rest){placed.push(placed.some(p=>overlaps(p,r))?{...r,...vacant(placed,r.w,r.h,r.y,r.x)}:r);}
  draft=placed;
 }
 const paymentName=v=>({PIX:'Pix',CREDIT_CARD:'Cartão',CREDIT:'Cartão',BOLETO:'Boleto',BANK_SLIP:'Boleto',OTHER:'Outros',credit_card:'Cartão',pix:'Pix',boleto:'Boleto'}[v]||v||'Outros');
 const sourceName=v=>({meta:'Meta Ads',google:'Google Ads',tiktok:'TikTok Ads',unattributed:'Não atribuída',organic:'Orgânico'}[v]||v);
 const ratio=(n,d)=>Number(d)>0?Number(n)/Number(d)*100:null;
 const pct=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
 const number=v=>Number(v||0).toLocaleString('pt-BR');
 function metric(id){
  const count=data.counts||{},platforms=['meta','google','tiktok'].filter(p=>(data.ad_platforms||[]).includes(p)).map(ctx.brand.name).join(' e ');
  const values={net:[data.net_minor,'Recebido pelo checkout'],spend:[data.spend_minor,platforms||'Contas selecionadas'],profit:[data.profit_minor,data.estimated_orders?'Inclui custos históricos estimados':'Após custos, impostos e anúncios'],gross:[data.gross_minor,'Aprovações no período'],pending:[count.pending_minor,number(count.pending)+' pedidos aguardando'],product_cost:[data.product_minor,'Custos das vendas aprovadas'],refunds:[data.refunds_minor,number(count.refunded)+' pedidos reembolsados'],tax:[data.tax_minor,'Impostos sobre as vendas'],chargebacks:[data.chargebacks_minor,number(count.chargebacks)+' pedidos com chargeback'],fees:[data.fees_minor,data.native_fees_minor?'Inclui taxas já descontadas no líquido':'Taxas adicionais das vendas'],expenses:[data.extra_minor,'Despesas da operação']};
  let value,note='';if(values[id]){value=ctx.money(values[id][0]);note=values[id][1];}else if(id==='roas'){value=data.roas==null?'—':Number(data.roas).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'×';note='Receita líquida ÷ anúncios';}else if(id==='margin'||id==='roi'){value=pct(data[id]);note=id==='margin'?'Lucro sobre receita líquida':'Retorno sobre o investimento';}else if(id==='approved'){value=number(count.approved);note='Pedidos aprovados no período';}else{value=pct(ratio(count[id==='refund_rate'?'refunded':'chargebacks'],count.approved));note='Sobre as aprovações do período';}
  const missing=id==='spend'?!ctx.setup.ads_ready:!ctx.setup.checkout_ready;
  if(missing)return '<div class="md-value md-missing">—</div><small>Conecte '+(id==='spend'?'seus anúncios':'seu checkout')+' para acompanhar</small>';
  return '<div class="md-value '+(id==='profit'?(Number(data.profit_minor)<0?'md-negative':'md-positive'):id==='net'?'md-positive':'')+'">'+esc(value)+'</div><small>'+esc(note)+'</small>';
 }
 function ranking(rows,kind){
  if(!rows?.length)return '<div class="md-empty">Nenhuma venda no período</div>';
  const max=Math.max(1,...rows.map(r=>Number(r.amount_minor||0)));
  return '<div class="md-ranking">'+rows.map(r=>'<div><div class="md-rank-label"><span title="'+esc(r.label)+'">'+esc(kind==='sources'?sourceName(r.label):r.label)+'</span><strong>'+esc(ctx.money(r.amount_minor))+'</strong></div><div class="md-rank-track"><i style="width:'+Math.max(1,Number(r.amount_minor)/max*100)+'%"></i></div><small>'+number(r.count)+' '+(kind==='products'?'unidades':'vendas')+'</small></div>').join('')+'</div>';
 }
 function payments(){
  const rows=data.payments||[],total=rows.reduce((n,r)=>n+Number(r.amount_minor),0),colors=['#a78bfa','#34d399','#60a5fa','#fbbf24','#fb7185'];let angle=0;
  const stops=rows.map((r,i)=>{const from=angle;angle+=Number(r.amount_minor)/Math.max(1,total)*100;return colors[i%5]+' '+from+'% '+angle+'%';});
  return '<div class="md-payments"><div class="md-donut" role="img" aria-label="'+esc('Vendas por pagamento: '+rows.map(r=>paymentName(r.label)+' '+number(r.count)).join(', '))+'" style="--md-donut:'+(!total?'var(--bg4)':stops.join(','))+'"><span><small>Total</small><strong>'+number(rows.reduce((n,r)=>n+Number(r.count),0))+'</strong></span></div><div class="md-payment-legend">'+(rows.length?rows.map((r,i)=>'<div><i style="background:'+colors[i%5]+'"></i><span>'+esc(paymentName(r.label))+'</span><strong>'+esc(ctx.money(r.amount_minor))+'</strong></div>').join(''):'<span class="md-empty">Sem vendas no período</span>')+'</div></div>';
 }
 function body(id){
  const kind=catalog[id][2];if(kind==='metric')return metric(id);
  if(kind==='ranking')return ranking(data[id],id);
  if(kind==='payments')return payments();
  if(kind==='chart')return data.daily?.length?ctx.chart(data.daily):'<div class="md-empty">As vendas aprovadas aparecerão aqui</div>';
  if(kind==='approval')return '<div class="md-approval">'+(data.approval?.length?data.approval.map(r=>'<div><span>'+esc(paymentName(r.label))+'</span><strong>'+pct(ratio(r.approved,r.total))+'</strong><small>'+number(r.approved)+' de '+number(r.total)+'</small></div>').join(''):'<div class="md-empty">Sem pedidos no período</div>')+'</div>';
  const demands=ctx.demands||[],states=[['Concluído','Concluídas','md-positive'],['Em andamento','Em produção','md-progress'],['Não iniciado','Pendentes','']];
  if(kind==='demands')return '<div class="md-demands">'+states.map(([s,label,color])=>'<div><span>'+label+'</span><strong class="'+color+'">'+number(demands.filter(d=>d.status===s).length)+'</strong></div>').join('')+'</div>'+b('Minhas demandas →','demands','class="md-link"');
  return '<div class="md-demand-list">'+(demands.length?demands.slice().sort((a,b)=>String(b.createdAt||b.created_at||'').localeCompare(String(a.createdAt||a.created_at||''))).slice(0,8).map(d=>'<div><strong>'+esc(d.title||d.name||'Demanda')+'</strong><small>'+esc(d.status)+'</small></div>').join(''):'<div class="md-empty">Nenhuma demanda por aqui</div>')+'</div>'+b('Ver demandas →','demands','class="md-link"');
 }
 function tile(item){
  const [title,,kind,info]=catalog[item.id];
  return '<article class="md-tile md-type-'+kind+'" data-widget="'+item.id+'" style="grid-column:'+(item.x+1)+' / span '+item.w+';grid-row:'+(item.y+1)+' / span '+item.h+'" aria-label="'+title+'">'+
   (editing?'<div class="md-tile-tools"><button type="button" class="md-drag" data-dashboard-drag="'+item.id+'" title="Arraste para mover" aria-label="Mover '+title+'">'+svg('move')+'</button><div class="md-size-controls">'+b('−','shrink','data-id="'+item.id+'" aria-label="Diminuir largura de '+title+'"')+b('+','grow','data-id="'+item.id+'" aria-label="Aumentar largura de '+title+'"')+b('↕','height','data-id="'+item.id+'" aria-label="Alterar altura de '+title+'"')+'</div>'+b('×','remove','data-id="'+item.id+'" aria-label="Remover '+title+'"')+'</div>':'')+
   '<div class="md-tile-heading"><h3>'+title+'</h3><button class="md-info" type="button" data-dashboard-action="info" data-id="'+item.id+'" aria-label="Sobre '+title+'" title="'+esc(info)+'">ⓘ</button></div><div class="md-tile-body">'+body(item.id)+'</div>'+
   (editing?'<button type="button" class="md-resize" data-dashboard-resize="'+item.id+'" title="Arraste para redimensionar" aria-label="Redimensionar '+title+'">'+svg('resize')+'</button>':'')+'</article>';
 }
 function library(){
  return '<aside class="md-library" aria-label="Blocos disponíveis"><h3>Adicionar blocos</h3><label class="md-search-label">Buscar métricas<input id="md-search" type="search" placeholder="Nome do bloco" value="'+esc(search)+'"></label><div id="md-library-list">'+libraryRows()+'</div></aside>';
 }
 function libraryRows(){return ['Financeiro','Vendas','Gráficos','Demandas'].map(group=>{const rows=Object.entries(catalog).filter(([id,c])=>c[1]===group&&c[0].toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));return rows.length?'<section><h4>'+group+'</h4>'+rows.map(([id,c])=>{const added=draft.some(r=>r.id===id);return b('<span>'+c[0]+'</span><span aria-hidden="true">'+(added?'✓':'+')+'</span>','add','data-id="'+id+'" '+(added?'disabled':'')+' aria-label="Adicionar '+c[0]+'"');}).join('')+'</section>':'';}).join('');}
 function html(){
  if(!data)return '';
  return '<div class="md-dashboard '+(editing?'md-editing':'')+' '+(device==='mobile'?'md-mobile-layout':'')+'"'+(editing?' data-no-pull':'')+'>'+
   '<div class="md-toolbar">'+(editing?'<div><strong>Personalizar Menu</strong><p>Arraste os blocos e os cantos para ajustar. As mudanças só entram ao salvar.</p></div><div class="md-device" role="group" aria-label="Layout do dispositivo">'+['desktop','mobile'].map(d=>b(d==='desktop'?'Computador':'Celular','device','data-device="'+d+'" aria-pressed="'+(device===d)+'"')).join('')+'</div><div class="md-editor-actions">'+b('Restaurar padrão','reset')+b('Cancelar','cancel')+b(saving?'Salvando…':'Salvar','save','class="primary" '+(saving?'disabled':''))+'</div>':'<div><strong>Resultados da operação</strong><p>Dados do período selecionado</p></div>'+b(svg('edit')+' Personalizar','edit','class="md-customize"'))+'</div>'+
   (data.estimated_orders&&!editing?'<div class="md-estimate-note"><span>Lucro com custos históricos estimados em '+number(data.estimated_orders)+' '+(data.estimated_orders===1?'venda':'vendas')+'.</span>'+b('Entender cálculo','explain-profit')+'</div>':'')+
   '<div class="md-workspace">'+(editing?library():'')+'<div class="md-grid" id="md-grid" style="--md-cols:'+cols()+';--md-rows:'+Math.max(1,...layout().map(r=>r.y+r.h))+'">'+layout().map(tile).join('')+'</div></div></div>';
 }
 function paint(focusId){const root=$('md-dashboard-root');if(!root)return;root.innerHTML=html();observe();if(focusId)root.querySelector(focusId)?.focus({preventScroll:true});}
 function observe(){gridObserver?.disconnect();$('tracking-toolbar')?.toggleAttribute('inert',editing);const grid=$('md-grid');if(!grid)return;gridObserver=new ResizeObserver(()=>{const width=grid.clientWidth;grid.style.setProperty('--md-row',editing?'132px':device==='mobile'?'96px':width<700?'104px':'94px');});gridObserver.observe(grid);}
 async function readDevice(d,force=false){if(saved[d]&&!force)return;const key=sessionKey,record=await ctx.api('/dashboard-layout',null,{device:d});if(key!==sessionKey)return;saved[d]={revision:record.revision||0,layout:record.layout?normalize(record.layout):null};}
 async function action(name,el){
  if(saving)return;
  if(name==='edit'){draft=clone(layout());drafts={};editing=true;search='';paint('[data-dashboard-action=cancel]');return;}
  if(name==='cancel'){editing=false;draft=null;drafts={};device=currentDevice();await readDevice(device,true);paint('[data-dashboard-action=edit]');return;}
  if(name==='save'){
   saving=true;paint();const key=sessionKey;
   try{drafts[device]=clone(draft);const layouts=Object.fromEntries(Object.entries(drafts).map(([d,items])=>[d,{layout:items,revision:saved[d]?.revision||0}]));const result=await ctx.api('/dashboard-layout',{layouts});if(key!==sessionKey)return;for(const [d,r] of Object.entries(result))saved[d]={layout:clone(r.layout),revision:r.revision};editing=false;draft=null;drafts={};device=currentDevice();await readDevice(device);ctx.toast('Menu personalizado salvo.');}
   catch(e){ctx.toast(e.message);}finally{saving=false;paint();}if(!editing)await ctx.refresh?.();return;
  }
  if(name==='device'){drafts[device]=clone(draft);device=el.dataset.device;await readDevice(device);draft=clone(drafts[device]||saved[device].layout||defaults());paint();return;}
  if(name==='reset'){draft=defaults();paint();return;}
  if(name==='add'){const id=el.dataset.id;if(draft.some(r=>r.id===id))return;const w=catalog[id][2]==='metric'?(device==='mobile'?2:3):(device==='mobile'?4:4),h=catalog[id][2]==='metric'?1:3;draft.push({id,...vacant(draft,w,h)});paint();return;}
  if(name==='remove'){if(draft.length===1){ctx.toast('Mantenha pelo menos um bloco no Menu.');return;}draft=draft.filter(r=>r.id!==el.dataset.id);paint();return;}
  if(['grow','shrink','height'].includes(name)){const r=draft.find(r=>r.id===el.dataset.id);move(r.id,name==='height'?{h:r.h%4+1}:{w:r.w+(name==='grow'?1:-1)});paint();return;}
  if(name==='demands'){ctx.demandsOpen();return;}
  if(name==='info'){const c=catalog[el.dataset.id];ctx.modal(c[0],'<p>'+esc(c[3])+'</p>'+b('Fechar','close-info'));return;}
  if(name==='close-info'){$('tracking-dialog').close();return;}
  if(name==='explain-profit'){ctx.modal('Como o lucro é calculado','<p>Receita líquida − anúncios − custos de produto − impostos − taxas adicionais − despesas.</p><p>Taxas que o checkout já descontou da receita líquida são mostradas para consulta e não são cobradas novamente.</p><p>Quando uma venda antiga não tinha custos registrados, usamos a primeira configuração disponível após sua aprovação. A estimativa aparece identificada e não altera os pedidos nem os lançamentos originais.</p><div class="md-profit-formula"><strong>Receita líquida</strong><span>'+esc(ctx.money(data.net_minor))+'</span><strong>Anúncios</strong><span>− '+esc(ctx.money(data.spend_minor))+'</span><strong>Custos e despesas adicionais</strong><span>− '+esc(ctx.money(data.costs_minor==null?null:Number(data.costs_minor)+Number(data.expense_minor||0)))+'</span><strong>Lucro estimado</strong><span>'+esc(ctx.money(data.profit_minor))+'</span></div>'+b('Fechar','close-info'));}
 }
 document.addEventListener('click',e=>{const el=e.target.closest('[data-dashboard-action]');if(!el)return;action(el.dataset.dashboardAction,el).catch(err=>ctx.toast(err.message));});
 document.addEventListener('input',e=>{if(e.target.id==='md-search'){search=e.target.value;$('md-library-list').innerHTML=libraryRows();}});
 document.addEventListener('pointerdown',e=>{
  const handle=e.target.closest('[data-dashboard-drag],[data-dashboard-resize]');if(!editing||saving||!handle||e.button!==0)return;
  const id=handle.dataset.dashboardDrag||handle.dataset.dashboardResize,grid=$('md-grid'),tile=handle.closest('[data-widget]'),r=draft.find(r=>r.id===id),style=getComputedStyle(grid),gap=parseFloat(style.gap)||12;
  const main=document.querySelector('#app .main');
  drag={id,resize:Boolean(handle.dataset.dashboardResize),start:clone(r),x:e.clientX,y:e.clientY,pointerX:e.clientX,pointerY:e.clientY,main,scroll:main.scrollTop,px:(grid.clientWidth-gap*(cols()-1))/cols()+gap,py:parseFloat(style.getPropertyValue('--md-row'))+gap,handle,tile,next:{...r}};
  handle.setPointerCapture(e.pointerId);tile.classList.add('md-moving');e.preventDefault();
 });
 function updateDrag(){if(!drag)return;const dx=drag.pointerX-drag.x,dy=drag.pointerY-drag.y+drag.main.scrollTop-drag.scroll;
  drag.next={...drag.start,...(drag.resize?{w:Math.max(minimum(drag.id),Math.min(cols()-drag.start.x,drag.start.w+Math.round(dx/drag.px))),h:Math.max(1,Math.min(4,drag.start.h+Math.round(dy/drag.py)))}:{x:Math.max(0,Math.min(cols()-drag.start.w,drag.start.x+Math.round(dx/drag.px))),y:Math.max(0,Math.min(95,drag.start.y+Math.round(dy/drag.py)))})};
  if(drag.resize){drag.tile.style.gridColumn=(drag.next.x+1)+' / span '+drag.next.w;drag.tile.style.gridRow=(drag.next.y+1)+' / span '+drag.next.h;}else drag.tile.style.transform='translate('+((drag.next.x-drag.start.x)*drag.px)+'px,'+((drag.next.y-drag.start.y)*drag.py)+'px)';
 }
 function autoScroll(){if(!drag)return;const r=drag.main.getBoundingClientRect(),y=drag.pointerY;let delta=y>r.bottom-55?12:y<r.top+100?-12:0;if(delta){drag.main.scrollTop+=delta;updateDrag();}dragFrame=requestAnimationFrame(autoScroll);}
 document.addEventListener('pointermove',e=>{if(!drag)return;drag.pointerX=e.clientX;drag.pointerY=e.clientY;updateDrag();if(!dragFrame)dragFrame=requestAnimationFrame(autoScroll);});
 function finish(cancel=false){cancelAnimationFrame(dragFrame);dragFrame=0;if(!drag)return;const r=drag;drag=null;if(!cancel)move(r.id,r.next);paint('[data-dashboard-drag="'+r.id+'"]');}
 document.addEventListener('pointerup',()=>finish());document.addEventListener('pointercancel',()=>finish(true));
 document.addEventListener('keydown',e=>{const handle=e.target.closest('[data-dashboard-drag]');if(editing&&handle&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const r=draft.find(r=>r.id===handle.dataset.dashboardDrag);move(r.id,{x:r.x+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0),y:r.y+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)});paint('[data-dashboard-drag="'+r.id+'"]');}if(e.key==='Escape'&&drag)finish(true);});
 let resizeFrame=0;addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(async()=>{if(!ctx||editing||device===currentDevice())return;device=currentDevice();await readDevice(device);paint();});});
 window.MagemindDashboard={
  configure(options){ctx={...ctx,...options};},
  async render(options){const key=options.userId+':'+options.workspace;if(key!==sessionKey){this.clear();sessionKey=key;}ctx={...ctx,...options};data=options.data;device=currentDevice();await readDevice(device,true);if(key!==sessionKey)return '';return '<div id="md-dashboard-root">'+html()+'</div>';},
  mount:observe,isEditing:()=>editing,
  leave(){cancelAnimationFrame(dragFrame);dragFrame=0;$('tracking-toolbar')?.removeAttribute('inert');editing=false;draft=null;drafts={};drag=null;},
  clear(){cancelAnimationFrame(dragFrame);dragFrame=0;gridObserver?.disconnect();$('tracking-toolbar')?.removeAttribute('inert');saved={};draft=null;drafts={};editing=false;saving=false;drag=null;data=null;sessionKey=null;device=null;},
  catalog:Object.keys(catalog)
 };
})();
