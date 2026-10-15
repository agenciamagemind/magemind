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
