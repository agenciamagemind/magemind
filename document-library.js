(() => {
 'use strict';
 const $=id=>document.getElementById(id);let busy=false;
 function selected(){
  const file=$('doc-file').files?.[0];
  $('doc-picker-title').textContent=file?file.name:editDocId?'Selecionar outro arquivo':'Selecionar arquivo';
  const size=file&&(file.size<1024?`${file.size} bytes`:`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(file.size/1024)} KB`);
  $('doc-picker-sub').textContent=file?`${size} · Clique para trocar`:editDocId?'Mantenha o atual ou escolha uma nova versão.':'PDF, imagens e documentos do Office';
  $('doc-upload-error').hidden=true;
 }
 function reset(){selected();$('doc-upload-error').textContent='';}
 function showError(message){const el=$('doc-upload-error');el.textContent=message;el.hidden=false;el.scrollIntoView({block:'nearest',behavior:'smooth'});}
 async function request(body){
  const{data,error}=await supa.functions.invoke('document-files',{body});
  if(error){let response;try{response=await error.context?.json();}catch{}throw new Error(response?.error||'Não foi possível concluir. Confira sua conexão e tente novamente.');}
  if(data?.error)throw new Error(data.error);
  return data;
 }
 async function save(fields,file){
  if(busy)return null;busy=true;
  const controls=[...$('modal-doc').querySelectorAll('input,select,button')].map(el=>[el,el.disabled]);
  controls.forEach(([el])=>el.disabled=true);const label=$('doc-save-label');label.textContent=file?'Enviando…':'Salvando…';$('modal-doc').setAttribute('aria-busy','true');
  try{
   const body=new FormData();body.set('action','save');for(const[key,value]of Object.entries(fields))if(value!==null&&value!==undefined)body.set(key,String(value));if(file)body.set('file',file);
   const result=await request(body);if(!result?.document)throw new Error('Não foi possível confirmar o envio. Atualize a biblioteca antes de tentar novamente.');return result.document;
  }catch(error){showError(error.message);return null;}
  finally{busy=false;controls.forEach(([el,disabled])=>el.disabled=disabled);label.textContent=editDocId?'Salvar alterações':'Fazer upload';$('modal-doc').removeAttribute('aria-busy');}
 }
 async function remove(id){return request({action:'delete',id});}
 function init(){$('doc-file')?.addEventListener('change',selected);}
 window.MagemindDocuments={reset,save,remove,showError,get busy(){return busy;}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
