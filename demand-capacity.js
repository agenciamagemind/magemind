/* Calendar availability is advisory; the server reserves the production slot. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>escapeHTML(String(v??''));let state=null,sequence=0,calendar=null;
 const today=()=>MagemindCore.civilDate(),iso=d=>d.toISOString().slice(0,10),parse=s=>new Date(s+'T12:00:00Z');
 const tomorrow=()=>{const d=parse(today());d.setUTCDate(d.getUTCDate()+1);return iso(d);};
 function target(){return state?.modal==='modal-demand'?{client:canSelectDemandClient()?$('d-client').value:DB.me?.clientId,date:$('d-date').value,exclude:editDemandId||null}:{client:DB.demands.find(d=>d.id===currentDemandId)?.client,date:$('det-date')?.value,exclude:currentDemandId};}
 async function read(client,date,exclude){const{data,error}=await supa.rpc('get_demand_capacity',{p_client_id:client,p_date:date||null,p_exclude:exclude||null});if(error)throw error;return data;}
 async function dates(t,month,findNext=false){const{data,error}=await supa.rpc('get_demand_calendar',{p_client_id:t.client,p_month:month+'-01',p_exclude:t.exclude||null,p_find_next:findNext});if(error)throw error;return data;}
 function hideCalendar(){if(!calendar)return;if(calendar.matches(':popover-open'))calendar.hidePopover();calendar.remove();calendar=null;}
 function closed(id){if(!id||state?.modal===id){sequence++;hideCalendar();if(state){const input=state.wrap.querySelector('#d-date,#det-date');if(input){input.readOnly=false;input.removeAttribute('aria-busy');input.removeAttribute('aria-hidden');input.removeAttribute('tabindex');state.wrap.replaceWith(input);}}state=null;}}
 function clear(){closed();}
 function syncDisplay(current=state){if(!current)return;const custom=current.input.readOnly&&!current.button.hidden;current.label.textContent=current.input.value?fDate(current.input.value):'Escolher data';if(custom){current.input.setAttribute('aria-hidden','true');current.input.tabIndex=-1;}else{current.input.removeAttribute('aria-hidden');current.input.removeAttribute('tabindex');}}
 async function refresh(adjust=false){
  if(!state||!DB.me)return;const current=state,t=target(),request=++sequence,uid=DB.me.id;if(!t.client)return;
  current.cache.clear();current.input.setAttribute('aria-busy','true');
  try{const data=await dates(t,(t.date||tomorrow()).slice(0,7),adjust&&!t.exclude);if(request!==sequence||state!==current||DB.me?.id!==uid)return;
   if(!Array.isArray(data?.days)){current.input.readOnly=false;current.button.hidden=true;return;}
   current.cache.set(data.month.slice(0,7),data);current.data=data;
   if(adjust&&!t.exclude){current.input.value=data.next_date||'';if(!data.next_date)toast('Não há datas de entrega disponíveis. Entre em contato com a equipe.','err');}
   current.input.min=data.min_date||'';current.button.hidden=typeof HTMLElement.prototype.showPopover!=='function';current.input.readOnly=!current.button.hidden;
  }catch{if(request===sequence&&state===current){if(adjust&&!t.exclude)current.input.value='';toast('Não foi possível consultar as datas disponíveis. Tente novamente.','err');}}
  finally{if(state===current&&request===sequence){current.input.removeAttribute('aria-busy');current.button.disabled=false;syncDisplay(current);}}
 }
 async function validate(client,date,exclude=null,notify=true){
  const existing=exclude&&DB.demands.find(d=>d.id===exclude);if(existing&&existing.client===client&&existing.date===date)return true;
  if(isClient()&&(!date||date<tomorrow())){if(notify)toast('As entregas devem ser agendadas a partir de amanhã.','err');return false;}
  try{const data=await read(client,date,exclude);if(!data||!Array.isArray(data.plans))return true;
   if(data.allowed||(!isClient()&&!data.plans.length))return true;
   if(notify)toast(data.reason||'Esta data não está disponível para a entrega.','err');return false;
  }catch{if(notify)toast('Não foi possível validar a entrega. Tente novamente.','err');return false;}
 }
 function showCalendar(){
  if(!state||state.button.hidden)return;hideCalendar();const current=state,t=target(),selected=t.date||current.data?.next_date||tomorrow();let month=selected.slice(0,7),generation=0;
  const surface=document.createElement('div');calendar=surface;surface.className='production-calendar';surface.setAttribute('popover','auto');surface.setAttribute('role','dialog');surface.setAttribute('aria-label','Escolher data de entrega');current.input.closest('.modal').append(surface);
  const position=()=>{if(calendar!==surface)return;const r=current.wrap.getBoundingClientRect(),c=surface.getBoundingClientRect();surface.style.left=Math.max(10,Math.min(r.left,innerWidth-c.width-10))+'px';surface.style.top=Math.max(10,r.bottom+c.height+8<innerHeight?r.bottom+6:r.top-c.height-6)+'px';};
  const render=(message='')=>{
   const first=parse(month+'-01'),last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);const offset=(first.getUTCDay()+6)%7,data=current.cache.get(month),availability=new Map(data?.days.map(d=>[d.date,d.available]));
   surface.setAttribute('aria-busy',String(!data&&!message));
   surface.innerHTML=`<div class="production-calendar-head"><button type="button" data-calendar-step="-1" aria-label="Mês anterior">‹</button><strong>${esc(new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(first))}</strong><button type="button" data-calendar-step="1" aria-label="Próximo mês">›</button></div><div class="production-calendar-grid">${['S','T','Q','Q','S','S','D'].map(d=>`<small aria-hidden="true">${d}</small>`).join('')}${'<span></span>'.repeat(offset)}${Array.from({length:last.getUTCDate()},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0'),disabled=availability.get(date)!==true;return `<button type="button" data-calendar-date="${date}" ${disabled?'disabled':''} ${date===t.date?'aria-current="date"':''} aria-label="${esc(fDate(date))}">${i+1}</button>`;}).join('')}</div><p role="status">${esc(message||(!data?'Consultando datas…':'Selecione uma data disponível.'))}</p>`;position();
  };
  const load=async(force=false)=>{
   const requested=month,version=++generation;if(force)current.cache.delete(requested);render();if(current.cache.has(requested))return;
   try{const data=await dates(t,requested);if(calendar!==surface||state!==current||month!==requested||version!==generation)return;
    if(!Array.isArray(data?.days))throw Error('Invalid calendar');current.cache.set(requested,data);render();
   }catch{if(calendar===surface&&state===current&&month===requested&&version===generation)render('Não foi possível consultar as datas. Tente novamente.');}
  };
  surface.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();hideCalendar();current.button.focus({preventScroll:true});}});
  surface.addEventListener('click',async e=>{
   const step=e.target.closest('[data-calendar-step]');if(step){const date=parse(month+'-01');date.setUTCMonth(date.getUTCMonth()+Number(step.dataset.calendarStep));month=iso(date).slice(0,7);await load();return;}
   const button=e.target.closest('[data-calendar-date]');if(!button||button.disabled)return;button.disabled=true;
   const date=button.dataset.calendarDate;if(!await validate(t.client,date,t.exclude)){if(calendar===surface)await load(true);return;}if(state!==current||calendar!==surface)return;
   current.input.value=date;syncDisplay(current);hideCalendar();current.input.dispatchEvent(new Event('input',{bubbles:true}));current.input.dispatchEvent(new Event('change',{bubbles:true}));current.button.focus({preventScroll:true});
  });
  render();surface.showPopover();position();load();
 }
 function opened(id){
  if(!['modal-demand','modal-detail'].includes(id))return;closed();document.querySelectorAll('.demand-capacity-summary').forEach(el=>el.remove());const input=$(id==='modal-demand'?'d-date':'det-date');if(input?.tagName!=='INPUT')return;
  let wrap=input.closest('.capacity-date-wrap');if(!wrap){wrap=document.createElement('div');wrap.className='capacity-date-wrap';input.before(wrap);wrap.append(input);}
  wrap.querySelectorAll('button').forEach(b=>b.remove());const button=document.createElement('button');button.type='button';button.className='capacity-calendar-toggle';button.hidden=true;button.setAttribute('aria-label','Escolher data de entrega');button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/></svg>';wrap.append(button);
  const label=document.createElement('span');label.className='capacity-date-label';label.id=input.id+'-display';button.prepend(label);button.setAttribute('aria-describedby',label.id);
  state={modal:id,input,button,label,wrap,data:null,cache:new Map()};button.addEventListener('click',showCalendar);input.readOnly=typeof HTMLElement.prototype.showPopover==='function';button.hidden=!input.readOnly;button.disabled=input.readOnly;input.min=isClient()||id==='modal-demand'&&!editDemandId?tomorrow():'';syncDisplay();refresh(true);
 }
 async function restoreDate(id,version,key){
  const user=DB.me?.id;try{const{data,error}=await supa.from('demands').select('due_date').eq('id',id).maybeSingle();if(DB.me?.id!==user||error||!data||demandAutosaveVersions.get(key)!==version)return;const d=DB.demands.find(d=>d.id===id);if(d)d.date=data.due_date||'';demandAutosavePending.delete(key);if(currentDemandId===id){$('det-date').value=data.due_date||'';refresh();}renderKanban();}catch{}
 }
 document.addEventListener('click',e=>{if(state&&e.target===state.input&&state.input.readOnly)showCalendar();});
 document.addEventListener('change',e=>{if(state&&[state.input.id,'d-client','det-client-sel'].includes(e.target.id)){hideCalendar();refresh(e.target.id==='d-client');}});
 window.addEventListener('resize',hideCalendar,{passive:true});
 window.MagemindDemandCapacity={opened,closed,clear,validate,restoreDate};
})();
