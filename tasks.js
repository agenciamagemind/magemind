/* Daily tasks belong to the signed-in CEO or manager; goals keep their own progress rules. */
(function(){
 'use strict';
 const el=id=>document.getElementById(id),esc=value=>escapeHTML(String(value??''));
 const priorities={Alta:0,Média:1,Baixa:2};
 let mode='goals',tasks=[],owner='',request=0,editing=null,busy=false;
 const editor=`<div class="overlay" id="modal-task" onclick="if(event.target===this)closeModal('modal-task')"><div class="modal finance-modal"><div class="m-head"><div class="m-title" id="task-modal-title">Nova tarefa</div><button type="button" class="m-close" aria-label="Fechar" onclick="closeModal('modal-task')">✕</button></div><div class="m-body"><div class="fg"><label class="fl" for="task-title">Título</label><input class="fi" id="task-title" type="text" maxlength="160" placeholder="Ex.: Preparar 3 posts para o Instagram"></div><div class="fg"><label class="fl" for="task-notes">Notas (opcional)</label><textarea class="fi" id="task-notes" maxlength="4000" rows="4" placeholder="Detalhes e próximos passos"></textarea></div><div class="f2"><div class="fg"><label class="fl" for="task-date">Data limite (opcional)</label><input class="fi" id="task-date" type="date"></div><div class="fg"><label class="fl" for="task-priority">Importância</label><select class="fi" id="task-priority"><option value="Baixa">Baixa</option><option value="Média" selected>Média</option><option value="Alta">Alta</option></select></div></div></div><div class="m-foot task-modal-actions"><button type="button" id="task-delete" class="btn btn-ghost task-delete" onclick="MagemindTasks.deleteCurrent()" hidden>Excluir tarefa</button><button type="button" class="btn btn-ghost" onclick="closeModal('modal-task')">Cancelar</button><button type="button" id="task-save" class="btn btn-primary" onclick="MagemindTasks.save()">Salvar tarefa</button></div></div></div>`;
 document.body.insertAdjacentHTML('beforeend',editor);
 const dueText=(task,today)=>!task.due_date?'Sem prazo':task.due_date<today?'Atrasada · '+fDate(task.due_date):task.due_date===today?'Hoje · '+fDate(task.due_date):'Até '+fDate(task.due_date);
 const byOpen=(a,b)=>(a.due_date||'9999-12-31').localeCompare(b.due_date||'9999-12-31')||(priorities[a.priority]??1)-(priorities[b.priority]??1)||String(b.created_at).localeCompare(String(a.created_at));
 const card=(task,done,today)=>`<article class="daily-task ${done?'is-done':''}"><button class="daily-task-check" type="button" aria-label="${done?'Reabrir':'Concluir'} tarefa ${esc(task.title)}" aria-pressed="${done}" onclick="MagemindTasks.toggle('${task.id}')">${done?'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>':''}</button><div class="daily-task-main"><h3>${esc(task.title)}</h3>${task.notes?`<p class="daily-task-notes">${esc(task.notes)}</p>`:''}<div class="daily-task-meta"><span class="badge ${task.priority==='Alta'?'b-rose':task.priority==='Baixa'?'b-emerald':'b-amber'}">${esc(task.priority)}</span><span class="daily-task-due ${!done&&task.due_date&&task.due_date<today?'overdue':''}">${done?'Concluída · '+fDate(MagemindCore.civilDate(task.completed_at)):dueText(task,today)}</span></div></div><button type="button" class="btn btn-ghost btn-xs sale-icon daily-task-edit" aria-label="Editar tarefa ${esc(task.title)}" onclick="MagemindTasks.openEditor('${task.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg></button></article>`;
 function render(){
  if(mode!=='tasks'||!isAdmin()||owner!==DB.me?.id)return;
  const today=MagemindCore.civilDate(),open=tasks.filter(t=>!t.completed_at).sort(byOpen),done=tasks.filter(t=>t.completed_at).sort((a,b)=>String(b.completed_at).localeCompare(String(a.completed_at)));
  el('tasks-content').innerHTML=`<div class="daily-task-intro"><div><span class="daily-task-eyebrow">Organize seu dia</span><h2>Suas tarefas</h2><p>Pequenas ações para avançar todos os dias.</p></div><div class="daily-task-count"><strong>${open.length}</strong><span>${open.length===1?'pendente':'pendentes'}</span></div></div><section class="daily-task-section" aria-labelledby="open-task-title"><div class="daily-task-section-head"><h2 id="open-task-title">A fazer</h2><span>${open.length}</span></div><div class="daily-task-list">${open.length?open.map(t=>card(t,false,today)).join(''):'<div class="daily-task-empty">Tudo em dia. Crie uma tarefa para começar.</div>'}</div></section><section class="daily-task-section" aria-labelledby="done-task-title"><div class="daily-task-section-head"><h2 id="done-task-title">Concluídas</h2><span>${done.length}</span></div><div class="daily-task-list">${done.length?done.map(t=>card(t,true,today)).join(''):'<div class="daily-task-empty">As tarefas concluídas aparecerão aqui.</div>'}</div></section>`;
 }
 async function load(){
  const current=++request;if(!isAdmin()||!DB.me){tasks=[];owner='';return;}
  const user=DB.me.id;if(owner!==user){tasks=[];owner=user;}
  const host=el('tasks-content');host.setAttribute('aria-busy','true');if(!tasks.length)host.innerHTML='<div class="daily-task-empty">Carregando tarefas...</div>';
  try{
   const rows=[];for(let offset=0;;offset+=1000){const {data,error}=await supa.from('daily_tasks').select('id,title,notes,due_date,priority,completed_at,created_at,updated_at').eq('owner_id',user).order('created_at',{ascending:false}).order('id').range(offset,offset+999);if(error)throw error;rows.push(...data);if(data.length<1000)break;}
   if(current!==request||DB.me?.id!==user)return;tasks=rows;render();
  }catch(error){if(current===request){host.innerHTML='<div class="daily-task-empty" role="alert">Não foi possível carregar suas tarefas. <button class="btn btn-ghost" onclick="MagemindTasks.load()">Tentar novamente</button></div>';toast('Erro ao carregar tarefas: '+error.message,'err');}}
  finally{if(current===request)host.removeAttribute('aria-busy');}
 }
 function setMode(next){
  if(!isAdmin()||!['goals','tasks'].includes(next))return;
  mode=next;el('goals-panel').hidden=next!=='goals';el('tasks-panel').hidden=next!=='tasks';el('goal-create-action').hidden=next!=='goals';el('task-create-action').hidden=next!=='tasks';
  for(const kind of ['goals','tasks']){const tab=el('goals-mode-'+kind);tab.setAttribute('aria-selected',String(kind===next));tab.tabIndex=kind===next?0:-1;}
  if(next==='tasks')load();else originalLoadGoals();
 }
 function handleTabKey(event){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='ArrowLeft'||event.key==='Home'?'goals':'tasks';setMode(next);el('goals-mode-'+next).focus();}
 function openEditor(id){if(!isAdmin())return;editing=id?tasks.find(t=>t.id===id):null;if(id&&!editing)return;el('task-modal-title').textContent=editing?'Editar tarefa':'Nova tarefa';el('task-title').value=editing?.title||'';el('task-notes').value=editing?.notes||'';el('task-date').value=editing?.due_date||'';el('task-priority').value=editing?.priority||'Média';el('task-delete').hidden=!editing;openModal('modal-task');el('task-title').focus();}
 async function save(){
  if(!isAdmin()||busy)return;const title=el('task-title').value.trim(),notes=el('task-notes').value.trim(),due_date=el('task-date').value||null,priority=el('task-priority').value;
  if(!title||title.length>160||notes.length>4000||!Object.hasOwn(priorities,priority)){toast('Informe um título e confira os dados da tarefa.','err');return;}
  busy=true;el('task-save').disabled=true;try{const payload={title,notes,due_date,priority};const query=editing?supa.from('daily_tasks').update(payload).eq('id',editing.id).eq('updated_at',editing.updated_at):supa.from('daily_tasks').insert(payload);const {data,error}=await query.select('id').single();if(error||!data)throw error||new Error('A tarefa foi alterada em outra sessão.');closeModal('modal-task');await load();toast('Tarefa salva.','ok');}catch(error){toast('Não foi possível salvar. Atualize a lista e tente novamente. '+error.message,'err');}finally{busy=false;el('task-save').disabled=false;}
 }
 async function toggle(id){
  if(!isAdmin()||busy)return;const task=tasks.find(t=>t.id===id);if(!task)return;busy=true;try{const {data,error}=await supa.from('daily_tasks').update({completed_at:task.completed_at?null:new Date().toISOString()}).eq('id',id).eq('updated_at',task.updated_at).select('id').single();if(error||!data)throw error||new Error('A tarefa foi alterada em outra sessão.');await load();}catch(error){await load();toast('Não foi possível atualizar a tarefa: '+error.message,'err');}finally{busy=false;}
 }
 async function deleteCurrent(){
  if(!isAdmin()||!editing||busy||!window.confirm('Excluir esta tarefa?'))return;busy=true;const task=editing;try{const {data,error}=await supa.from('daily_tasks').delete().eq('id',task.id).eq('updated_at',task.updated_at).select('id').single();if(error||!data)throw error||new Error('A tarefa foi alterada em outra sessão.');closeModal('modal-task');editing=null;await load();toast('Tarefa excluída.','ok');}catch(error){toast('Não foi possível excluir: '+error.message,'err');}finally{busy=false;}
 }
 function clear(){request++;tasks=[];owner='';editing=null;mode='goals';const host=el('tasks-content');if(host)host.innerHTML='';el('goals-panel').hidden=false;el('tasks-panel').hidden=true;el('goal-create-action').hidden=false;el('task-create-action').hidden=true;for(const kind of ['goals','tasks']){const tab=el('goals-mode-'+kind);tab.setAttribute('aria-selected',String(kind==='goals'));tab.tabIndex=kind==='goals'?0:-1;}}
 const originalLoadGoals=window.loadGoals;
 window.loadGoals=function(){return mode==='tasks'?load():originalLoadGoals();};
 window.MagemindTasks={load,setMode,handleTabKey,openEditor,save,toggle,deleteCurrent,clear,get mode(){return mode;}};
})();
