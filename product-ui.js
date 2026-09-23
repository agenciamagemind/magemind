/* Selective presentation improvements; existing forms and permissions are retained. */
function groupSidebarNavigation(items, renderItem) {
  const groups = [
    ['trabalho', 'Trabalho', ['dashboard', 'demands', 'docs']],
    ['negocio', 'Negócio', ['clients', 'sales', 'partners', 'withdrawals', 'goals', 'solutions', 'affiliates']],
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
    const sections = [['profile','Perfil'], ['security','Segurança'], ['notifications','Notificações'], ['company','Empresa']];
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
    document.getElementById('settings-panel-security').append(
      document.getElementById('prof-pass-cur').closest('.settings-card'),
      document.querySelector('#profile-layout button[onclick="doLogout()"]')
    );
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
  const selected = host.querySelector('[role="tab"][aria-selected="true"]');
  selectSettingsTab(selected && !selected.hidden ? selected.dataset.section : 'profile');
}

function selectSettingsTab(section) {
  document.querySelectorAll('.settings-tabs [role="tab"]').forEach(tab => {
    const selected = !tab.hidden && tab.dataset.section === section;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  });
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
