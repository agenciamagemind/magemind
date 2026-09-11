(function(){
  'use strict';
  const selector='.overlay,.install-guide';
  const stack=[];
  const restore=new Map();
  const background=new Map();
  let lastActivator=null;
  document.addEventListener('click',event=>{const el=event.target.closest('button,a,[role="button"]');if(el)lastActivator=el;},true);
  const focusable='button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"],[contenteditable="true"]';
  const visible=el=>el.getClientRects().length&&!el.closest('[inert]')&&getComputedStyle(el).visibility!=='hidden';
  const surface=()=>stack.at(-1)||(matchMedia('(max-width:900px)').matches?document.querySelector('.sidebar.mobile-open'):null);
  function annotate(root){
    if(!(root instanceof Element))return;
    const all=selector=>[...(root.matches(selector)?[root]:[]),...root.querySelectorAll(selector)];
    all('label.fl').forEach(label=>{
      if(label.htmlFor)return;
      const field=label.parentElement.querySelector('input[id],select[id],textarea[id]');
      if(field)label.htmlFor=field.id;
    });
    all('input[id],select[id],textarea[id]').forEach(field=>{
      if(field.labels?.length||field.hasAttribute('aria-label')||field.hasAttribute('aria-labelledby'))return;
      const labels={'det-title':'Título da demanda','det-date':'Data de entrega','det-priority':'Prioridade','det-client-sel':'Cliente','det-assignee-sel':'Responsável','new-comment':'Novo comentário'};
      const label=labels[field.id]||field.closest('.dd-section,.fg')?.querySelector('.dd-label,.fl')?.textContent||field.getAttribute('placeholder');
      if(label)field.setAttribute('aria-label',label.trim());
    });
    all('button,.m-close').forEach(button=>{
      if(button.hasAttribute('aria-label'))return;
      const text=button.textContent.trim();
      if(button.classList.contains('m-close'))button.setAttribute('aria-label','Fechar diálogo');
      else if(text==='✎')button.setAttribute('aria-label','Editar registro');
      else if(text==='✕')button.setAttribute('aria-label','Excluir registro');
      else if(!text&&button.title)button.setAttribute('aria-label',button.title);
    });
    all('div[onclick],span[onclick],tr[onclick]').forEach(el=>{
      if(el.matches('.overlay,.install-guide,.mobile-sidebar-backdrop')||el.querySelector('button,a,input,select,textarea'))return;
      el.setAttribute('role','button');el.tabIndex=0;
    });
  }
  window.syncAccessibleDialogs=function(){
    const dialogs=[...document.querySelectorAll(selector)];
    const opened=dialogs.filter(d=>d.classList.contains('open'));
    let returnTo=null;
    for(let i=stack.length-1;i>=0;i--)if(!opened.includes(stack[i])){
      returnTo=restore.get(stack[i]);restore.delete(stack[i]);stack.splice(i,1);
    }
    let added=false;
    opened.forEach(d=>{if(!stack.includes(d)){restore.set(d,document.activeElement===document.body?lastActivator:document.activeElement);stack.push(d);added=true;}});
    const top=stack.at(-1);
    dialogs.forEach(d=>{
      const active=d===top;
      d.toggleAttribute('inert',!active);d.setAttribute('aria-hidden',String(!active));d.setAttribute('role','dialog');
      d.setAttribute('aria-modal',String(active));d.tabIndex=-1;
      const heading=d.querySelector('.m-title,.install-title,.avatar-onboarding-title');
      if(heading){
        if(heading.matches('input'))d.setAttribute('aria-label',heading.value||'Detalhes da demanda');
        else{if(!heading.id)heading.id=d.id+'-accessible-title';d.setAttribute('aria-labelledby',heading.id);}
      }
      if(active)d.style.zIndex=String(800+stack.length);
      else d.style.removeProperty('z-index');
    });
    [...document.body.children].forEach(el=>{
      if(el.matches(selector+',script,link,style'))return;
      if(top){if(!background.has(el))background.set(el,{inert:el.hasAttribute('inert'),aria:el.getAttribute('aria-hidden')});el.setAttribute('inert','');el.setAttribute('aria-hidden','true');}
      else if(background.has(el)){const previous=background.get(el);el.toggleAttribute('inert',previous.inert);if(previous.aria===null)el.removeAttribute('aria-hidden');else el.setAttribute('aria-hidden',previous.aria);background.delete(el);}
    });
    if(top&&(added||!top.contains(document.activeElement))){
      const target=[...top.querySelectorAll(focusable)].find(visible)||top;target.focus({preventScroll:true});
    }else if(returnTo?.isConnected&&visible(returnTo))returnTo.focus({preventScroll:true});
  };
  document.addEventListener('keydown',event=>{
    const top=surface();
    if(top&&event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();
      if(top.classList.contains('sidebar'))window.closeMobileMenu();
      else if(top.id==='install-guide')window.closeInstallGuide(true);
      else if(top.id==='push-onboarding')window.dismissPushOnboarding();
      else if(top.id==='avatar-onboarding')window.dismissAvatarOnboarding();
      else closeModal(top.id);
      window.syncAccessibleDialogs();return;
    }
    if(top&&event.key==='Tab'){
      const items=[...top.querySelectorAll(focusable)].filter(visible);const first=items[0],last=items.at(-1);
      if(!first){event.preventDefault();top.focus();}
      else if(event.shiftKey&&(document.activeElement===first||!items.includes(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!items.includes(document.activeElement))){event.preventDefault();first.focus();}
    }
    const target=event.target.closest('[role="button"]');
    if((event.key==='Enter'||event.key===' ')&&target&&!target.matches('button,a,input,select,textarea')&&event.target===target){event.preventDefault();target.click();}
  },true);
  document.addEventListener('focusin',event=>{
    const top=surface();if(top&&!top.contains(event.target))([ ...top.querySelectorAll(focusable)].find(visible)||top).focus();
  });
  function init(){
    annotate(document.body);
    document.querySelectorAll(selector).forEach(d=>new MutationObserver(window.syncAccessibleDialogs).observe(d,{attributes:true,attributeFilter:['class']}));
    new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(annotate))).observe(document.body,{childList:true,subtree:true});
    const sidebar=document.querySelector('.sidebar');let menuWasOpen=false;
    const syncMenu=()=>{
      const mobile=matchMedia('(max-width:900px)').matches;const open=sidebar.classList.contains('mobile-open');
      sidebar.toggleAttribute('inert',mobile&&!open);sidebar.setAttribute('aria-hidden',String(mobile&&!open));
      document.getElementById('mobile-more-tab')?.setAttribute('aria-expanded',String(mobile&&open));
      if(mobile&&open&&!menuWasOpen&&!stack.length)sidebar.querySelector('button,a')?.focus();
      if(menuWasOpen&&!open&&!stack.length)document.getElementById('mobile-more-tab')?.focus();
      menuWasOpen=mobile&&open;
    };
    new MutationObserver(syncMenu).observe(sidebar,{attributes:true,attributeFilter:['class']});
    window.addEventListener('resize',syncMenu);syncMenu();
    window.syncAccessibleDialogs();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
