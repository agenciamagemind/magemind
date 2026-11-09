/* The existing Oráculo workspace shares the app's verified session, never its credentials. */
(() => {
  'use strict';
  const origin='https://oraculo-magemind.oraculo-magemind.workers.dev';
  let frame=null, timer=0, generation=0;
  const allowed=()=>typeof DB!=='undefined' && DB.me && ['ceo','manager'].includes(DB.me.role) && DB.me.active!==false && !DB.me.archivedAt;
  const active=()=>document.getElementById('pg-oraculo')?.classList.contains('active');
  function status(message,retry=false){
    const box=document.getElementById('oraculo-status');
    box.hidden=false;box.querySelector('p').textContent=message;
    box.querySelector('button').hidden=!retry;
  }
  function clear(){
    generation++;clearTimeout(timer);frame?.remove();frame=null;
    document.body.classList.remove('oraculo-open','oraculo-keyboard-open');
    status('Abrindo seu atendimento…');
  }
  async function reply(requestId){
    const current=frame, version=generation;
    if(!current||!allowed()||!active())return;
    try{
      const {data,error}=await supa.auth.getSession();
      if(current!==frame||version!==generation||!active()||!allowed())return;
      if(error||!data?.session?.access_token){clear();status('Sua sessão terminou. Entre novamente no aplicativo.');return;}
      current.contentWindow.postMessage({type:'magemind:oraculo-session',requestId,accessToken:data.session.access_token},origin);
    }catch{if(current===frame)status('Não foi possível validar sua sessão. Tente novamente.',true);}
  }
  function route(){
    const opened=Boolean(allowed()&&active());
    document.body.classList.toggle('oraculo-open',opened);
    frame?.contentWindow.postMessage({type:'magemind:oraculo-visibility',active:opened},origin);
    if(!opened){document.body.classList.remove('oraculo-keyboard-open');if(!allowed())clear();return;}
    if(frame)return;
    status('Abrindo seu atendimento…');
    frame=document.createElement('iframe');
    frame.id='oraculo-frame';frame.title='Oráculo · atendimento da Magemind';
    frame.src=origin+'/embedded';frame.referrerPolicy='no-referrer';
    frame.setAttribute('allow','clipboard-write');
    frame.addEventListener('load',()=>frame?.contentWindow.postMessage({type:'magemind:oraculo-visibility',active:Boolean(active()&&allowed())},origin));
    document.getElementById('oraculo-workspace').append(frame);
    timer=setTimeout(()=>{if(frame)status('O atendimento está demorando para conectar. Verifique sua conexão e tente novamente.',true);},25000);
  }
  addEventListener('message',event=>{
    if(event.origin!==origin||event.source!==frame?.contentWindow||!allowed())return;
    const data=event.data;
    if(!data||typeof data!=='object')return;
    if(data.type==='oraculo:session-request'&&active())reply(data.requestId);
    if(data.type==='oraculo:ready'){clearTimeout(timer);document.getElementById('oraculo-status').hidden=true;}
    if(data.type==='oraculo:denied'){clear();status('Seu perfil não tem acesso ao Oráculo. Apenas CEO e gerentes ativos podem entrar.');}
    if(data.type==='oraculo:keyboard')document.body.classList.toggle('oraculo-keyboard-open',active()&&data.open===true);
  });
  function init(){
    document.getElementById('oraculo-retry').addEventListener('click',()=>{clear();route();});
    new MutationObserver(()=>{if(!allowed())clear();}).observe(document.getElementById('sb-nav'),{childList:true,subtree:true});
    document.addEventListener('magemind:session-ready',route);
    supa.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')clear();});
    const viewport=()=>document.documentElement.style.setProperty('--oraculo-viewport-height',Math.round(window.visualViewport?.height||innerHeight)+'px');
    viewport();window.visualViewport?.addEventListener('resize',viewport);addEventListener('resize',viewport);
  }
  window.MagemindOraculo={route,clear};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
