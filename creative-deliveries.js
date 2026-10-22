(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=value=>escapeHTML(value||'');
 const driveIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-7 12 4 6h12l4-6-7-12H9Zm0 0 9 18M15 3 6 21M2 15h20"/></svg>';
 let epoch=0,folderFlight=null,folderTimer,settingsFlight=null,section,activeDemand=null,loading=0,publishing=false;
 async function api(body){
  const{data,error}=await supa.functions.invoke('drive-deliveries',{body});
  if(error){let message;try{message=(await error.context?.json())?.error;}catch{}throw Error(message||'Não foi possível acessar o Drive. Tente novamente.');}
  if(data?.error)throw Error(data.error);return data;
 }
 function clear(){epoch++;loading++;activeDemand=null;publishing=false;folderFlight=null;settingsFlight=null;clearTimeout(folderTimer);if(section){section.hidden=true;section.replaceChildren();}const link=$('my-creatives-link');if(link){link.hidden=true;link.removeAttribute('href');}$('drive-config-secret')&&($('drive-config-secret').value='');$('drive-settings-card')?.setAttribute('hidden','');}
 function status(text,error=false){const el=$('creative-delivery-status');if(el){el.textContent=text;el.classList.toggle('is-error',error);}}
 function canManage(d){return isOperationalStaff()&&canViewDemand(d);}
 function render(data,id){
  if(activeDemand!==id||currentDemandId!==id)return;
  const d=DB.demands.find(d=>d.id===id);if(!d||!canViewDemand(d))return;
  const items=data.deliveries||[],manage=data.can_manage===true&&canManage(d);
  section.hidden=!manage&&!items.length;
  section.innerHTML=`<div class="detail-section-head"><div class="detail-section-title"><span aria-hidden="true">↗</span> Criativos entregues${items.length?` <small>· ${items.length}</small>`:''}</div><div class="creative-heading-actions">${manage?'<button type="button" class="btn btn-ghost btn-xs" data-creative-action="day">Pasta de hoje ↗</button>':''}${data.folder?.folder_url?`<a class="btn btn-ghost btn-xs" href="${esc(data.folder.folder_url)}" target="_blank" rel="noopener noreferrer">${manage?'Pasta do cliente':'Meus criativos'} ↗</a>`:''}</div></div>
   ${manage?`<form class="creative-publish" id="creative-delivery-form"><p>Envie o criativo para a pasta do cliente no Drive e cole o link abaixo. A entrega ficará disponível aqui e a demanda será concluída.</p><label class="sr-only" for="creative-drive-url">Link do criativo no Google Drive</label><div class="creative-link-row"><input class="fi" id="creative-drive-url" type="url" inputmode="url" autocomplete="off" placeholder="Cole o link do arquivo no Drive" required maxlength="2048"><button class="btn btn-primary btn-sm" type="submit">Entregar${d.status==='Concluído'?'':' e concluir'}</button></div></form>`:''}
   <p class="creative-delivery-status" id="creative-delivery-status" role="status"></p>
   <div class="creative-delivery-list">${items.map(item=>`<article class="creative-delivery-item"><a class="creative-preview" href="${esc(item.drive_url)}" target="_blank" rel="noopener noreferrer" aria-label="${item.mime_type.startsWith('video/')?'Reproduzir':'Abrir'} ${esc(item.name)} no Google Drive"><span class="creative-fallback">${driveIcon}<span>Abrir no Google Drive</span></span>${item.preview_url?`<img src="${esc(item.preview_url)}" alt="Prévia de ${esc(item.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" hidden>`:''}${item.mime_type.startsWith('video/')?'<span class="creative-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m7 4 14 8-14 8V4Z"/></svg></span>':''}</a><div class="creative-delivery-caption"><div><a href="${esc(item.drive_url)}" target="_blank" rel="noopener noreferrer">${esc(item.name)} ↗</a><small>${esc(fDate(item.delivered_on))} · ${item.mime_type.startsWith('video/')?'Vídeo':item.mime_type==='application/pdf'?'PDF':'Imagem'}</small></div>${manage?`<button type="button" class="creative-unlink" data-creative-remove="${esc(item.id)}" aria-label="Remover entrega do card" title="Remove o link do card; o arquivo continua no Drive">×</button>`:''}</div></article>`).join('')||'<p class="creative-empty">As prévias dos criativos entregues aparecerão aqui.</p>'}</div>`;
  for(const image of section.querySelectorAll('.creative-preview img')){
   image.addEventListener('load',()=>{image.hidden=false;image.previousElementSibling.hidden=true;});
   image.addEventListener('error',()=>{image.remove();});
  }
 }
 async function open(id){
  activeDemand=id;const version=epoch,request=++loading,d=DB.demands.find(d=>d.id===id);
  if(!d||!canViewDemand(d)){section.hidden=true;return;}
  render({deliveries:[],can_manage:canManage(d)},id);status('Carregando entregas…');
  try{const data=await api({action:'context',demand:id});if(version!==epoch||request!==loading)return;render(data,id);}
  catch(error){if(version===epoch&&request===loading)status(error.message,true);}
 }
 async function folder(){
  const link=$('my-creatives-link');clearTimeout(folderTimer);if(!DB.me||!isClient()){link.hidden=true;return;}
  if(folderFlight)return folderFlight;
  const version=epoch;folderFlight=(async()=>{
   try{const data=await api({action:'my_folder'});if(version!==epoch||!isClient())return;
    link.hidden=false;if(data.state==='ready'&&data.folder_url){link.href=data.folder_url;link.innerHTML=driveIcon+'Meus criativos ↗';link.removeAttribute('aria-disabled');}
    else{link.removeAttribute('href');link.innerHTML=driveIcon+'Preparando meus criativos';link.setAttribute('aria-disabled','true');if($('pg-demands').classList.contains('active'))folderTimer=setTimeout(folder,15000);}
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
  const link=document.createElement('a');link.id='my-creatives-link';link.className='btn btn-ghost btn-sm my-creatives-link';link.hidden=true;link.target='_blank';link.rel='noopener noreferrer';$('pg-demands').querySelector('.ph-actions').prepend(link);
  const card=document.createElement('div');card.id='drive-settings-card';card.className='settings-card';card.hidden=true;
  card.innerHTML=`<div class="settings-card-title">Google Drive · Entregas de criativos</div><div class="drive-setup"><p>Uma pasta para cada cliente, com as entregas organizadas por dia. Os arquivos permanecem no Drive.</p><div class="drive-connection-status" id="drive-connection-status" role="status"></div><button type="button" class="btn btn-primary btn-sm" id="drive-connect-button" hidden>Conectar Google Drive</button><details id="drive-config-fields"><summary>Configurar conexão da agência</summary><form id="drive-config-form" class="drive-setup" style="margin-top:14px"><div class="fg"><label class="fl" for="drive-config-id">ID do aplicativo Google</label><input class="fi" id="drive-config-id" autocomplete="off" required></div><div class="fg"><label class="fl" for="drive-config-secret">Credencial privada</label><input class="fi" id="drive-config-secret" type="password" autocomplete="new-password" placeholder="Mantida somente na configuração privada"></div><div class="fg"><label class="fl" for="drive-config-root">Pasta CLIENTES no Google Drive</label><input class="fi" id="drive-config-root" type="url" required placeholder="https://drive.google.com/drive/folders/…"></div><button type="submit" class="btn btn-ghost btn-sm">Salvar conexão</button></form></details></div>`;
  $('agency-settings-card').after(card);
  $('drive-config-form').addEventListener('submit',async e=>{e.preventDefault();if(!isAdmin())return;const btn=e.submitter;btn.disabled=true;try{const url=new URL($('drive-config-root').value),root=url.hostname==='drive.google.com'&&url.pathname.match(/\/folders\/([\w-]+)$/)?.[1];if(!root)throw Error('Informe o link da pasta CLIENTES no Drive.');await api({action:'config_save',client_id:$('drive-config-id').value.trim(),client_secret:$('drive-config-secret').value.trim(),root});$('drive-config-secret').value='';await settings();}catch(error){$('drive-connection-status').textContent=error.message;}finally{btn.disabled=false;}});
  $('drive-connect-button').addEventListener('click',async()=>{if(!isAdmin())return;try{const{url}=await api({action:'oauth_start'});location.assign(url);}catch(error){$('drive-connection-status').textContent=error.message;}});
  section.addEventListener('submit',async e=>{
   if(e.target.id!=='creative-delivery-form')return;e.preventDefault();if(publishing)return;
   const d=DB.demands.find(d=>d.id===activeDemand);if(!d||!canManage(d))return;
   const id=activeDemand,version=epoch,btn=e.submitter;publishing=true;btn.disabled=true;status('Conferindo o arquivo no Drive…');
   try{await api({action:'publish',demand:id,url:$('creative-drive-url').value.trim()});if(version!==epoch)return;await reloadDemandsForRole();if(version!==epoch||currentDemandId!==id||activeDemand!==id)return;const updated=DB.demands.find(x=>x.id===id);if(updated)$('det-badges').innerHTML=stBadge(updated.status)+prBadge(updated.priority);await open(id);status('Criativo entregue. O arquivo abre no Google Drive.');}
   catch(error){if(version===epoch)status(error.message,true);}finally{publishing=false;if(btn.isConnected)btn.disabled=false;}
  });
  section.addEventListener('click',async e=>{
   const remove=e.target.closest('[data-creative-remove]'),day=e.target.closest('[data-creative-action=day]');if(!remove&&!day)return;
   const d=DB.demands.find(d=>d.id===activeDemand);if(!d||!canManage(d))return;const id=activeDemand,version=epoch,button=remove||day;button.disabled=true;
   try{if(remove){if(!confirm('Remover esta entrega do card? O arquivo continuará no Drive.'))return;await api({action:'unlink',demand:id,delivery:remove.dataset.creativeRemove});if(version===epoch)await open(id);}else{status('Preparando a pasta de hoje…');const result=await api({action:'day_folder',demand:id});if(version===epoch){status('Pasta de hoje pronta. Envie o arquivo no Drive e cole o link aqui.');const anchor=document.createElement('a');anchor.className='btn btn-ghost btn-xs';anchor.href=result.url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent='Abrir pasta de hoje ↗';button.replaceWith(anchor);}}}
   catch(error){if(version===epoch)status(error.message,true);}finally{if(button.isConnected)button.disabled=false;}
  });
  new MutationObserver(()=>{if($('pg-demands').classList.contains('active'))folder();}).observe($('pg-demands'),{attributes:true,attributeFilter:['class']});
  new MutationObserver(()=>{if($('pg-settings').classList.contains('active'))settings();}).observe($('pg-settings'),{attributes:true,attributeFilter:['class']});
  const url=new URL(location.href);if(url.searchParams.has('drive_connection')){const connected=url.searchParams.get('drive_connection')==='connected';url.searchParams.delete('drive_connection');history.replaceState(null,'',url.pathname+url.search+url.hash);setTimeout(()=>{if(DB.me){goTo('settings');toast(connected?'Google Drive conectado. As pastas serão preparadas automaticamente.':'Não foi possível concluir a conexão. Tente novamente.',connected?'ok':'err');}},1200);}
 }
 window.MagemindCreatives={open,folder,settings,clear};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
