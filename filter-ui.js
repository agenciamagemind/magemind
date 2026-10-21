(() => {
 'use strict';
 const mobile=()=>matchMedia('(max-width:900px)').matches;
 const filterIcon='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';
 function enhance(root=document){
  root.querySelectorAll('.mt-root .filters').forEach(bar=>{
   if(!bar.querySelector('select'))return;
   let toggle=bar.querySelector('[data-filter-disclosure]');
   if(!toggle){toggle=document.createElement('button');toggle.type='button';toggle.className='quiet app-filter-toggle';toggle.dataset.filterDisclosure='';toggle.setAttribute('aria-expanded','false');bar.classList.add('app-filter-collapsed');bar.append(toggle);}
   const count=[...bar.querySelectorAll('select')].filter(el=>el.value).length;
   toggle.innerHTML=filterIcon+'<span>Filtros'+(count?' · '+count:'')+'</span><span aria-hidden="true">⌄</span>';
  });
 }
 document.addEventListener('click',e=>{const toggle=e.target.closest('[data-filter-disclosure]');if(!toggle)return;const bar=toggle.closest('.filters'),open=bar.classList.toggle('app-filter-expanded');bar.classList.toggle('app-filter-collapsed',!open);toggle.setAttribute('aria-expanded',String(open));});
 function init(){
  initDemandClientPicker();
  enhance();
  const content=document.getElementById('tracking-content');if(content)new MutationObserver(()=>enhance(content)).observe(content,{childList:true});
  const sales=document.getElementById('sales-period-filter');
  if(sales){
   const label=document.createElement('label');label.className='app-sales-period';label.innerHTML='<span class="sr-only">Período das vendas</span><select id="sales-period-select" aria-label="Período das vendas">'+[['today','Hoje'],['yesterday','Ontem'],['7d','Última semana'],['14d','Últimos 14 dias'],['month','Este mês'],['all','Todo o período'],['custom','Período personalizado']].map(([v,t])=>'<option value="'+v+'">'+t+'</option>').join('')+'</select>';sales.prepend(label);
   const select=label.querySelector('select'),sync=()=>{const active=sales.querySelector('button.active');if(active)select.value=active.id.replace('spf-','');};
   select.addEventListener('change',()=>{const choice=select.value;if(choice==='custom'){window.openModal('modal-sales-period');sync();}else window.setSalesPeriod(choice);});
   new MutationObserver(sync).observe(sales,{subtree:true,attributes:true,attributeFilter:['class']});sync();
  }
 }
 function initDemandClientPicker(){
  const select=document.getElementById('client-filter-dd');if(!select)return;
  const root=document.createElement('div');root.className='demand-client-picker';root.hidden=true;
  const trigger=document.createElement('button');trigger.type='button';trigger.className='demand-client-trigger';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-label','Filtrar demandas por cliente');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','demand-client-options');
  trigger.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m3-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 2 4"/></svg><span>Todos os clientes</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  root.append(trigger);select.after(root);
  const panel=document.createElement('div');panel.className='demand-client-popover';panel.hidden=true;
  const search=document.createElement('input');search.type='search';search.placeholder='Nome, e-mail ou telefone';search.setAttribute('aria-label','Pesquisar clientes');search.autocomplete='off';
  const list=document.createElement('div');list.className='demand-client-options';list.id='demand-client-options';list.setAttribute('role','listbox');list.setAttribute('aria-label','Clientes disponíveis');
  panel.append(search,list);document.body.append(panel);
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  function close(focus=false){panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus({preventScroll:true});}
  function rows(){
   const query=normalize(search.value.trim());list.replaceChildren();
   for(const option of select.options){
    const client=typeof DB!=='undefined'?DB.clients.find(c=>c.id===option.value):null;
    const profile=typeof DB!=='undefined'?DB.users.find(u=>u.clientId===option.value):null;
    const email=client?.email||profile?.email||'',phone=client?.phone||profile?.phone||'';
    if(option.value&&query&&!normalize(option.textContent+' '+email+' '+phone).includes(query))continue;
    const row=document.createElement('button');row.type='button';row.className='demand-client-option';row.setAttribute('role','option');row.setAttribute('aria-selected',String(select.value===option.value));
    const text=document.createElement('span'),name=document.createElement('strong');name.textContent=option.textContent;text.append(name);
    if(email){const detail=document.createElement('small');detail.textContent=email;text.append(detail);}
    const mark=document.createElement('span');mark.className='demand-client-check';mark.setAttribute('aria-hidden','true');mark.textContent=select.value===option.value?'✓':'';row.append(text,mark);
    row.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close(true);});list.append(row);
   }
   if(query&&list.children.length===1){const empty=document.createElement('p');empty.className='demand-client-empty';empty.textContent='Nenhum cliente encontrado';list.append(empty);}
  }
  function position(){
   const r=trigger.getBoundingClientRect(),width=Math.min(340,innerWidth-24),below=innerHeight-r.bottom-20,above=r.top-20,up=below<220&&above>below;
   panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(innerWidth-width-12,r.right-width))+'px';panel.style.maxHeight=Math.min(380,Math.max(140,up?above:below))+'px';
   panel.style.top=up?'auto':r.bottom+8+'px';panel.style.bottom=up?innerHeight-r.top+8+'px':'auto';
  }
  function open(){search.value='';rows();panel.hidden=false;trigger.setAttribute('aria-expanded','true');position();search.focus({preventScroll:true});}
  function sync(){
   select.classList.add('demand-filter-native');select.hidden=true;
   const allowed=typeof DB!=='undefined'&&DB.me&&(isAdmin()||isPartner()||isGestor()||isEditor());root.hidden=!allowed;
   trigger.querySelector('span').textContent=select.selectedOptions[0]?.textContent||'Todos os clientes';
   if(!allowed)close();else if(!panel.hidden){rows();position();}
  }
  trigger.addEventListener('click',()=>panel.hidden?open():close(true));
  trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();open();}});
  search.addEventListener('input',rows);
  panel.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
   if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
   const options=[...list.querySelectorAll('[role=option]')],current=options.indexOf(document.activeElement);if(!options.length)return;event.preventDefault();
   const index=event.key==='Home'?0:event.key==='End'?options.length-1:event.key==='ArrowDown'?(current+1)%options.length:(current<=0?options.length:current)-1;options[index].focus();
  });
  document.addEventListener('pointerdown',event=>{if(!root.contains(event.target)&&!panel.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden)close(true);});
  document.addEventListener('scroll',event=>{if(!panel.contains(event.target))close();},true);addEventListener('resize',()=>close());
  select.addEventListener('change',sync);new MutationObserver(sync).observe(select,{childList:true});
  new MutationObserver(()=>{if(!document.body.classList.contains('app-ready')){close();root.hidden=true;}}).observe(document.body,{attributes:true,attributeFilter:['class']});
  panel.addEventListener('focusout',()=>setTimeout(()=>{if(!panel.contains(document.activeElement)&&!root.contains(document.activeElement))close();},0));
  window.MagemindDemandFilters={sync,close:()=>close()};sync();
 }
 // Tooltips live outside overflow-clipped dashboard tiles.
 let tip=null,source=null;
 function hideTip(){tip?.remove();tip=null;source=null;}
 function showTip(el){
  if(!matchMedia('(min-width:901px) and (hover:hover)').matches)return;
  hideTip();source=el;tip=document.createElement('div');tip.className='app-metric-tooltip';tip.id='metric-tooltip';tip.setAttribute('role','tooltip');tip.textContent=el.dataset.tooltip;document.body.append(tip);el.setAttribute('aria-describedby',tip.id);
  const r=el.getBoundingClientRect(),box=tip.getBoundingClientRect();tip.style.left=Math.max(12,Math.min(innerWidth-box.width-12,r.right-box.width))+'px';tip.style.top=(r.bottom+box.height+14<innerHeight?r.bottom+9:Math.max(12,r.top-box.height-9))+'px';
 }
 document.addEventListener('pointerover',e=>{const el=e.target.closest('[data-tooltip]');if(el&&el!==source)showTip(el);});
 document.addEventListener('pointerout',e=>{if(source?.contains(e.target)&&!source.contains(e.relatedTarget)){source.removeAttribute('aria-describedby');hideTip();}});
 document.addEventListener('focusin',e=>{if(e.target.matches('[data-tooltip]'))showTip(e.target);});
 document.addEventListener('focusout',hideTip);document.addEventListener('scroll',hideTip,true);addEventListener('resize',hideTip);document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip();});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
