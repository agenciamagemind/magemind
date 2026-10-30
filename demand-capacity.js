/* Date choices are advisory; the database reserves each production slot. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>escapeHTML(String(v??''));let state=null,sequence=0,calendar=null;
 const today=()=>MagemindCore.civilDate(),iso=d=>d.toISOString().slice(0,10),parse=s=>new Date(s+'T12:00:00Z'),dow=s=>((parse(s).getUTCDay()+6)%7)+1;
 function target(){return state?.modal==='modal-demand'?{client:canSelectDemandClient()?$('d-client').value:DB.me?.clientId,date:$('d-date').value,exclude:editDemandId||null}:{client:DB.demands.find(d=>d.id===currentDemandId)?.client,date:$('det-date')?.value,exclude:currentDemandId};}
 async function read(client,date,exclude){const{data,error}=await supa.rpc('get_demand_capacity',{p_client_id:client,p_date:date||null,p_exclude:exclude||null});if(error)throw error;return data;}
 function hideCalendar(){if(!calendar)return;if(calendar.matches(':popover-open'))calendar.hidePopover();calendar.remove();calendar=null;}
 function closed(id){if(!id||state?.modal===id){sequence++;hideCalendar();if(state){state.hint.remove();const input=state.wrap.querySelector('#d-date,#det-date');if(input){if(input.tagName==='INPUT')input.readOnly=false;state.wrap.replaceWith(input);}}state=null;}}
 function clear(){closed();}
 function paint(data){
  if(!state)return;state.data=data;const box=state.hint;
  if(!data||!Array.isArray(data.plans)){box.hidden=true;return;}
  const plans=data.plans;box.hidden=false;box.classList.toggle('is-error',plans.length>0&&!data.allowed);
  if(!plans.length){box.textContent=isClient()?'Nenhum plano de produção vinculado.':'Sem plano de produção vinculado. A equipe pode registrar uma demanda avulsa.';state.input.readOnly=false;state.button.hidden=true;return;}
  const selected=plans.find(p=>p.remaining>0)||plans[0];
  const usage=p=>p.cadence==='daily'?`${p.day_used} de ${p.quantity} neste dia`:p.cadence==='weekly'?`${p.week_used} de ${p.quantity} nesta semana · ${p.month_used} de ${p.month_limit} neste mês`:`${p.total_used} de ${p.quantity} no pacote`;
  box.innerHTML=`<strong>${esc(selected.name)}</strong><span>${esc(data.allowed?usage(selected):data.reason)}</span><small>Entregas: ${esc(MagemindSolutions.daysText(data.weekdays))}. Cada demanda corresponde a 1 criativo.</small>${plans.length>1?`<details><summary>Ver os planos vinculados</summary>${plans.map(p=>`<p>${esc(p.name)} · ${esc(usage(p))}</p>`).join('')}</details>`:''}`;
  state.button.hidden=typeof HTMLElement.prototype.showPopover!=='function';state.input.readOnly=!state.button.hidden;
 }
 async function refresh(adjust=false){
  if(!state||!DB.me)return;const current=state,t=target(),request=++sequence,uid=DB.me.id;if(!t.client)return;
  try{const data=await read(t.client,t.date,t.exclude);if(request!==sequence||state!==current||DB.me?.id!==uid)return;
   if(adjust&&current.modal==='modal-demand'&&!editDemandId&&data?.weekdays?.length&&t.date&&!data.weekdays.includes(dow(t.date))){let date=parse(t.date);for(let i=0;i<7;i++){date.setUTCDate(date.getUTCDate()+1);if(data.weekdays.includes(dow(iso(date)))){current.input.value=iso(date);break;}}return refresh();}
   paint(data);
  }catch{if(request===sequence&&state===current){current.hint.hidden=false;current.hint.classList.add('is-error');current.hint.textContent='Não foi possível consultar os limites. Tente novamente antes de salvar.';}}
 }
 async function validate(client,date,exclude=null,notify=true){
  const existing=exclude&&DB.demands.find(d=>d.id===exclude);if(existing&&existing.client===client&&existing.date===date)return true;
  try{const data=await read(client,date,exclude);if(!data||!Array.isArray(data.plans))return true;
   if(data.allowed||(!isClient()&&!data.plans.length))return true;
   if(notify)toast(data.reason||'Esta data não está disponível para a entrega.','err');return false;
  }catch{if(notify)toast('Não foi possível validar a entrega. Tente novamente.','err');return false;}
 }
 function showCalendar(){
  if(!state?.data?.plans?.length||state.button.hidden)return;hideCalendar();const current=state,t=target(),selected=t.date||today();let month=selected.slice(0,7);
  calendar=document.createElement('div');calendar.className='production-calendar';calendar.setAttribute('popover','auto');calendar.setAttribute('role','dialog');calendar.setAttribute('aria-label','Escolher data de entrega');current.input.closest('.modal').append(calendar);
  const render=()=>{
   const first=parse(month+'-01'),last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);const offset=(first.getUTCDay()+6)%7;
   calendar.innerHTML=`<div class="production-calendar-head"><button type="button" data-calendar-step="-1" aria-label="Mês anterior">‹</button><strong>${esc(new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(first))}</strong><button type="button" data-calendar-step="1" aria-label="Próximo mês">›</button></div><div class="production-calendar-grid">${['S','T','Q','Q','S','S','D'].map(d=>`<small aria-hidden="true">${d}</small>`).join('')}${'<span></span>'.repeat(offset)}${Array.from({length:last.getUTCDate()},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0'),disabled=!current.data.weekdays.includes(dow(date))||(isClient()&&date<today());return `<button type="button" data-calendar-date="${date}" ${disabled?'disabled':''} ${date===t.date?'aria-current="date"':''} aria-label="${esc(fDate(date))}">${i+1}</button>`;}).join('')}</div><p>Dias disponíveis conforme o plano.</p>`;
  };
  calendar.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();hideCalendar();current.button.focus({preventScroll:true});}});
  calendar.addEventListener('click',async e=>{
   const step=e.target.closest('[data-calendar-step]');if(step){const date=parse(month+'-01');date.setUTCMonth(date.getUTCMonth()+Number(step.dataset.calendarStep));month=iso(date).slice(0,7);render();return;}
   const button=e.target.closest('[data-calendar-date]');if(!button||button.disabled)return;button.disabled=true;
   const date=button.dataset.calendarDate;if(!await validate(t.client,date,t.exclude)){if(calendar)render();return;}if(state!==current||!calendar)return;
   current.input.value=date;hideCalendar();current.input.dispatchEvent(new Event('input',{bubbles:true}));current.input.dispatchEvent(new Event('change',{bubbles:true}));current.button.focus({preventScroll:true});
  });
  render();calendar.showPopover();const r=current.input.getBoundingClientRect(),c=calendar.getBoundingClientRect();calendar.style.left=Math.max(10,Math.min(r.left,innerWidth-c.width-10))+'px';calendar.style.top=Math.max(10,r.bottom+c.height+8<innerHeight?r.bottom+6:r.top-c.height-6)+'px';
 }
 function opened(id){
  if(!['modal-demand','modal-detail'].includes(id))return;closed();const input=$(id==='modal-demand'?'d-date':'det-date');if(input?.tagName!=='INPUT')return;
  let wrap=input.closest('.capacity-date-wrap');if(!wrap){wrap=document.createElement('div');wrap.className='capacity-date-wrap';input.before(wrap);wrap.append(input);}
  wrap.querySelectorAll('button').forEach(b=>b.remove());const button=document.createElement('button');button.type='button';button.className='capacity-calendar-toggle';button.hidden=true;button.setAttribute('aria-label','Escolher data de entrega');button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/></svg>';wrap.append(button);
  const old=wrap.nextElementSibling;let hint=old?.classList.contains('demand-capacity-summary')?old:document.createElement('div');hint.className='demand-capacity-summary';hint.setAttribute('role','status');hint.hidden=true;if(hint!==old)wrap.after(hint);
  state={modal:id,input,button,hint,wrap,data:null};button.addEventListener('click',showCalendar);input.readOnly=false;if(isClient())input.min=today();else input.removeAttribute('min');refresh(true);
 }
 async function restoreDate(id,version,key){
  const user=DB.me?.id;try{const{data,error}=await supa.from('demands').select('due_date').eq('id',id).maybeSingle();if(DB.me?.id!==user||error||!data||demandAutosaveVersions.get(key)!==version)return;const d=DB.demands.find(d=>d.id===id);if(d)d.date=data.due_date||'';demandAutosavePending.delete(key);if(currentDemandId===id){$('det-date').value=data.due_date||'';refresh();}renderKanban();}catch{}
 }
 document.addEventListener('click',e=>{if(state&&e.target===state.input&&state.input.readOnly)showCalendar();});
 document.addEventListener('change',e=>{if(state&&[state.input.id,'d-client','det-client-sel'].includes(e.target.id)){hideCalendar();refresh();}});
 window.addEventListener('resize',hideCalendar,{passive:true});
 window.MagemindDemandCapacity={opened,closed,clear,validate,restoreDate};
})();
