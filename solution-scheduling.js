/* Commercial presentation and explicit production cadence share one model. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),week=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];let saving=false;
 function schedule(plan={}){
  const category=plan.solutionCategory||plan.solution_category||plan.category;
  const cadence=plan.deliveryCadence||plan.delivery_cadence||(plan.type==='Diario'||category==='infinite_plus'?'daily':['Semanal','Mensal'].includes(plan.type)||category==='weekly_monthly'?'weekly':plan.type==='Avulso'||category==='closed_package'?'package':'none');
  const explicit=String(plan.name||'').match(/(\d+)\s*criativos?\s*(?:por|\/)\s*(?:dia|semana)/i);
  const quantity=cadence==='none'?0:Number(plan.deliveryQuantity??plan.delivery_quantity??(explicit?explicit[1]:plan.qty))||0;
  const days=plan.deliveryWeekdays||plan.delivery_weekdays||(cadence==='package'?[1,2,3,4,5,6,7]:cadence==='none'?[]:[1,2,3,4,5]);
  return{cadence,quantity,days};
 }
 function describe(plan){const s=schedule(plan),unit=s.cadence==='daily'?'dia':s.cadence==='weekly'?'semana':'pacote';return s.cadence==='none'?'Serviço com escopo definido':`${s.quantity} criativo${s.quantity===1?'':'s'} ${unit==='pacote'?'no pacote':'por '+unit}`;}
 const daysText=days=>days.map(d=>week[d-1]).join(' · ');
 function formKind(){const kind=$('p-category').value;return kind==='custom'?$('p-custom-base').value:kind;}
 function sync(source){
  if(source==='availability'&&$('p-custom').value==='1'&&$('p-category').value!=='custom'){$('p-custom-base').value=$('p-category').value;$('p-category').value='custom';}
  if(source==='kind')$('p-custom').value=$('p-category').value==='custom'?'1':'0';
  const custom=$('p-category').value==='custom',kind=formKind(),monthly=kind==='monthly',volume=monthly||kind==='closed_package';
  $('p-category').disabled=false;$('p-custom').value=custom?'1':$('p-custom').value;$('p-custom').disabled=custom;
  $('p-custom-base-group').hidden=!custom;$('p-delivery-group').hidden=!monthly;$('p-weekdays-group').hidden=!monthly;$('p-qty-group').hidden=!volume;
  $('p-qty').required=volume;$('p-qty-label').textContent=monthly?`Criativos por ${$('p-delivery-cadence').value==='daily'?'dia':'semana'} *`:'Quantidade de criativos *';
  $('p-custom-note').style.display=custom?'flex':'none';
  const q=Number($('p-qty').value),days=[...document.querySelectorAll('[name=solution-weekday]:checked')].map(e=>Number(e.value));
  $('p-schedule-summary').hidden=!volume;$('p-schedule-summary').textContent=monthly&&q>0?$('p-delivery-cadence').value==='weekly'?`${q} por semana · até ${q*4} no mês. Entregas: ${daysText(days)||'selecione os dias'}.`:`Até ${q} por dia. Entregas: ${daysText(days)||'selecione os dias'}.`:`${q>0?q:'Defina o volume de'} criativo${q===1?'':'s'} no total, sem renovação automática.`;
 }
 function setDays(days){for(const input of document.querySelectorAll('[name=solution-weekday]'))input.checked=days.includes(Number(input.value));}
 function openNew(custom=false){
  if(!hasPermission('solutions.manage'))return toast('Sem permissão para gerenciar soluções','err');
  editPlanId=null;$('mp-title').textContent='Criar solução';
  for(const id of ['p-name','p-tagline','p-includes','p-qty','p-price','p-price-orig'])$(id).value='';
  $('p-category').value=custom?'custom':'closed_package';$('p-custom-base').value='monthly';$('p-delivery-cadence').value='weekly';$('p-custom').value=custom?'1':'0';$('p-active').value='1';setDays([1,2,3,4,5]);sync();openModal('modal-plans');
 }
 function openEdit(id){
  if(!hasPermission('solutions.manage'))return;const p=DB.plans.find(p=>p.id===id);if(!p)return;
  editPlanId=id;const s=schedule(p),custom=p.custom||p.type==='Personalizado',kind=['daily','weekly'].includes(s.cadence)?'monthly':s.cadence==='package'?'closed_package':'other';
  $('mp-title').textContent='Editar solução';$('p-name').value=p.name;$('p-tagline').value=p.tagline||'';$('p-includes').value=p.includes||'';
  $('p-qty').value=s.quantity||'';$('p-price').value=p.price||'';$('p-price-orig').value=p.priceOrig||'';$('p-category').value=custom?'custom':kind;
  $('p-custom-base').value=kind;$('p-delivery-cadence').value=s.cadence==='daily'?'daily':'weekly';$('p-custom').value=custom?'1':'0';$('p-active').value=p.active?'1':'0';setDays(s.days);sync();openModal('modal-plans');
 }
 async function save(){
  if(!hasPermission('solutions.manage')||saving)return;const name=$('p-name').value.trim();if(!name)return toast('Digite o nome da solução','err');
  const kind=formKind(),cadence=kind==='monthly'?$('p-delivery-cadence').value:kind==='closed_package'?'package':'none',quantity=cadence==='none'?0:Number($('p-qty').value);
  if(cadence!=='none'&&(!Number.isInteger(quantity)||quantity<1||quantity>10000))return toast('Informe uma quantidade inteira entre 1 e 10.000 criativos.','err');
  const days=cadence==='none'?[]:cadence==='package'?[1,2,3,4,5,6,7]:[...document.querySelectorAll('[name=solution-weekday]:checked')].map(e=>Number(e.value));
  if(cadence!=='none'&&!days.length)return toast('Selecione pelo menos um dia de entrega.','err');
  const custom=$('p-category').value==='custom'||$('p-custom').value==='1',category=cadence==='daily'?'infinite_plus':cadence==='weekly'?'weekly_monthly':cadence==='package'?'closed_package':'other',price=Math.max(0,Number($('p-price').value)||0),current=DB.plans.find(p=>p.id===editPlanId);
  const payload={name,type:solutionLegacyType(category,custom),solution_category:category,is_custom:custom,qty:quantity,delivery_cadence:cadence,delivery_quantity:quantity,delivery_weekdays:days,price,price_orig:Math.max(0,Number($('p-price-orig').value)||price),tagline:$('p-tagline').value.trim(),includes:$('p-includes').value.trim(),active:$('p-active').value==='1',sort_order:current?.sortOrder??DB.plans.length,updated_at:new Date().toISOString()};
  saving=true;$('solution-save').disabled=true;
  try{const query=editPlanId?supa.from('plans').update(payload).eq('id',editPlanId):supa.from('plans').insert(payload);const{data,error}=await query.select().single();if(error)throw error;if(current)Object.assign(current,mapPlan(data));else DB.plans.push(mapPlan(data));closeModal('modal-plans');loadSolutions();populateSalePlans();toast('Solução salva.','ok');}
  catch(error){toast('Não foi possível salvar a solução: '+error.message,'err');}finally{saving=false;$('solution-save').disabled=false;}
 }
 window.MagemindSolutions={schedule,describe,daysText,sync,openNew,openEdit,save};
})();
