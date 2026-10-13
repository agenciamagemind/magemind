(() => {
 'use strict';
 const script=document.currentScript,endpoint=script?.dataset.endpoint,key=script?.dataset.site;
 if(!endpoint||!key)return;
 const target=new URL(endpoint,location.href);
 if(target.hostname==='tsawxmlfvnvepzgcztfc.supabase.co'||target.hostname==='app.magemind.com.br')return;
 const allowed=new Set((script.dataset.checkouts||'').split(',').filter(Boolean));
 const windowDays=Math.max(1,Math.min(90,Number(script.dataset.windowDays)||7));
 const fields=['utm_source','utm_medium','utm_campaign','utm_term','utm_content','campaign_id','adset_id','ad_id','gclid','gbraid','wbraid','fbclid'];
 let consent=script.dataset.consent==='granted'?'granted':'denied',memory=null,seen=new Set(),firstCapture=true,stateKey='mm_tracking_v1_'+key;
 const uuid=()=>crypto.randomUUID();
 const hasSource=t=>Boolean(t?.utm_source&&t.utm_source!=='direct');
 function store(){if(consent==='granted')try{localStorage.setItem(stateKey,JSON.stringify(memory));}catch{}}
 function capture(navigation=false){
  if(consent==='denied')return;
  if(!memory&&consent==='granted')try{memory=JSON.parse(localStorage.getItem(stateKey)||'null');}catch{}
  if(memory&&Date.now()-memory.updated_at>windowDays*86400000)memory=null;
  if(!memory)memory={session_id:uuid(),click_id:uuid(),first_touch:{},last_touch:{},updated_at:Date.now()};
  if(memory.session_updated_at&&Date.now()-memory.session_updated_at>1800000)memory.session_id=uuid();
  memory.session_updated_at=Date.now();
  if(firstCapture){
   let previous;try{previous=consent==='granted'?JSON.parse(sessionStorage.getItem(stateKey+'_page')||'null'):null;}catch{}
   memory.page_event_id=performance.getEntriesByType('navigation')[0]?.type==='reload'&&previous?.session_id===memory.session_id?previous.event_id:uuid();
   firstCapture=false;
  }else if(navigation)memory.page_event_id=uuid();
  if(consent==='granted')try{sessionStorage.setItem(stateKey+'_page',JSON.stringify({session_id:memory.session_id,event_id:memory.page_event_id}));}catch{}
  const qs=new URL(location.href).searchParams,touch={};for(const field of fields){const v=qs.get(field);if(v&&v.length<=250)touch[field]=v;}
  if(hasSource(touch)){
   if(!hasSource(memory.first_touch))memory.first_touch={...touch};
   if(JSON.stringify(touch)!==JSON.stringify(memory.last_touch))memory.click_id=uuid();
   memory.last_touch={...touch};memory.updated_at=Date.now();
  }
  store();
 }
 function send(name,occurrence){
  if(consent==='denied'||!memory||!['page_view','view_content','add_to_cart','checkout_click','initiate_checkout'].includes(name))return;
  const dedupe=name+':'+(occurrence||(name==='page_view'?memory.page_event_id:location.pathname+location.search));if(seen.has(dedupe))return;seen.add(dedupe);
  const event={site_key:key,event_id:name==='page_view'?memory.page_event_id:uuid(),session_id:memory.session_id,click_id:memory.click_id,event_name:name,occurred_at:new Date().toISOString(),persisted:consent==='granted',tracking:{...memory.last_touch,mm_click_id:memory.click_id,first_touch:memory.first_touch}};
  fetch(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event),credentials:'omit',keepalive:true}).catch(()=>{});
 }
 function decorate(value){
  if(consent==='denied'||!memory)return value;
  const u=new URL(value,location.href);if(!['http:','https:'].includes(u.protocol)||!allowed.has(u.hostname))return value;
  for(const field of fields)if(memory.last_touch[field]&&!u.searchParams.has(field))u.searchParams.set(field,memory.last_touch[field]);
  if(!u.searchParams.has('sck'))u.searchParams.set('sck','mm_'+memory.click_id);
  else if(u.searchParams.get('sck')!=='mm_'+memory.click_id)console.info('Magemind: sck existente preservado; ponte de clique indisponível neste link.');
  return u.href;
 }
 function scan(root=document){if(consent==='denied')return;root.querySelectorAll?.('a[href]').forEach(a=>{try{const href=decorate(a.href);if(a.href!==href)a.href=href;}catch{}});}
 document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a)return;try{const u=new URL(a.href);if(allowed.has(u.hostname)){a.href=decorate(a.href);send('checkout_click',uuid());}}catch{}},true);
 document.addEventListener('submit',e=>{
  const form=e.target;if(!memory||consent==='denied'||!(form instanceof HTMLFormElement))return;
  const u=new URL(form.action||location.href);if(!allowed.has(u.hostname))return;
  const decorated=new URL(decorate(u.href));
  if(form.method.toLowerCase()==='get'){
   for(const [k,v] of decorated.searchParams)if(!form.elements.namedItem(k)){const input=document.createElement('input');input.type='hidden';input.name=k;input.value=v;form.append(input);}
  }else form.action=decorated.href;
  send('checkout_click',uuid());
 },true);
 for(const method of ['pushState','replaceState']){const original=history[method];history[method]=function(...args){const before=location.href,r=original.apply(this,args);if(before!==location.href){capture(true);scan();send('page_view');}return r;};}
 window.addEventListener('popstate',()=>{capture(true);scan();send('page_view');});
 const observer=new MutationObserver(entries=>{for(const e of entries){if(e.type==='attributes')scan(e.target.parentElement||document);else for(const n of e.addedNodes)if(n.nodeType===1)scan(n.parentElement||document);}});
 observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
 window.MagemindCollect={version:'1.0.0',consent(value){consent=value===true?'granted':value==='ephemeral'?'ephemeral':'denied';if(consent!=='granted')try{localStorage.removeItem(stateKey);sessionStorage.removeItem(stateKey+'_page');}catch{}if(consent==='denied'){memory=null;firstCapture=true;seen.clear();return;}capture();scan();send('page_view');},event(name,occurrence=uuid()){capture();send(name,occurrence);},decorate,reset(){memory=null;firstCapture=true;seen.clear();try{localStorage.removeItem(stateKey);sessionStorage.removeItem(stateKey+'_page');}catch{}}};
 capture();scan();send('page_view');
})();
