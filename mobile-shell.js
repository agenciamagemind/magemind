(() => {
 'use strict';
 const mobile=()=>matchMedia('(max-width:900px)').matches;
 let viewportFrame=0,gesture=null,refreshing=false,resetTimer=0;
 function viewport(){
  viewportFrame=0;
  const visual=window.visualViewport;
  if(visual&&Math.abs(visual.scale-1)>.05)return;
  const installed=navigator.standalone===true||matchMedia('(display-mode:standalone), (display-mode:fullscreen)').matches;
  document.documentElement.classList.toggle('mobile-installed',installed);
  // Measure the explicit CSS shell, not iOS's inset-excluding fixed viewport.
  // Only use the smaller visual viewport while an editor has the keyboard open.
  const height=document.body.classList.contains('mobile-keyboard-open')?visual?.height||innerHeight:document.body.getBoundingClientRect().height||innerHeight;
  document.documentElement.style.setProperty('--app-viewport-height',Math.round(height)+'px');
 }
 function scheduleViewport(){if(!viewportFrame)viewportFrame=requestAnimationFrame(viewport);}
 function menuLinks(){
  const direct=(document.getElementById('mobile-bottom-nav')?.dataset.directPages||'').split(',');
  document.querySelectorAll('.sidebar .sb-item').forEach(button=>button.classList.toggle('mobile-direct-item',direct.includes(button.id.replace('nav-',''))));
  document.querySelectorAll('.sidebar .sb-group').forEach(group=>group.classList.toggle('mobile-group-empty',!group.querySelector('.sb-item:not(.mobile-direct-item)')));
 }
 function menuState(){
  const sidebar=document.querySelector('.sidebar');if(!sidebar)return;
  const open=mobile()&&sidebar.classList.contains('mobile-open');
  document.querySelector('#app .main')?.toggleAttribute('inert',open);
  document.getElementById('mobile-bottom-nav')?.toggleAttribute('inert',open);
  if(mobile()){sidebar.toggleAttribute('inert',!open);sidebar.setAttribute('aria-hidden',String(!open));sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-label','Mais opções');sidebar.setAttribute('aria-modal',String(open));}
  else{sidebar.removeAttribute('role');sidebar.removeAttribute('aria-label');sidebar.removeAttribute('aria-modal');}
  if(open){window.closeNotifPanel?.();resetPull();document.querySelector('.mobile-more-close')?.focus({preventScroll:true});}
 }
 const previousToggle=window.toggleMobileMenu;
 window.toggleMobileMenu=force=>{previousToggle?.(force);menuState();};
 const previousBuild=window.buildMobileNav;
 window.buildMobileNav=items=>{previousBuild?.(items);menuLinks();};
 function resetPull(){
  clearTimeout(resetTimer);gesture=null;
  const main=document.querySelector('#app .main');
  main?.classList.remove('mobile-pulling');
  main?.style.removeProperty('--mobile-pull-distance');
  const indicator=document.getElementById('mobile-pull-indicator');if(indicator){indicator.hidden=true;indicator.classList.remove('is-refreshing');}
 }
 function label(text){const el=document.getElementById('mobile-pull-label');if(el&&el.textContent!==text)el.textContent=text;}
 function blocked(target,main){
  const signedIn=typeof DB!=='undefined'&&Boolean(DB.me);
  if(!mobile()||!signedIn||refreshing||main.scrollTop>1||document.querySelector('.sidebar.mobile-open,.overlay.open,.install-guide.open,dialog[open]'))return true;
  if(target.closest('input,textarea,select,button,a,label,[contenteditable=true],[draggable=true],.k-card,.solution-carousel,.kanban-wrap,#notif-panel,[data-no-pull]'))return true;
  for(let el=target;el&&el!==main;el=el.parentElement){const style=getComputedStyle(el);if(/auto|scroll/.test(style.overflowY)&&el.scrollHeight>el.clientHeight+1&&el.scrollTop>0)return true;}
  return false;
 }
 function start(event){
  if(refreshing)return;
  if(event.touches.length!==1){resetPull();return;}
  const main=document.querySelector('#app .main'),target=event.target instanceof Element?event.target:null;
  if(!main||!target||!main.contains(target)||blocked(target,main))return;
  clearTimeout(resetTimer);gesture={x:event.touches[0].clientX,y:event.touches[0].clientY,distance:0,main};
 }
 function move(event){
  if(!gesture)return;
  if(event.touches.length!==1||gesture.main.scrollTop>1){resetPull();return;}
  const dx=event.touches[0].clientX-gesture.x,dy=event.touches[0].clientY-gesture.y;
  if(dy<0||Math.abs(dx)>Math.max(12,Math.abs(dy)*.85)){resetPull();return;}
  if(dy<10)return;
  if(event.cancelable)event.preventDefault();
  gesture.distance=Math.min(96,dy*.48);gesture.main.classList.add('mobile-pulling');gesture.main.style.setProperty('--mobile-pull-distance',gesture.distance+'px');
  document.getElementById('mobile-pull-indicator').hidden=false;label(gesture.distance>=64?'Solte para atualizar':'Puxe para atualizar');
 }
 async function end(){
  if(refreshing)return;
  if(!gesture||gesture.distance<64){resetPull();return;}
  const main=gesture.main;gesture=null;refreshing=true;main.classList.remove('mobile-pulling');main.style.setProperty('--mobile-pull-distance','52px');main.setAttribute('aria-busy','true');
  const indicator=document.getElementById('mobile-pull-indicator');indicator.classList.add('is-refreshing');label('Atualizando…');
  try{
   if(navigator.onLine===false)throw new Error('offline');
   if(!await window.refreshAppData())return;
   label('Atualizado');
  }catch{label('Não foi possível atualizar');window.toast?.('Não foi possível atualizar. Tente novamente.','err');}
  finally{refreshing=false;main.removeAttribute('aria-busy');indicator.classList.remove('is-refreshing');resetTimer=setTimeout(resetPull,650);}
 }
 function init(){
  viewport();const sidebar=document.querySelector('.sidebar'),nav=document.getElementById('sb-nav'),main=document.querySelector('#app .main');if(!sidebar||!nav||!main)return;
  const header=document.createElement('div');header.className='mobile-more-head';header.innerHTML='<div><h2>Mais</h2><p>As outras áreas da sua conta</p></div><button type="button" class="mobile-more-close" aria-label="Fechar mais opções"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';header.querySelector('button').addEventListener('click',()=>window.closeMobileMenu());sidebar.insertBefore(header,nav);
  const indicator=document.createElement('div');indicator.id='mobile-pull-indicator';indicator.className='mobile-pull-indicator';indicator.hidden=true;indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');indicator.innerHTML='<span class="mobile-pull-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 8a7 7 0 0 1 11.5-2L20 9M4 15l2.9 3A7 7 0 0 0 18.4 16"/></svg></span><span id="mobile-pull-label">Puxe para atualizar</span>';main.insertBefore(indicator,main.querySelector('.content'));
  main.addEventListener('touchstart',start,{passive:true});main.addEventListener('touchmove',move,{passive:false});main.addEventListener('touchend',end,{passive:true});main.addEventListener('touchcancel',()=>{if(!refreshing)resetPull();},{passive:true});
  main.addEventListener('scroll',()=>{if(gesture&&main.scrollTop>1)resetPull();},{passive:true});
  new MutationObserver(menuLinks).observe(nav,{childList:true});menuLinks();menuState();
 }
 addEventListener('resize',()=>{scheduleViewport();menuState();if(!refreshing)resetPull();},{passive:true});
 window.visualViewport?.addEventListener('resize',scheduleViewport,{passive:true});
 addEventListener('pageshow',scheduleViewport);document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleViewport();});
 document.addEventListener('focusin',scheduleViewport);document.addEventListener('focusout',scheduleViewport);
 addEventListener('orientationchange',()=>{scheduleViewport();setTimeout(scheduleViewport,250);},{passive:true});
 document.addEventListener('magemind:tracking-signed-out',()=>{if(!refreshing)resetPull();});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
