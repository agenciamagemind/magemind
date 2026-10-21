/* The first valid referral is remembered only in this browser, for 30 days. */
(() => {
 const key='mm_referral_touch_v1',valid=code=>/^[0-9a-f]{32}$/.test(code||'');
 let task=Promise.resolve(),failure=false,ignore=false,candidate='',volatile=null;
 const read=()=>{try{const value=JSON.parse(localStorage.getItem(key));if(valid(value?.code)&&Number(value.expires)>Date.now())return value;localStorage.removeItem(key);}catch{}return volatile&&volatile.expires>Date.now()?volatile:null;};
 const remove=()=>{volatile=null;try{localStorage.removeItem(key);}catch{}};
 const remember=code=>{volatile={code,expires:Date.now()+30*86400000};try{localStorage.setItem(key,JSON.stringify(volatile));}catch{}};
 const validate=async code=>(await secureAuthRequest('referral_link',{code})).valid===true;
 function banner(text,actions=false){const form=document.getElementById('auth-reg');if(!form)return;let box=document.getElementById('rf-auth-referral');if(!box){box=document.createElement('div');box.id='rf-auth-referral';box.className='rf-auth-referral';box.setAttribute('role','status');form.prepend(box);}box.textContent=text;
  if(actions){for(const [label,action] of [['Tentar novamente','retry'],['Continuar sem indicação','ignore']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.rfCapture=action;box.append(b);}}
 }
 async function capture(){failure=false;const stored=read();if(!stored&&!candidate)return;
  try{
   if(stored&&await validate(stored.code)){banner('Você está se cadastrando por uma indicação. O vínculo será confirmado ao criar sua conta.');return;}
   if(stored)remove();
   if(valid(candidate)&&await validate(candidate)){
    // A valid touch saved by another tab takes precedence over this visit.
    if(!read())remember(candidate);
    banner('Você está se cadastrando por uma indicação. O vínculo será confirmado ao criar sua conta.');
   }else banner('Este link de indicação está inativo ou é inválido. Você pode criar sua conta normalmente.');
  }catch{failure=true;banner('Não foi possível verificar a indicação. Tente novamente ou escolha continuar sem o vínculo.',true);}
 }
 async function signupCode(){await task;if(ignore)return undefined;if(failure)throw new Error('Não foi possível verificar a indicação. No aviso do cadastro, tente novamente ou escolha continuar sem indicação.');return read()?.code;}
 function finishSignup(result){remove();candidate='';ignore=false;failure=false;document.getElementById('rf-auth-referral')?.remove();
  if(['unavailable','self_referral','verification_pending'].includes(result?.status))toast(result.status==='verification_pending'?'Conta criada. A confirmação do vínculo da indicação está pendente.':'Conta criada. O vínculo de indicação não foi aplicado; o link precisa estar ativo e não pode ser uma autoindicação.','ok');
 }
 document.addEventListener('click',event=>{const action=event.target.closest('[data-rf-capture]')?.dataset.rfCapture;if(action==='retry'){ignore=false;task=capture();}if(action==='ignore'){ignore=true;remove();banner('Você optou por criar sua conta sem vínculo de indicação.');}});
 document.addEventListener('magemind:session-ready',()=>{remove();candidate='';document.getElementById('rf-auth-referral')?.remove();});
 const init=()=>{const value=new URL(location.href).searchParams.get('ref');candidate=String(value||'').trim().toLowerCase();if(valid(candidate)&&typeof authTab==='function')authTab('reg');if(value&&!valid(candidate))banner('Este link de indicação é inválido. Você pode criar sua conta normalmente.');else task=capture();};
 window.MagemindReferralCapture={signupCode,finishSignup};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
