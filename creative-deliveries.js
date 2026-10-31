(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=value=>escapeHTML(value||'');
 const driveIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-7 12 4 6h12l4-6-7-12H9Zm0 0 9 18M15 3 6 21M2 15h20"/></svg>';
 let epoch=0,folderFlight=null,folderTimer,settingsFlight=null,section,activeDemand=null,loading=0,publishing=false;
 let picker=null,pickerOpen=false,pickerRequest=0,selection=new Map(),dayLink=null;
 function resetPicker(){picker=null;pickerOpen=false;pickerRequest++;selection.clear();dayLink=null;}
 function collapsePicker(){if(!pickerOpen)return;pickerOpen=false;drawPicker();}
 function closed(){loading++;resetPicker();activeDemand=null;drawPicker();}
 function revealPicker(){
  if(pickerOpen||publishing)return;
  const d=DB.demands.find(x=>x.id===activeDemand);
  if(selection.size&&picker?.day===d?.date&&!picker.error){pickerOpen=true;drawPicker();}else loadPicker();
 }
 async function api(body){
  const{data,error}=await supa.functions.invoke('drive-deliveries',{body});
  if(error){let message;try{message=(await error.context?.json())?.error;}catch{}throw Error(message||'Não foi possível acessar o Drive. Tente novamente.');}
  if(data?.error)throw Error(data.error);return data;
 }
 function clear(){epoch++;loading++;resetPicker();activeDemand=null;publishing=false;folderFlight=null;settingsFlight=null;clearTimeout(folderTimer);if(section){section.hidden=true;section.replaceChildren();}const link=$('my-creatives-link');if(link){link.hidden=true;link.removeAttribute('href');}const note=$('my-creatives-access-note');if(note){note.hidden=true;note.replaceChildren();}$('drive-config-secret')&&($('drive-config-secret').value='');$('drive-settings-card')?.setAttribute('hidden','');}
 function status(text,error=false){const el=$('creative-delivery-status');if(el){el.textContent=text;el.classList.toggle('is-error',error);}}
 function canManage(d){return isOperationalStaff()&&canViewDemand(d);}
 function syncDayAction(){
  const target=$('creative-day-action'),d=DB.demands.find(x=>x.id===activeDemand);if(!target||!d||!canManage(d))return;
  target.innerHTML=dayLink?.day===d.date?`<a class="btn btn-ghost btn-xs" href="${esc(dayLink.url)}" target="_blank" rel="noopener noreferrer">Abrir pasta de ${esc(fDate(d.date))} ↗</a>`:picker?.day===d.date&&!picker.loading&&!picker.error&&picker.folder===null?`<button type="button" class="btn btn-ghost btn-xs" data-creative-action="day" ${publishing?'disabled':''}>Criar pasta do dia</button>`:'';
 }
 function syncSubmit(){const d=DB.demands.find(x=>x.id===activeDemand),button=$('creative-delivery-form')?.querySelector('[type=submit]');if(button)button.textContent=`Entregar${selection.size?` ${selection.size} criativo${selection.size>1?'s':''}`:''}${d?.status==='Concluído'?'':' e concluir'}`;}
 function drawPicker(){
  const box=$('creative-day-picker');if(!box)return;box.hidden=!pickerOpen;$('creative-drive-url')?.setAttribute('aria-expanded',String(pickerOpen));if(!pickerOpen)return;
  box.innerHTML=`<div class="creative-picker-head"><strong>Arquivos de ${esc(fDate(picker?.day||DB.demands.find(x=>x.id===activeDemand)?.date))}</strong><div><button type="button" class="btn btn-ghost btn-xs" data-picker-refresh ${picker?.loading?'disabled':''}>Atualizar</button></div></div>${picker?.error?`<p role="status">${esc(picker.error)}</p>`:''}<div class="creative-picker-files">${(picker?.files||[]).map(file=>`<label class="creative-file-option${selection.has(file.id)?' selected':''}${file.already_delivered?' delivered':''}"><input type="checkbox" data-picker-file="${esc(file.id)}" ${selection.has(file.id)?'checked':''} ${file.already_delivered||publishing?'disabled':''}><span class="creative-file-cover">${file.preview_url?`<img src="${esc(file.preview_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:driveIcon}${file.mime_type.startsWith('video/')?'<span aria-hidden="true">▶</span>':''}</span><span class="creative-file-label"><strong>${esc(file.name)}</strong><small>${file.already_delivered?'Já entregue':file.mime_type.startsWith('video/')?'Vídeo':file.mime_type==='application/pdf'?'PDF':'Imagem'}</small></span></label>`).join('')}</div>${picker?.loading?'<p role="status">Consultando arquivos no Drive…</p>':!picker?.error&&!picker?.files?.length?`<p>${picker?.folder?'Esta pasta ainda não tem criativos disponíveis.':'A pasta desta data ainda não foi criada. Use “Criar pasta do dia” para prepará-la.'}</p>`:''}${picker?.next_page_token?'<button type="button" class="btn btn-ghost btn-xs" data-picker-more>Carregar mais arquivos</button>':''}`;
  for(const img of box.querySelectorAll('img'))img.addEventListener('error',()=>{img.replaceWith(document.createTextNode('↗'));});
 }
 async function loadPicker(more=false,reveal=true){
  if(publishing)return;
  const d=DB.demands.find(x=>x.id===activeDemand);if(!d||!canManage(d))return;
  if(!more&&picker?.loading&&picker.day===d.date){if(reveal){pickerOpen=true;drawPicker();}return;}
  const id=d.id,version=epoch,request=++pickerRequest,date=d.date;pickerOpen=pickerOpen||reveal;
  if(!more){selection.clear();picker={day:date,files:[]};}picker.loading=true;picker.error='';drawPicker();syncSubmit();syncDayAction();
  try{await flushDemandAutosaves(id);if($('det-save-state')?.classList.contains('error'))throw Error('Salve a data de entrega antes de consultar o Drive.');
   const data=await api({action:'day_files',demand:id,...(more?{page_token:picker.next_page_token}:{})});
   if(version!==epoch||request!==pickerRequest||activeDemand!==id||currentDemandId!==id)return;
   if(DB.demands.find(x=>x.id===id)?.date!==data.day)throw Error('A data de entrega mudou. Atualize a lista.');
   picker={...data,files:more?[...new Map([...picker.files,...data.files].map(f=>[f.id,f])).values()]:data.files};
   dayLink=data.folder?{day:data.day,url:data.folder.url}:null;
  }catch(error){if(version===epoch&&request===pickerRequest)picker={...picker,error:error.message};}
  finally{if(version===epoch&&request===pickerRequest){picker.loading=false;drawPicker();syncDayAction();}}
 }
 function accessNote(folder,manage=false){if(!folder?.needs_google_account)return '';return `<div class="creative-access-note"><strong>${manage?'Acesso do cliente ao Drive':'Seu acesso ao Drive'}</strong><p>${manage?'O cliente precisa vincular seu e-mail cadastrado a uma Conta Google para abrir os arquivos. Você já pode entregar os criativos normalmente.':`Para abrir sua pasta privada, use uma Conta Google com o e-mail <strong>${esc(DB.me.email)}</strong>. Você pode criar essa Conta Google usando seu e-mail atual.`}</p>${manage?'':`<div><a href="https://support.google.com/accounts/answer/27441?hl=pt-BR" target="_blank" rel="noopener noreferrer">Como vincular meu e-mail ↗</a><button type="button" class="btn btn-ghost btn-xs" data-creative-retry>Já vinculei · Conferir acesso</button></div>`}</div>`;}
 function render(data,id){
  if(activeDemand!==id||currentDemandId!==id)return;
  const d=DB.demands.find(d=>d.id===id);if(!d||!canViewDemand(d))return;
  const items=data.deliveries||[],manage=data.can_manage===true&&canManage(d);
  const input=$('creative-drive-url'),same=section.dataset.demand===id,typed=same?input?.value||'':'',restoreFocus=same&&document.activeElement===input&&Boolean(input);section.dataset.demand=id;
  section.hidden=!manage&&!items.length;
  section.innerHTML=`<div class="detail-section-head"><div class="detail-section-title"><span aria-hidden="true">↗</span> Criativos entregues${items.length?` <small>· ${items.length}</small>`:''}</div><div class="creative-heading-actions">${manage?'<span id="creative-day-action"></span>':''}${data.folder?.folder_url?`<a class="btn btn-ghost btn-xs" href="${esc(data.folder.folder_url)}" target="_blank" rel="noopener noreferrer">${manage?'Pasta do cliente':'Minha pasta'} ↗</a>`:''}</div></div>
   ${manage?`<form class="creative-publish" id="creative-delivery-form"><p>Cole um link ou selecione os criativos da pasta da data de entrega.</p><label class="sr-only" for="creative-drive-url">Link do criativo no Google Drive</label><div class="creative-link-row"><input class="fi" id="creative-drive-url" type="url" inputmode="url" autocomplete="off" placeholder="Cole o link do arquivo no Drive" maxlength="2048" aria-controls="creative-day-picker" aria-expanded="${pickerOpen}"><button class="btn btn-primary btn-sm" type="submit">Entregar${d.status==='Concluído'?'':' e concluir'}</button></div><div id="creative-day-picker" hidden></div></form>`:''}
   ${accessNote(data.folder,manage)}<p class="creative-delivery-status" id="creative-delivery-status" role="status"></p>
   <div class="creative-delivery-list" ${items.length?'':'hidden'}>${items.map(item=>`<article class="creative-delivery-item"><a class="creative-preview" href="${esc(item.drive_url)}" target="_blank" rel="noopener noreferrer" aria-label="${item.mime_type.startsWith('video/')?'Reproduzir':'Abrir'} ${esc(item.name)} no Google Drive"><span class="creative-fallback">${driveIcon}<span>Abrir no Google Drive</span></span>${item.preview_url?`<img class="creative-preview-image" src="${esc(item.preview_url)}" alt="Prévia de ${esc(item.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}${item.mime_type.startsWith('video/')?'<span class="creative-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m7 4 14 8-14 8V4Z"/></svg></span>':''}</a><div class="creative-delivery-caption"><div><a href="${esc(item.drive_url)}" target="_blank" rel="noopener noreferrer">${esc(item.name)} ↗</a><small>${esc(fDate(item.delivered_on))} · ${item.mime_type.startsWith('video/')?'Vídeo':item.mime_type==='application/pdf'?'PDF':'Imagem'}</small></div>${manage?`<button type="button" class="creative-unlink" data-creative-remove="${esc(item.id)}" aria-label="Remover entrega do card" title="Remove o link do card; o arquivo continua no Drive">×</button>`:''}</div></article>`).join('')}</div>`;
  if(manage){$('creative-drive-url').value=typed;drawPicker();syncSubmit();syncDayAction();if(restoreFocus)$('creative-drive-url').focus({preventScroll:true});}
  for(const image of section.querySelectorAll('.creative-preview img')){
   const ready=()=>{image.classList.add('is-loaded');image.previousElementSibling.hidden=true;};
   image.addEventListener('load',ready,{once:true});
   image.addEventListener('error',()=>{image.remove();},{once:true});
   if(image.complete&&image.naturalWidth)ready();
  }
 }
 async function open(id){
  if(activeDemand!==id)resetPicker();activeDemand=id;const version=epoch,request=++loading,d=DB.demands.find(d=>d.id===id);
  if(!d||!canViewDemand(d)){section.hidden=true;return;}
  render({deliveries:[],can_manage:canManage(d)},id);status('Carregando entregas…');
  try{const data=await api({action:'context',demand:id});if(version!==epoch||request!==loading)return;render(data,id);if(data.can_manage&&canManage(d))await loadPicker(false,false);}
  catch(error){if(version===epoch&&request===loading)status(error.message,true);}
 }
 async function folder(){
  const link=$('my-creatives-link'),note=$('my-creatives-access-note');clearTimeout(folderTimer);if(!DB.me||!isClient()){link.hidden=true;note.hidden=true;return;}
  if(folderFlight)return folderFlight;
  const version=epoch;folderFlight=(async()=>{
   try{const data=await api({action:'my_folder'});if(version!==epoch||!isClient())return;
    note.innerHTML=accessNote(data);note.hidden=!data.needs_google_account;link.hidden=false;if(data.state==='ready'&&data.folder_url){link.href=data.folder_url;link.innerHTML=driveIcon+'Meus criativos';link.removeAttribute('aria-disabled');link.removeAttribute('aria-busy');link.removeAttribute('title');}
    else{link.removeAttribute('href');link.innerHTML=driveIcon+'Meus criativos';link.setAttribute('aria-disabled','true');link.setAttribute('aria-busy','true');link.title='Preparando sua pasta no Drive';if($('pg-demands').classList.contains('active'))folderTimer=setTimeout(folder,15000);}
   }catch{if(version===epoch)link.hidden=true;}
  })().finally(()=>{if(version===epoch)folderFlight=null;});return folderFlight;
 }
 async function settings(){
  const card=$('drive-settings-card');card.hidden=!DB.me||!isAdmin();if(card.hidden||settingsFlight)return;
  const version=epoch;settingsFlight=(async()=>{
   try{const data=await api({action:'config_status'});if(version!==epoch||!isAdmin())return;
    $('drive-config-id').value=data.client_id||'';$('drive-config-root').value=data.root_folder_id?'https://drive.google.com/drive/folders/'+data.root_folder_id:'';
    $('drive-connection-status').textContent=data.connected?'Conectado · '+data.account_email:'Conecte o Drive da agência para organizar as entregas automaticamente.';
    $('drive-config-fields').open=!data.configured;$('drive-connect-button').hidden=!data.configured;$('drive-connect-button').textContent=data.connected?'Reconectar Google Drive':'Conectar Google Drive';
   }catch(error){if(version===epoch)$('drive-connection-status').textContent=error.message;}
  })().finally(()=>{if(version===epoch)settingsFlight=null;});return settingsFlight;
 }
 function init(){
  section=document.createElement('section');section.id='det-deliveries';section.className='detail-section detail-section-card creative-delivery-section';section.hidden=true;$('det-comments-section').before(section);
  const link=document.createElement('a');link.id='my-creatives-link';link.className='btn btn-ghost btn-sm my-creatives-link';link.hidden=true;link.target='_blank';link.rel='noopener noreferrer';$('pg-demands').querySelector('.demand-view-controls').prepend(link);
  const note=document.createElement('div');note.id='my-creatives-access-note';note.hidden=true;$('pg-demands').querySelector('.ph').after(note);
  document.addEventListener('click',async e=>{const button=e.target.closest('[data-creative-retry]');if(!button||!isClient())return;const version=epoch;button.disabled=true;try{const result=await api({action:'check_my_access'});if(version!==epoch)return;await folder();if(activeDemand===currentDemandId&&currentDemandId)await open(currentDemandId);toast(result.needs_google_account?'O Google ainda não reconheceu esse e-mail. Confira a vinculação e tente novamente em instantes.':'Acesso à pasta liberado.',result.needs_google_account?'err':'ok');}catch(error){if(version===epoch)toast(error.message,'err');}finally{if(button.isConnected)button.disabled=false;}});
  const card=document.createElement('div');card.id='drive-settings-card';card.className='settings-card';card.hidden=true;
  card.innerHTML=`<div class="settings-card-title">Google Drive · Entregas de criativos</div><div class="drive-setup"><p>Uma pasta para cada cliente, com as entregas organizadas por dia. Os arquivos permanecem no Drive.</p><div class="drive-connection-status" id="drive-connection-status" role="status"></div><button type="button" class="btn btn-primary btn-sm" id="drive-connect-button" hidden>Conectar Google Drive</button><details id="drive-config-fields"><summary>Configurar conexão da agência</summary><form id="drive-config-form" class="drive-setup" style="margin-top:14px"><div class="fg"><label class="fl" for="drive-config-id">ID do aplicativo Google</label><input class="fi" id="drive-config-id" autocomplete="off" required></div><div class="fg"><label class="fl" for="drive-config-secret">Credencial privada</label><input class="fi" id="drive-config-secret" type="password" autocomplete="new-password" placeholder="Mantida somente na configuração privada"></div><div class="fg"><label class="fl" for="drive-config-root">Pasta CLIENTES no Google Drive</label><input class="fi" id="drive-config-root" type="url" required placeholder="https://drive.google.com/drive/folders/…"></div><button type="submit" class="btn btn-ghost btn-sm">Salvar conexão</button></form></details></div>`;
  $('agency-settings-card').after(card);
  $('drive-config-form').addEventListener('submit',async e=>{e.preventDefault();if(!isAdmin())return;const btn=e.submitter;btn.disabled=true;try{const url=new URL($('drive-config-root').value),root=url.hostname==='drive.google.com'&&url.pathname.match(/\/folders\/([\w-]+)$/)?.[1];if(!root)throw Error('Informe o link da pasta CLIENTES no Drive.');await api({action:'config_save',client_id:$('drive-config-id').value.trim(),client_secret:$('drive-config-secret').value.trim(),root});$('drive-config-secret').value='';await settings();}catch(error){$('drive-connection-status').textContent=error.message;}finally{btn.disabled=false;}});
  $('drive-connect-button').addEventListener('click',async()=>{if(!isAdmin())return;try{const{url}=await api({action:'oauth_start'});location.assign(url);}catch(error){$('drive-connection-status').textContent=error.message;}});
  section.addEventListener('focusin',e=>{if(e.target.id==='creative-drive-url')revealPicker();});
  section.addEventListener('click',e=>{if(e.target.id==='creative-drive-url')revealPicker();});
  document.addEventListener('click',e=>{if(pickerOpen&&!e.composedPath().some(node=>node.id==='creative-delivery-form'))collapsePicker();});
  section.addEventListener('input',e=>{if(e.target.id==='creative-drive-url'&&selection.size){selection.clear();drawPicker();syncSubmit();}});
  section.addEventListener('change',e=>{const id=e.target.dataset.pickerFile;if(!id)return;const file=picker?.files.find(f=>f.id===id);if(!file||file.already_delivered)return;if(e.target.checked){if(selection.size>=30){e.target.checked=false;status('Selecione até 30 criativos por entrega.',true);return;}selection.set(id,file.drive_url);$('creative-drive-url').value='';}else selection.delete(id);e.target.closest('label').classList.toggle('selected',e.target.checked);syncSubmit();});
  section.addEventListener('click',e=>{if(e.target.closest('[data-picker-refresh]'))loadPicker();else if(e.target.closest('[data-picker-more]')&&!picker.loading)loadPicker(true);});
  document.addEventListener('change',e=>{if(!['det-date','det-client-sel'].includes(e.target.id)||!currentDemandId)return;const wasOpen=pickerOpen;resetPicker();drawPicker();syncSubmit();syncDayAction();loadPicker(false,wasOpen);});
  section.addEventListener('submit',async e=>{
   if(e.target.id!=='creative-delivery-form')return;e.preventDefault();if(publishing)return;
   const d=DB.demands.find(d=>d.id===activeDemand);if(!d||!canManage(d))return;
   const id=activeDemand,version=epoch,urls=[...selection.values()],url=$('creative-drive-url').value.trim();if(!urls.length&&!url){status('Cole um link ou selecione os criativos da pasta.',true);return;}
   publishing=true;const controls=[...section.querySelectorAll('input,button')].map(c=>[c,c.disabled]);controls.forEach(([c])=>c.disabled=true);status('Conferindo os arquivos no Drive…');
   try{await flushDemandAutosaves(id);if($('det-save-state')?.classList.contains('error'))throw Error('Salve as alterações da demanda antes de entregar.');await api({action:'publish',demand:id,...(urls.length?{urls}:{url})});if(version!==epoch)return;await reloadDemandsForRole();if(version!==epoch||currentDemandId!==id||activeDemand!==id)return;resetPicker();publishing=false;const updated=DB.demands.find(x=>x.id===id);if(updated)$('det-badges').innerHTML=stBadge(updated.status)+prBadge(updated.priority);if($('creative-drive-url'))$('creative-drive-url').value='';await open(id);status(urls.length>1?'Criativos entregues. Os arquivos abrem no Google Drive.':'Criativo entregue. O arquivo abre no Google Drive.');}
   catch(error){if(version===epoch&&activeDemand===id)status(error.message,true);}finally{publishing=false;controls.forEach(([c,disabled])=>{if(c.isConnected)c.disabled=disabled;});}
  });
  section.addEventListener('click',async e=>{
   const remove=e.target.closest('[data-creative-remove]'),day=e.target.closest('[data-creative-action=day]');if(!remove&&!day)return;
   const d=DB.demands.find(d=>d.id===activeDemand);if(!d||!canManage(d))return;const id=activeDemand,version=epoch,button=remove||day;button.disabled=true;
   try{if(remove){if(!confirm('Remover esta entrega do card? O arquivo continuará no Drive.'))return;await api({action:'unlink',demand:id,delivery:remove.dataset.creativeRemove});if(version===epoch)await open(id);}else{status('Preparando a pasta da data de entrega…');await flushDemandAutosaves(id);if($('det-save-state')?.classList.contains('error'))throw Error('Salve a data de entrega antes de preparar a pasta.');const result=await api({action:'day_folder',demand:id});if(version===epoch&&activeDemand===id&&currentDemandId===id){dayLink=result;syncDayAction();status('Pasta de '+fDate(result.day)+' pronta. Envie os arquivos no Drive ou selecione os criativos disponíveis.');await loadPicker(false,false);}}}
   catch(error){if(version===epoch)status(error.message,true);}finally{if(button.isConnected)button.disabled=false;}
  });
  new MutationObserver(()=>{if($('pg-demands').classList.contains('active'))folder();}).observe($('pg-demands'),{attributes:true,attributeFilter:['class']});
  new MutationObserver(()=>{if($('pg-settings').classList.contains('active'))settings();}).observe($('pg-settings'),{attributes:true,attributeFilter:['class']});
  const url=new URL(location.href);if(url.searchParams.has('drive_connection')){const connected=url.searchParams.get('drive_connection')==='connected';url.searchParams.delete('drive_connection');history.replaceState(null,'',url.pathname+url.search+url.hash);let attempts=0;const showNotice=()=>{if(!DB.me&&attempts++<150){setTimeout(showNotice,400);return;}if(!DB.me)return;goTo('settings');selectSettingsTab('company');settings();toast(connected?'Google Drive conectado. As pastas serão preparadas automaticamente.':'Não foi possível concluir a conexão. Tente novamente.',connected?'ok':'err');};showNotice();}
 }
 window.MagemindCreatives={open,folder,settings,clear,closed};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
