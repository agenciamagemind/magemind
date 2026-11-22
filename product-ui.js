/* Selective presentation improvements; existing forms and permissions are retained. */
let activeAnchoredPopover = null;
let popoverPositionFrame = 0;
let anchoredPopoverListeners = false;

function bindAnchoredPopover(panel, trigger, {align = 'start'} = {}) {
  if (!anchoredPopoverListeners) {
    anchoredPopoverListeners = true;
    listenForAnchoredPopovers();
  }
  const native = typeof panel.showPopover === 'function';
  const modal = native ? null : trigger.closest('dialog');
  const isOpen = () => native ? panel.matches(':popover-open') : !panel.hidden;
  if (native) {
    trigger.setAttribute('popovertarget', panel.id);
    trigger.addEventListener('click', event => event.preventDefault());
  } else {
    panel.hidden = true;
    (modal || document.body).append(panel);
    if (modal) panel.style.position = 'absolute';
  }

  function position() {
    if (!isOpen()) return;
    const anchor = trigger.getBoundingClientRect();
    if (!anchor.width || !anchor.height) return close();
    const viewport = window.visualViewport;
    const inset = 12, gap = 8;
    const bounds = modal?.getBoundingClientRect();
    const viewportLeft = viewport?.offsetLeft || 0, viewportTop = viewport?.offsetTop || 0;
    const left = Math.max(viewportLeft, bounds?.left ?? viewportLeft) + inset;
    const top = Math.max(viewportTop, bounds?.top ?? viewportTop) + inset;
    const right = Math.min(viewportLeft + (viewport?.width || innerWidth), bounds?.right ?? Infinity) - inset;
    const bottom = Math.min(viewportTop + (viewport?.height || innerHeight), bounds?.bottom ?? Infinity) - inset;
    if (anchor.bottom < top || anchor.top > bottom) return close();

    panel.style.setProperty('--popover-width', Math.max(0, right - left) + 'px');
    panel.style.setProperty('--popover-space', Math.max(0, bottom - top) + 'px');
    const size = panel.getBoundingClientRect();
    const below = bottom - anchor.bottom - gap;
    const above = anchor.top - top - gap;
    const placeAbove = below < size.height && above > below;
    const available = Math.max(0, placeAbove ? above : below);
    const x = align === 'end' ? anchor.right - size.width : anchor.left;
    panel.style.setProperty('--popover-space', available + 'px');
    const offsetX = modal ? modal.scrollLeft - bounds.left - modal.clientLeft : 0;
    const offsetY = modal ? modal.scrollTop - bounds.top - modal.clientTop : 0;
    panel.style.left = (Math.max(left, Math.min(x, right - size.width)) + offsetX) + 'px';
    const y = placeAbove ? anchor.top - gap - Math.min(size.height, available) : Math.max(top, anchor.bottom + gap);
    panel.style.top = (y + offsetY) + 'px';
  }

  function sync() {
    trigger.setAttribute('aria-expanded', String(isOpen()));
    if (!isOpen() && activeAnchoredPopover === controller) activeAnchoredPopover = null;
  }

  function close(restoreFocus = false) {
    if (!isOpen()) return;
    if (native) panel.hidePopover();
    else panel.hidden = true;
    sync();
    if (restoreFocus) trigger.focus({preventScroll: true});
  }

  function open() {
    activeAnchoredPopover?.close();
    if (native) panel.showPopover({source: trigger});
    else panel.hidden = false;
    activeAnchoredPopover = controller;
    sync();
    position();
  }

  const controller = {open, close, position, isOpen, panel, trigger, native};
  panel.addEventListener('toggle', sync);
  return controller;
}

function closeAnchoredPopover() {
  activeAnchoredPopover?.close();
}

function scheduleAnchoredPopoverPosition(event) {
  if (!activeAnchoredPopover || popoverPositionFrame) return;
  if (event.target instanceof Node && activeAnchoredPopover.panel.contains(event.target)) return;
  popoverPositionFrame = requestAnimationFrame(() => {
    popoverPositionFrame = 0;
    activeAnchoredPopover?.position();
  });
}

function listenForAnchoredPopovers() {
  addEventListener('resize', scheduleAnchoredPopoverPosition);
  document.addEventListener('magemind:tracking-signed-out', closeAnchoredPopover);
  document.addEventListener('scroll', scheduleAnchoredPopoverPosition, true);
  window.visualViewport?.addEventListener('resize', scheduleAnchoredPopoverPosition);
  window.visualViewport?.addEventListener('scroll', scheduleAnchoredPopoverPosition);
  document.addEventListener('pointerdown', event => {
    const popover = activeAnchoredPopover;
    if (popover && !popover.native && !popover.panel.contains(event.target) && !popover.trigger.contains(event.target)) popover.close();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !activeAnchoredPopover?.isOpen()) return;
    event.preventDefault();
    activeAnchoredPopover.close(true);
  });
}

function groupSidebarNavigation(items, renderItem) {
  const groups = [
    ['trabalho', 'Trabalho', ['dashboard', 'demands', 'docs', 'oraculo']],
    ['negocio', 'Negócio', ['campaigns', 'orders', 'products', 'integrations', 'clients', 'sales', 'partners', 'withdrawals', 'goals', 'solutions', 'affiliates']],
    ['gestao', 'Gestão', ['team', 'firewall', 'settings']]
  ];
  return groups.map(([id, label, pages]) => {
    const entries = items.filter(item => pages.includes(item.id));
    return entries.length ? `<section class="sb-group" aria-labelledby="sb-group-${id}"><h2 id="sb-group-${id}" class="sb-group-title">${label}</h2><div class="sb-group-items">${entries.map(renderItem).join('')}</div></section>` : '';
  }).join('');
}

function setupSettingsTabs() {
  const mount = document.getElementById('settings-profile-mount');
  const host = mount.parentElement;
  if (!host.querySelector('.settings-tabs')) {
    host.classList.add('settings-sections');
    const tabs = document.createElement('div');
    tabs.className = 'settings-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Setores das configurações');
    const sections = [['profile','Perfil'], ['appearance','Aparência'], ['notifications','Notificações'], ['company','Empresa']];
    sections.forEach(([id, label]) => {
      const panel = id === 'profile' ? mount : document.createElement('div');
      if (id !== 'profile') { panel.id = `settings-panel-${id}`; host.appendChild(panel); }
      panel.classList.add('settings-panel');
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `settings-tab-${id}`);
      const tab = document.createElement('button');
      tab.type = 'button'; tab.id = `settings-tab-${id}`; tab.textContent = label;
      tab.dataset.section = id; tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panel.id);
      tab.addEventListener('click', () => selectSettingsTab(id));
      tabs.appendChild(tab);
    });
    host.prepend(tabs);
    mount.append(document.querySelector('#profile-layout button[onclick="doLogout()"]'));
    document.getElementById('settings-panel-notifications').append(
      document.getElementById('push-settings-card'), document.getElementById('mobile-install-settings')
    );
    document.getElementById('settings-panel-company').append(document.getElementById('agency-settings-card').parentElement);
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      const visible = [...tabs.querySelectorAll('[role="tab"]')].filter(tab => !tab.hidden);
      const index = visible.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length;
      visible[next].click(); visible[next].focus();
    });
  }
  document.getElementById('settings-tab-company').hidden = !isAdmin();
  if(window.trackingEnabled()&&!window.trackingObserver()){
    if(!document.getElementById('settings-tab-tracking')){
      const panel=document.createElement('div');panel.id='settings-panel-tracking';panel.className='settings-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','settings-tab-tracking');host.append(panel);
      const tab=document.createElement('button');tab.type='button';tab.id='settings-tab-tracking';tab.textContent='Custos';tab.dataset.section='tracking';tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);tab.addEventListener('click',()=>selectSettingsTab('tracking'));
      document.getElementById('settings-tab-appearance').before(tab);
      const notifications=document.createElement('div');notifications.id='tracking-notifications-mount';notifications.className='mt-root';document.getElementById('settings-panel-notifications').prepend(notifications);
    }
  }else{
    const panel=document.getElementById('settings-panel-tracking'),module=document.getElementById('tracking-module');
    if(panel?.contains(module)){module.hidden=true;document.body.append(module);}
    document.getElementById('settings-tab-tracking')?.remove();panel?.remove();document.getElementById('tracking-notifications-mount')?.remove();
  }
  const selected = host.querySelector('[role="tab"][aria-selected="true"]');
  selectSettingsTab(selected && !selected.hidden ? selected.dataset.section : 'profile');
}

function selectSettingsTab(section) {
  document.querySelectorAll('.settings-tabs [role="tab"]').forEach(tab => {
    const selected = !tab.hidden && tab.dataset.section === section;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  });
  if (section === 'appearance') window.MagemindAppearance?.render();
}

const dashboardSensitiveContent = '.md-tile-body, .md-info, .stat > :not(.stat-label), .dash-grid .card-block > :not(.cb-head, .cb-title)';
const dashboardPrivacyKey = userId => 'mm_dashboard_private_' + userId;
let dashboardPrivacyObserver;
let dashboardPrivacyUser;

function setDashboardPrivacy(hidden) {
  const page = document.getElementById('pg-dashboard');
  const toggle = document.getElementById('dashboard-privacy');
  page.toggleAttribute('data-dashboard-private', hidden);
  toggle.setAttribute('aria-pressed', String(hidden));
  toggle.title = hidden ? 'Mostrar dados dos blocos' : 'Ocultar dados dos blocos';
  const syncContent = () => {
    page.querySelectorAll(dashboardSensitiveContent).forEach(node => node.toggleAttribute('inert', hidden));
  };
  syncContent();
  dashboardPrivacyObserver?.disconnect();
  if (hidden) {
    dashboardPrivacyObserver = new MutationObserver(syncContent);
    dashboardPrivacyObserver.observe(page, {childList: true, subtree: true});
  }
}

function syncDashboardPrivacyControl(page) {
  const active = page === 'dashboard' && Boolean(DB.me);
  document.getElementById('dashboard-privacy').hidden = !active;
  if (!active || dashboardPrivacyUser === DB.me.id) return;
  dashboardPrivacyUser = DB.me.id;
  let hidden = false;
  try { hidden = localStorage.getItem(dashboardPrivacyKey(dashboardPrivacyUser)) === 'true'; } catch {}
  setDashboardPrivacy(hidden);
}

function toggleDashboardPrivacy() {
  if (!DB.me) return;
  const hidden = !document.getElementById('pg-dashboard').hasAttribute('data-dashboard-private');
  setDashboardPrivacy(hidden);
  try { localStorage.setItem(dashboardPrivacyKey(DB.me.id), String(hidden)); } catch {}
}

function openClientPreview(id) {
  const client = DB.clients.find(item => item.id === id);
  if (!hasPermission('clients.view') || !canViewClient(client)) { toast('Sem permissão para visualizar este cliente', 'err'); return; }
  const plans = (client.planIds || []).map(id => DB.plans.find(plan => plan.id === id)?.name).filter(Boolean);
  const affiliate = DB.users.find(user => user.id === client.affiliateId);
  const fields = [
    ['Email', client.email], ['WhatsApp', client.phone], ['Status', client.status],
    ['Tipo', client.type], ['Planos', plans.join(', ') || 'Sem plano'], ['Cadastro', clientDisplayDate(client)],
    ['Indicado por', affiliate?.name], ['Demandas', String(DB.demands.filter(demand => demand.client === id).length)]
  ];
  document.getElementById('client-preview-name').textContent = client.name || 'Cliente';
  document.getElementById('client-preview-content').innerHTML = `<dl class="client-preview-fields">${fields.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value || '—')}</dd></div>`).join('')}</dl><div class="client-preview-notes"><h3>Observações</h3><p>${escapeHTML(client.notes || 'Nenhuma observação cadastrada.')}</p></div>`;
  openModal('modal-client-preview');
}

