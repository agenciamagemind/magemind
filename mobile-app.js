(function(){
  'use strict';
  const DISMISS_KEY='mm_install_prompt_dismissed_at';
  const DISMISS_DAYS=14;
  let deferredInstallPrompt=null;
  let selectedPlatform=null;

  function isMobile(){ return window.matchMedia('(max-width: 900px)').matches; }
  function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true; }
  function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1); }
  function isAndroid(){ return /android/i.test(navigator.userAgent); }
  function detectedPlatform(){ return isIOS()?'ios':(isAndroid()?'android':'android'); }
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
    const direct=priorities.map(id=>items.find(i=>i.id===id)).filter(Boolean).slice(0,3);
    nav.innerHTML=direct.map(i=>`
      <button class="mobile-tab" type="button" data-mobile-page="${i.id}" onclick="goTo('${i.id}')" aria-label="${i.label}">
        <span class="sb-icon">${i.icon}</span><span>${i.label.replace('Minhas ','').replace('Meus ','')}</span>
        ${i.badge?`<span class="mobile-tab-badge">${i.badge>99?'99+':i.badge}</span>`:''}
      </button>`).join('')+`
      <button class="mobile-tab" type="button" data-mobile-page="settings" onclick="goTo('settings')" aria-label="Abrir configurações da conta">
        <span class="sb-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.2a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg></span><span>Config.</span>
      </button>
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
    const platform=selectedPlatform||detectedPlatform();
    document.querySelectorAll('[data-install-platform]').forEach(button=>{
      const active=button.dataset.installPlatform===platform;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    });
    if(platform==='ios'){
      steps.innerHTML=`
        <div class="install-step"><div class="install-step-num">1</div><div><strong>Abra o menu do navegador</strong><span>Toque no botão de compartilhar. Se você estiver vendo o botão de três pontos (…), abra-o e escolha <b>Compartilhar</b>.</span></div></div>
        <div class="install-step"><div class="install-step-num">2</div><div><strong>Encontre a ação correta</strong><span>Role a folha de compartilhamento e toque em <b>Adicionar à Tela de Início</b>. Se necessário, use “Editar Ações”.</span></div></div>
        <div class="install-step"><div class="install-step-num">3</div><div><strong>Confirme a instalação</strong><span>Mantenha <b>Abrir como App</b> ativado e toque em <b>Adicionar</b>.</span></div></div>
        <div class="install-step"><div class="install-step-num">4</div><div><strong>Abra pelo ícone da Magemind</strong><span>No iPhone e iPad, as notificações só podem ser ativadas depois que o app é aberto pela Tela de Início.</span></div></div>`;
      primary.style.display='none';
    }else{
      steps.innerHTML=`
        <div class="install-step"><div class="install-step-num">1</div><div><strong>Use a instalação rápida</strong><span>Toque em <b>Instalar agora</b>. Se o botão não aparecer, abra o menu ⋮ do Chrome.</span></div></div>
        <div class="install-step"><div class="install-step-num">2</div><div><strong>Escolha a opção de aplicativo</strong><span>Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>, conforme o seu navegador.</span></div></div>
        <div class="install-step"><div class="install-step-num">3</div><div><strong>Confirme e abra</strong><span>A Magemind ganhará um ícone próprio e será iniciada sem a barra do navegador.</span></div></div>`;
      primary.style.display=deferredInstallPrompt?'inline-flex':'none';
    }
  }

  window.setInstallPlatform=function(platform){
    if(platform!=='ios'&&platform!=='android') return;
    selectedPlatform=platform;
    renderInstallContent();
  };

  window.openInstallGuide=function(force){
    if(!isMobile() && !force) return;
    if(isStandalone() && !force) return;
    if(!selectedPlatform) selectedPlatform=detectedPlatform();
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
  window.addEventListener('appinstalled',()=>{
    try{ localStorage.setItem('mm_app_just_installed','1'); }catch(_){}
    window.closeInstallGuide(true);
  });
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
