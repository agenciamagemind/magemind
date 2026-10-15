(() => {
 'use strict';
 const desktop=matchMedia('(min-width:901px)'),key='mm_sidebar_pinned_v1';
 let pinned=false,hovered=false,keyboardFocus=false,leaveTimer=0;
 try{pinned=localStorage.getItem(key)==='true';}catch{}
 function init(){
  const app=document.getElementById('app'),sidebar=app?.querySelector('.sidebar'),pin=document.getElementById('sidebar-pin');
  if(!sidebar||!pin)return;
  const main=app.querySelector('.main');
  sidebar.setAttribute('aria-label','Navegação principal');
  function sync(){
   app.classList.toggle('sidebar-pinned',desktop.matches&&pinned);
   app.classList.toggle('sidebar-expanded',desktop.matches&&(pinned||hovered||keyboardFocus));
   pin.setAttribute('aria-checked',String(pinned));
   pin.title=pinned?'Desafixar barra lateral':'Manter barra lateral aberta';
  }
  function clearLeave(){clearTimeout(leaveTimer);leaveTimer=0;}
  sidebar.addEventListener('pointerenter',()=>{clearLeave();hovered=true;sync();});
  sidebar.addEventListener('pointerleave',()=>{clearLeave();leaveTimer=setTimeout(()=>{hovered=false;sync();},120);});
  sidebar.addEventListener('pointerdown',()=>{keyboardFocus=false;sync();});
  sidebar.addEventListener('focusin',event=>{keyboardFocus=event.target.matches(':focus-visible');if(keyboardFocus)clearLeave();sync();});
  sidebar.addEventListener('focusout',event=>{if(!sidebar.contains(event.relatedTarget)){keyboardFocus=false;sync();}});
  sidebar.addEventListener('keydown',event=>{
   if(!desktop.matches)return;
   if(event.key==='Tab'){keyboardFocus=true;sync();}
   if(event.key==='Escape'&&!pinned){
    clearLeave();hovered=false;keyboardFocus=false;
    main.setAttribute('tabindex','-1');main.focus({preventScroll:true});sync();event.preventDefault();
   }
  });
  pin.addEventListener('click',()=>{
   pinned=!pinned;
   try{localStorage.setItem(key,String(pinned));}catch{}
   sync();
  });
  document.addEventListener('pointerdown',event=>{if(!sidebar.contains(event.target)){clearLeave();hovered=false;keyboardFocus=false;sync();}},{passive:true});
  addEventListener('blur',()=>{clearLeave();hovered=false;keyboardFocus=false;sync();});
  desktop.addEventListener('change',()=>{clearLeave();hovered=false;keyboardFocus=false;sync();});
  addEventListener('storage',event=>{if(event.key===key){pinned=event.newValue==='true';sync();}});
  sync();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
