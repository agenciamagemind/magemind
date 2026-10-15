(() => {
 'use strict';
 const desktop=matchMedia('(min-width:901px)'),key='mm_sidebar_pinned_v1';
 let pinned=false,hovered=false,keyboardFocus=false,leaveTimer=0;
 try{pinned=localStorage.getItem(key)==='true';}catch{}
 function init(){
  const app=document.getElementById('app'),sidebar=app?.querySelector('.sidebar'),pin=document.getElementById('sidebar-pin');
  if(!sidebar||!pin)return;
  const main=app.querySelector('.main'),nav=sidebar.querySelector('.sb-nav');
  sidebar.setAttribute('aria-label','Navegação principal');
  // Fit the actual role's links into the available height, with a readable
  // minimum for very short windows or large browser zoom. Mobile has its own layout.
  let fitFrame=0;
  function fitNavigation(){
   fitFrame=0;if(!desktop.matches||!nav.clientHeight)return;
   const groups=[...nav.querySelectorAll('.sb-group')],count=nav.querySelectorAll('.sb-item').length;
   if(!count)return;
   const groupCount=groups.length,gaps=count-groupCount;
   const regularSpace=16+groupCount*22+Math.max(0,groupCount-1)*8+gaps*2;
   const compact=(nav.clientHeight-regularSpace)/count<34;
   const fixedSpace=compact?10+groupCount*18+Math.max(0,groupCount-1)*6+gaps:regularSpace;
   const itemHeight=Math.max(28,Math.min(44,Math.floor((nav.clientHeight-fixedSpace)/count)));
   nav.dataset.density=compact?'compact':'comfortable';
   nav.style.setProperty('--sidebar-item-height',itemHeight+'px');
  }
  function scheduleFit(){if(!fitFrame)fitFrame=requestAnimationFrame(fitNavigation);}
  new ResizeObserver(scheduleFit).observe(nav);
  new MutationObserver(scheduleFit).observe(nav,{childList:true,subtree:true});
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
  desktop.addEventListener('change',()=>{clearLeave();hovered=false;keyboardFocus=false;sync();scheduleFit();});
  addEventListener('storage',event=>{if(event.key===key){pinned=event.newValue==='true';sync();}});
  sync();scheduleFit();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
