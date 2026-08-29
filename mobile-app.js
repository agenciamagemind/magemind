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
    const direct=items.filter(item=>item.id!=='settings').slice(0,4);
    const compactLabels={dashboard:'Menu',demands:'Demandas',clients:'Clientes',sales:'Vendas',solutions:'Soluções',affiliates:'Indique',team:'Equipe',docs:'Arquivos'};
    nav.innerHTML=direct.map(i=>`
      <button class="mobile-tab" type="button" data-mobile-page="${i.id}" onclick="navigateMobile('${i.id}')" aria-label="${i.label}">
        <span class="mobile-tab-icon">${i.icon}</span><span class="mobile-tab-label">${compactLabels[i.id]||i.label.replace('Minhas ','').replace('Meus ','')}</span>
        ${i.badge?`<span class="mobile-tab-badge">${i.badge>99?'99+':i.badge}</span>`:''}
      </button>`).join('')+`
      <button class="mobile-tab" id="mobile-more-tab" type="button" onclick="toggleMobileMenu(true)" aria-label="Abrir mais opções">
        <span class="mobile-tab-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></span><span class="mobile-tab-label">Mais</span>
      </button>`;
    nav.dataset.directPages=direct.map(item=>item.id).join(',');
    const current=document.querySelector('.page.active')?.id?.replace('pg-','')||'dashboard';
    window.syncMobileNavigation(current);
  };

  window.navigateMobile=function(page){
    window.closeMobileMenu();
    if(typeof window.goTo==='function') window.goTo(page);
    requestAnimationFrame(()=>document.getElementById(`pg-${page}`)?.scrollTo({top:0,left:0,behavior:'auto'}));
  };

  window.syncMobileNavigation=function(page){
    document.querySelectorAll('[data-mobile-page]').forEach(el=>{
      const active=el.dataset.mobilePage===page;
      el.classList.toggle('active',active);
      if(active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
    });
    const more=document.getElementById('mobile-more-tab');
    if(more){
      const active=!document.querySelector(`[data-mobile-page="${page}"]`);
      more.classList.toggle('active',active);
      if(active) more.setAttribute('aria-current','page'); else more.removeAttribute('aria-current');
    }
  };

  let responsiveTableFrame=0;
  function enhanceResponsiveTables(){
    responsiveTableFrame=0;
    document.querySelectorAll('table').forEach(table=>{
      table.classList.add('mobile-card-table');
      const headerRows=table.tHead?Array.from(table.tHead.rows):[];
      const headers=headerRows.length?Array.from(headerRows[headerRows.length-1].cells).map(cell=>cell.textContent.trim()):[];
      Array.from(table.tBodies||[]).forEach(body=>Array.from(body.rows).forEach(row=>{
        Array.from(row.cells).forEach((cell,index)=>{
          const label=headers[index]||'';
          if(label) cell.dataset.label=label; else cell.removeAttribute('data-label');
          cell.classList.toggle('mobile-empty-cell',cell.colSpan>1||!label&&row.cells.length===1);
        });
      }));
    });
  }
  function scheduleResponsiveTables(){
    if(responsiveTableFrame) return;
    responsiveTableFrame=requestAnimationFrame(enhanceResponsiveTables);
  }
  window.refreshResponsiveTables=scheduleResponsiveTables;

  function resizeCommentTextarea(){
    const input=document.getElementById('new-comment'); if(!input) return;
    input.style.height='auto';
    input.style.height=`${Math.min(120,Math.max(42,input.scrollHeight))}px`;
  }
  window.resetMobileCommentComposer=function(){
    const input=document.getElementById('new-comment');
    if(input) input.style.height='42px';
  };
  function syncMobileKeyboard(){
    const active=document.activeElement;
    const editing=active&&['INPUT','TEXTAREA','SELECT'].includes(active.tagName);
    const viewportHeight=window.visualViewport?.height||window.innerHeight;
    document.body.classList.toggle('mobile-keyboard-open',Boolean(editing&&window.innerHeight-viewportHeight>110));
  }

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
    const comment=document.getElementById('new-comment');
    comment?.addEventListener('input',resizeCommentTextarea);
    comment?.addEventListener('focus',()=>setTimeout(()=>comment.scrollIntoView({block:'nearest'}),180));
    const tablesObserver=new MutationObserver(scheduleResponsiveTables);
    tablesObserver.observe(document.getElementById('app')||document.body,{subtree:true,childList:true,characterData:true});
    scheduleResponsiveTables();
    window.visualViewport?.addEventListener('resize',syncMobileKeyboard);
    document.addEventListener('focusin',syncMobileKeyboard);
    document.addEventListener('focusout',()=>setTimeout(syncMobileKeyboard,80));
    if(isMobile()&&!isStandalone()&&!recentlyDismissed()) setTimeout(()=>window.openInstallGuide(false),1200);
  });
})();
