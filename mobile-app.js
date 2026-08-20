(function(){
  'use strict';
  const DISMISS_KEY='mm_install_prompt_dismissed_at';
  const DISMISS_DAYS=14;
  let deferredInstallPrompt=null;

  function isMobile(){ return window.matchMedia('(max-width: 900px)').matches; }
  function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true; }
  function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1); }
  function recentlyDismissed(){
    try{
      const stamp=Number(localStorage.getItem(DISMISS_KEY)||0);
      return stamp && Date.now()-stamp < DISMISS_DAYS*86400000;
    }catch(_){ return false; }
  }

  window.toggleMobileMenu=function(force){
    const sidebar=document.querySelector('.sidebar');
    const backdrop=document.getElementById('mobile-sidebar-backdrop');
    if(!sidebar||!backdrop) return;
    const open=typeof force==='boolean'?force:!sidebar.classList.contains('mobile-open');
    sidebar.classList.toggle('mobile-open',open);
    backdrop.classList.toggle('open',open);
    backdrop.setAttribute('aria-hidden',String(!open));
    document.body.classList.toggle('mobile-menu-open',open);
  };
  window.closeMobileMenu=function(){ window.toggleMobileMenu(false); };

  window.buildMobileNav=function(items){
    const nav=document.getElementById('mobile-bottom-nav');
    if(!nav) return;
    const priorities=['dashboard','demands','clients','sales','docs','team'];
    const direct=priorities.map(id=>items.find(i=>i.id===id)).filter(Boolean).slice(0,4);
    nav.innerHTML=direct.map(i=>`
      <button class="mobile-tab" type="button" data-mobile-page="${i.id}" onclick="goTo('${i.id}')" aria-label="${i.label}">
        <span class="sb-icon">${i.icon}</span><span>${i.label.replace('Minhas ','').replace('Meus ','')}</span>
        ${i.badge?`<span class="mobile-tab-badge">${i.badge>99?'99+':i.badge}</span>`:''}
      </button>`).join('')+`
      <button class="mobile-tab" id="mobile-more-tab" type="button" onclick="toggleMobileMenu(true)" aria-label="Abrir mais opções">
        <span class="sb-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></span><span>Mais</span>
      </button>`;
    const current=document.querySelector('.page.active')?.id?.replace('pg-','')||'dashboard';
    window.syncMobileNavigation(current);
  };

  window.syncMobileNavigation=function(page){
    document.querySelectorAll('[data-mobile-page]').forEach(el=>el.classList.toggle('active',el.dataset.mobilePage===page));
    const more=document.getElementById('mobile-more-tab');
    if(more) more.classList.toggle('active',!document.querySelector(`[data-mobile-page="${page}"]`) && page!=='dashboard');
  };

  function renderInstallContent(){
    const steps=document.getElementById('install-steps');
    const primary=document.getElementById('install-primary');
    if(!steps||!primary) return;
    if(isIOS()){
      steps.innerHTML=`
        <div class="install-step"><div class="install-step-num">1</div><div><strong>Abra o menu do Safari</strong><span>Toque em Mais (…) e depois em <b>Compartilhar</b>. Dependendo do layout, o botão Compartilhar já aparece na barra.</span></div></div>
        <div class="install-step"><div class="install-step-num">2</div><div><strong>Adicionar à Tela de Início</strong><span>Role a lista de ações e toque nessa opção. Se ela não aparecer, use “Editar Ações”.</span></div></div>
        <div class="install-step"><div class="install-step-num">3</div><div><strong>Ative “Abrir como App”</strong><span>Confirme em <b>Adicionar</b>. A Magemind ficará na sua tela inicial, sem a barra do navegador.</span></div></div>`;
      primary.style.display='none';
    }else{
      steps.innerHTML=`
        <div class="install-step"><div class="install-step-num">1</div><div><strong>Instale a Magemind</strong><span>Use o botão abaixo. Se ele não aparecer, abra o menu ⋮ do navegador.</span></div></div>
        <div class="install-step"><div class="install-step-num">2</div><div><strong>Confirme a instalação</strong><span>Escolha “Instalar app” ou “Adicionar à tela inicial”.</span></div></div>
        <div class="install-step"><div class="install-step-num">3</div><div><strong>Abra pelo novo ícone</strong><span>O sistema será iniciado em uma janela própria, com aparência de aplicativo.</span></div></div>`;
      primary.style.display=deferredInstallPrompt?'inline-flex':'none';
    }
  }

  window.openInstallGuide=function(force){
    if(!isMobile() && !force) return;
    if(isStandalone() && !force) return;
    renderInstallContent();
    const guide=document.getElementById('install-guide');
    if(!guide) return;
    guide.classList.add('open');
    guide.setAttribute('aria-hidden','false');
  };
  window.closeInstallGuide=function(remember){
    const guide=document.getElementById('install-guide');
    if(!guide) return;
    guide.classList.remove('open');
    guide.setAttribute('aria-hidden','true');
    if(remember){ try{ localStorage.setItem(DISMISS_KEY,String(Date.now())); }catch(_){} }
  };
  window.installMagemind=async function(){
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    window.closeInstallGuide(true);
  };

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    renderInstallContent();
  });
  window.addEventListener('appinstalled',()=>window.closeInstallGuide(true));
  window.addEventListener('resize',()=>{ if(!isMobile()) window.closeMobileMenu(); });

  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape') return;
    window.closeMobileMenu();
    window.closeInstallGuide(false);
  });
  document.addEventListener('DOMContentLoaded',()=>{
    const guide=document.getElementById('install-guide');
    guide?.addEventListener('click',event=>{ if(event.target===guide) window.closeInstallGuide(true); });
    if(isMobile()&&!isStandalone()&&!recentlyDismissed()) setTimeout(()=>window.openInstallGuide(false),1200);
  });
})();
