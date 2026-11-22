(() => {
  'use strict';

  const palette = {
    blue: ['Azul', '#3166f0'],
    cyan: ['Ciano', '#0eb1fc'],
    green: ['Verde', '#06bb9e'],
    lime: ['Verde-limão', '#b4d806'],
    yellow: ['Amarelo', '#fecc39'],
    orange: ['Laranja', '#fd7f67'],
    pink: ['Rosa', '#fd49ab'],
    magenta: ['Magenta', '#de69db'],
    purple: ['Roxo', '#a35bfd'],
    white: ['Branco', '#ffffff']
  };
  const sections = {
    dashboard: {name: 'Dashboard', preset: 37, sample: ['Faturamento', 'Pedidos', 'Demandas']},
    demands: {name: 'Demandas', preset: 1, sample: ['A fazer', 'Em andamento', 'Concluídas']},
    campaigns: {name: 'Campanhas', preset: 17, sample: ['Campanha', 'Valor gasto', 'Vendas']},
    orders: {name: 'Pedidos', preset: 21, sample: ['Pedido', 'Pagamento', 'Status']},
    affiliates: {name: 'Indique e ganhe', preset: 24, sample: ['Convide um cliente', 'Suas indicações']}
  };
  const presetCount = 46;
  const presetSizes = {
    1: [1919, 1079], 3: [1622, 1080], 4: [2304, 1296], 5: [2304, 1646], 8: [2304, 1728],
    9: [1602, 1080], 11: [1888, 1080], 16: [1308, 736], 17: [1350, 1080], 18: [1620, 1080],
    29: [1308, 736], 35: [1536, 864], 38: [1440, 1080], 39: [1814, 1080], 40: [1280, 720],
    41: [1626, 1080], 43: [1536, 864], 44: [2304, 1296]
  };
  const defaultCrop = {zoom: 1, position_x: 50, position_y: 50};
  const cropFields = Object.keys(defaultCrop);
  const deviceMedia = matchMedia('(max-width: 900px)');
  const currentDevice = () => deviceMedia.matches ? 'mobile' : 'desktop';
  const bucket = 'dashboard-backgrounds';
  const backgrounds = new Map();
  const app = document.getElementById('app');
  const layer = document.createElement('div');
  layer.className = 'mm-background';
  layer.setAttribute('aria-hidden', 'true');
  app.prepend(layer);

  let userId = null;
  let page = 'dashboard';
  let accent = 'lime';
  let draft;
  let generation = 0;
  let accentRevision = 0;
  let paletteBusy = false;
  let refreshTimer;

  const editor = document.createElement('dialog');
  editor.id = 'appearance-editor';
  editor.className = 'mm-appearance-dialog mm-glass';
  editor.setAttribute('aria-labelledby', 'appearance-editor-title');
  document.body.append(editor);
  const storage = () => supa.storage.from(bucket);
  const panel = () => document.getElementById('settings-panel-appearance');

  function setAccent(value) {
    accent = Object.hasOwn(palette, value) ? value : 'lime';
    document.documentElement.dataset.accent = accent;
    document.documentElement.style.setProperty('--accent', palette[accent][1]);
  }

  function presetImage(id) {
    const [width, height] = presetSizes[id] || [1920, 1080];
    return {preset_id: id, width, height, url: 'assets/wallpapers/' + id + '.webp'};
  }

  function backgroundFor(section) {
    if (!Object.hasOwn(sections, section)) return null;
    return backgrounds.get(section) || {...presetImage(sections[section].preset), shade: 'medium', ...defaultCrop};
  }

  function cropFor(info, device) {
    if (info.crops) return info.crops[device];
    return Object.fromEntries(cropFields.map(name => [name,
      device === 'mobile' ? info['mobile_' + name] ?? info[name] : info[name]
    ]));
  }

  function paint(element, info, device) {
    element.hidden = !info?.url;
    if (!info?.url) {
      element.style.removeProperty('--background-image');
      return;
    }
    const crop = cropFor(info, device);
    const scale = Math.max(element.clientWidth / info.width, element.clientHeight / info.height) * crop.zoom;
    element.style.setProperty('--background-image', 'url(' + JSON.stringify(info.url) + ')');
    element.style.setProperty('--background-size', (info.width * scale) + 'px ' + (info.height * scale) + 'px');
    element.style.setProperty('--background-position', crop.position_x + '% ' + crop.position_y + '%');
    element.dataset.shade = info.shade;
  }

  function applyBackground() {
    const info = userId ? backgroundFor(page) : null;
    app.toggleAttribute('data-custom-background', Boolean(info?.url));
    paint(layer, info, currentDevice());
  }

  function route(next) {
    page = next;
    applyBackground();
  }

  async function signedUrl(row) {
    if (row.preset_id) return presetImage(row.preset_id).url;
    if (!row.object_path) return null;
    try {
      const result = await storage().createSignedUrl(row.object_path, 3600);
      return result.data?.signedUrl || null;
    } catch {
      return null;
    }
  }

  async function refreshUrls() {
    const current = generation;
    await Promise.all([...backgrounds.values()].map(async row => {
      const url = await signedUrl(row);
      if (url && current === generation && backgrounds.get(row.section) === row) row.url = url;
    }));
    if (current === generation) applyBackground();
  }

  function message(text, isError = false) {
    if (typeof toast === 'function') toast(text, isError ? 'err' : 'ok');
  }

  async function load() {
    const id = DB.me?.id;
    if (!id || userId === id) return;
    clear();
    userId = id;
    const current = generation;
    const initialAccent = accentRevision;
    const [color, images] = await Promise.all([
      supa.from('dashboard_appearance').select('accent').eq('user_id', id).maybeSingle(),
      supa.from('dashboard_backgrounds').select('*').eq('user_id', id)
    ]);
    if (current !== generation) return;
    if (color.data && initialAccent === accentRevision) setAccent(color.data.accent);
    for (const row of images.data || []) backgrounds.set(row.section, row);
    await refreshUrls();
    if (current !== generation) return;
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { if (!document.hidden) void refreshUrls(); }, 40 * 60 * 1000);
    render();
  }

  function clear() {
    generation++;
    userId = null;
    backgrounds.clear();
    clearInterval(refreshTimer);
    if (editor.open) editor.close();
    releaseDraft();
    setAccent('lime');
    applyBackground();
  }

  function render() {
    const host = panel();
    if (!host) return;
    const available = Object.entries(sections).filter(([key]) => canAccessPage(key));
    host.innerHTML = `
      <div class="mm-appearance">
        <section class="mm-appearance-card">
          <div class="mm-appearance-copy"><h2>Cor de destaque</h2><p>Personalize botões, seleções e gráficos.</p></div>
          <details class="mm-color-control">
            <summary aria-label="Cor de destaque: ${palette[accent][0]}">
              <span class="mm-swatch" style="--swatch:${palette[accent][1]}"></span>${palette[accent][0]}
              <span class="mm-chevron" aria-hidden="true"></span>
            </summary>
            <div class="mm-palette mm-glass" role="group" aria-label="Cores de destaque">
              ${Object.entries(palette).map(([key, [label, color]]) => `
                <button type="button" data-accent-choice="${key}" aria-pressed="${key === accent}">
                  <span class="mm-selected" aria-hidden="true">${key === accent ? '✓' : ''}</span>
                  <span class="mm-swatch" style="--swatch:${color}"></span>${label}
                </button>`).join('')}
            </div>
          </details>
        </section>
        <section class="mm-appearance-card mm-background-card">
          <div class="mm-appearance-copy"><h2>Imagens de fundo</h2><p>Escolha um fundo para cada área do painel.</p></div>
          <ul>${available.map(([key, {name}]) => `
            <li>
              <span class="mm-background-name">${name}</span>
              <div class="mm-background-actions">
                <button class="btn btn-ghost" type="button" data-background-section="${key}">Editar fundo<span class="sr-only"> de ${name}</span></button>
                ${backgrounds.get(key)?.background_disabled
                  ? `<button class="btn btn-ghost" type="button" data-restore-section="${key}">Restaurar padrão<span class="sr-only"> de ${name}</span></button>`
                  : `<button class="btn btn-ghost mm-remove-bg" type="button" data-remove-section="${key}">Remover<span class="sr-only"> fundo de ${name}</span></button>`}
              </div>
            </li>`).join('')}</ul>
        </section>
      </div>`;
  }

  async function chooseAccent(key) {
    const id = userId;
    if (!id || paletteBusy || !Object.hasOwn(palette, key)) return;
    const old = accent;
    const current = generation;
    accentRevision++;
    paletteBusy = true;
    setAccent(key);
    render();
    panel()?.querySelector('summary')?.focus();
    try {
      const {error} = await supa.from('dashboard_appearance').upsert({user_id: id, accent: key});
      if (error) throw error;
    } catch {
      if (current === generation) {
        setAccent(old);
        render();
        panel()?.querySelector('summary')?.focus();
        message('Não foi possível salvar a cor. Tente novamente.', true);
      }
    } finally {
      paletteBusy = false;
    }
  }

  async function refreshBackground(section, id, current) {
    const {data, error} = await supa.from('dashboard_backgrounds').select('*')
      .eq('user_id', id).eq('section', section).maybeSingle();
    if (error || current !== generation) return;
    const url = data ? await signedUrl(data) : null;
    if (current !== generation) return;
    if (data) backgrounds.set(section, {...data, url});
    else backgrounds.delete(section);
    applyBackground();
    render();
  }

  function releaseDraft() {
    if (draft?.fileUrl) URL.revokeObjectURL(draft.fileUrl);
    draft = null;
  }

  function measurePreview() {
    const viewport = editor.querySelector('.mm-image-preview');
    if (!draft?.url || !editor.open || !viewport) return;
    const desktop = draft.device === 'desktop';
    const rail = desktop ? parseFloat(getComputedStyle(app).getPropertyValue('--sidebar-rail')) || 0 : 0;
    const ratio = currentDevice() === draft.device
      ? (app.clientWidth - rail) / Math.max(app.clientHeight, 1)
      : desktop ? 1364 / 900 : 390 / 844;
    const heightLimit = app.clientHeight * (desktop ? .38 : .48);
    const width = Math.min(viewport.parentElement.clientWidth, Math.round(heightLimit * ratio));
    if (ratio > 0 && width > 0) {
      viewport.style.width = width + 'px';
      viewport.style.aspectRatio = String(ratio);
    }
    paint(viewport.querySelector('.mm-background'), draft, draft.device);
  }

  function syncCrop() {
    if (draft?.mode !== 'edit') return;
    const form = editor.querySelector('form');
    for (const name of cropFields) draft.crops[draft.device][name] = form.elements[name].valueAsNumber;
    draft.shade = form.elements.shade.value;
    measurePreview();
  }

  function updateEditor() {
    const form = editor.querySelector('form');
    const crop = draft.crops[draft.device];
    for (const name of cropFields) form.elements[name].value = crop[name];
    form.querySelector('.mm-crop-editor').hidden = !draft.url;
    form.querySelector('.mm-preview-empty').hidden = Boolean(draft.url);
    form.querySelector('[data-view-crop]').hidden = !draft.url;
    form.querySelector('.mm-image-preview').dataset.device = draft.device;
    form.querySelector('[type="submit"]').disabled = !draft.url || draft.preparing;
    for (const button of form.querySelectorAll('[data-crop-device]')) {
      button.setAttribute('aria-pressed', String(button.dataset.cropDevice === draft.device));
    }
    for (const button of form.querySelectorAll('[data-wallpaper]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.wallpaper) === draft.preset_id));
    }
    measurePreview();
  }

  function chooseImage(image) {
    if (draft.fileUrl) URL.revokeObjectURL(draft.fileUrl);
    Object.assign(draft, {preset_id: null, blob: null, fileUrl: null}, image, {
      crops: {desktop: {...defaultCrop}, mobile: {...defaultCrop}}
    });
    updateEditor();
  }

  function galleryMarkup(preset, selected) {
    return Array.from({length: presetCount}, (_, index) => {
      const id = index + 1;
      const label = 'Imagem ' + id + (id === preset ? ' · padrão desta seção' : '');
      return `<button type="button" class="mm-wallpaper-option" data-wallpaper="${id}" aria-label="${label}" aria-pressed="${id === selected}">
        <img src="assets/wallpapers/${id}-thumb.webp" alt="" loading="lazy" decoding="async">
        <span aria-hidden="true">${id}</span>
      </button>`;
    }).join('');
  }

  function openEditor(section, mode = 'edit') {
    if (!userId || !Object.hasOwn(sections, section) || !canAccessPage(section)) return;
    releaseDraft();
    const previous = backgrounds.get(section);
    const {name, preset, sample} = sections[section];
    const info = backgroundFor(section);
    draft = {...info, section, previous, mode, selection: 0, preparing: false, device: currentDevice(),
      crops: {desktop: {...cropFor(info, 'desktop')}, mobile: {...cropFor(info, 'mobile')}}
    };
    const removing = mode === 'remove';
    editor.innerHTML = mode !== 'edit' ? `
      <form class="mm-editor-form">
        <h2 id="appearance-editor-title">${removing ? 'Remover fundo' : 'Restaurar fundo padrão'}</h2>
        <p>${name} ${removing ? 'ficará com o fundo cinza do painel.' : 'voltará a usar a imagem ' + preset + ' da galeria.'}</p>
        <p class="mm-editor-status" role="status"></p>
        <div class="mm-editor-actions"><button type="button" class="btn btn-ghost" data-cancel>Cancelar</button><button type="submit" class="btn ${removing ? 'mm-danger' : 'btn-primary'}">${removing ? 'Remover fundo' : 'Restaurar padrão'}</button></div>
      </form>` : `
      <form class="mm-editor-form" data-background-edit>
        <header><h2 id="appearance-editor-title">Fundo · ${name}</h2></header>
        <div class="mm-wallpaper-workspace">
          <section class="mm-wallpaper-crop" aria-label="Enquadramento">
            <p class="mm-preview-empty" ${draft.url ? 'hidden' : ''}>Escolha uma imagem para ver a prévia.</p>
            <div class="mm-crop-editor" ${draft.url ? '' : 'hidden'}>
              <div class="mm-crop-device" role="group" aria-label="Enquadramento por dispositivo">
                <button class="btn btn-ghost" type="button" data-crop-device="desktop">Computador</button>
                <button class="btn btn-ghost" type="button" data-crop-device="mobile">Celular</button>
              </div>
              <div class="mm-preview-wrap"><div class="mm-image-preview mm-preview-${section}" aria-hidden="true">
                <div class="mm-background" hidden></div>
                <div class="mm-preview-interface">
                  <b>${name}</b>
                  <div class="mm-preview-panels">${sample.map(label => `<div><span>${label}</span><i></i><i></i></div>`).join('')}</div>
                </div>
              </div></div>
              <p class="mm-crop-hint">Arraste a imagem na prévia ou use os controles.</p>
              <div class="mm-crop-sliders">
                <label>Zoom<input type="range" name="zoom" min="1" max="3" step=".01"></label>
                <label>Horizontal<input type="range" name="position_x" min="0" max="100" step=".1"></label>
                <label>Vertical<input type="range" name="position_y" min="0" max="100" step=".1"></label>
              </div>
            </div>
          </section>
          <section class="mm-wallpaper-source" aria-label="Imagem de fundo">
            <fieldset class="mm-shade"><legend>Intensidade do degradê</legend><div>${[['weak','Fraco'],['medium','Médio'],['strong','Forte']].map(([key, label]) => `
              <label><input type="radio" name="shade" value="${key}" ${key === draft.shade ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
            </fieldset>
            <section class="mm-gallery" aria-labelledby="mm-gallery-title">
              <div class="mm-gallery-header"><h3 id="mm-gallery-title">Galeria de fundos</h3>
                <button class="btn btn-ghost btn-xs" type="button" data-view-crop aria-label="Ajustar enquadramento">Enquadrar</button></div>
              <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" hidden>
              <div class="mm-gallery-scroll"><div class="mm-gallery-grid">
                <button type="button" class="mm-wallpaper-option mm-wallpaper-upload" data-open-wallpaper-file>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  <span>Escolher arquivo</span>
                </button>
                ${galleryMarkup(preset, draft.preset_id)}
              </div></div>
            </section>
          </section>
        </div>
        <p class="mm-editor-status" role="status"></p>
        <div class="mm-editor-actions"><button type="button" class="btn btn-ghost" data-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Salvar fundo</button></div>
      </form>`;
    window.openAccessibleDialog(editor);
    editor.scrollTop = 0;
    if (mode === 'edit') updateEditor();
  }

  async function prepareImage(file) {
    if (!file || file.size > 25 * 1024 * 1024) throw new Error('Escolha uma imagem de até 25 MB.');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(1, 2304 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const context = canvas.getContext('2d', {alpha: false});
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const [type, quality] of [['image/webp', .87], ['image/jpeg', .82], ['image/jpeg', .66]]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
        if (blob?.type === type && blob.size <= 3 * 1024 * 1024) {
          return {blob, width: canvas.width, height: canvas.height, extension: type === 'image/webp' ? 'webp' : 'jpg'};
        }
      }
      throw new Error('Não foi possível preparar a imagem. Tente outra imagem.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  editor.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file || draft?.mode !== 'edit' || draft.busy) return;
    const edit = draft;
    const form = event.target.form;
    const status = form.querySelector('.mm-editor-status');
    const selection = ++edit.selection;
    edit.preparing = true;
    updateEditor();
    status.textContent = 'Preparando imagem…';
    try {
      const image = await prepareImage(file);
      if (draft !== edit || edit.selection !== selection) return;
      const url = URL.createObjectURL(image.blob);
      chooseImage({...image, url, fileUrl: url});
      status.textContent = 'Imagem do dispositivo selecionada.';
    } catch {
      if (draft === edit && edit.selection === selection) status.textContent = 'Não foi possível abrir essa imagem. Use JPG, PNG ou WebP de até 25 MB.';
    } finally {
      if (draft === edit && edit.selection === selection) {
        edit.preparing = false;
        event.target.value = '';
        updateEditor();
      }
    }
  });
  editor.addEventListener('input', event => { if (!event.target.files) syncCrop(); });
  editor.addEventListener('click', event => {
    if (!draft || draft.busy) return;
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-cancel')) { editor.close(); return; }
    if (draft.mode !== 'edit') return;
    const form = button.form;
    if (button.hasAttribute('data-open-wallpaper-file')) form.elements.image.click();
    if (button.hasAttribute('data-view-crop')) form.querySelector('[data-crop-device][aria-pressed="true"]')?.focus();
    if (button.dataset.cropDevice && button.dataset.cropDevice !== draft.device) {
      syncCrop();
      draft.device = button.dataset.cropDevice;
      drag = null;
      updateEditor();
    }
    if (button.dataset.wallpaper) {
      const id = Number(button.dataset.wallpaper);
      draft.selection++;
      draft.preparing = false;
      form.elements.image.value = '';
      if (id !== draft.preset_id) chooseImage(presetImage(id));
      else updateEditor();
      form.querySelector('.mm-editor-status').textContent = 'Imagem ' + id + ' selecionada.';
    }
  });
  editor.addEventListener('cancel', event => { if (draft?.busy) event.preventDefault(); });
  editor.addEventListener('close', () => { if (!editor.open) releaseDraft(); });

  let drag;
  editor.addEventListener('pointerdown', event => {
    const preview = event.target.closest('.mm-image-preview');
    if (!draft?.url || draft.busy || !preview || event.button !== 0) return;
    const crop = draft.crops[draft.device];
    drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: crop.position_x, startY: crop.position_y, edit: draft
    };
    preview.setPointerCapture(event.pointerId);
  });
  editor.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId || drag.edit !== draft) return;
    const form = editor.querySelector('form');
    const preview = editor.querySelector('.mm-image-preview');
    const ratio = Math.max(preview.clientWidth / draft.width, preview.clientHeight / draft.height) * draft.crops[draft.device].zoom;
    const set = (input, value) => { input.value = Math.min(100, Math.max(0, value)); };
    const overflowX = draft.width * ratio - preview.clientWidth;
    const overflowY = draft.height * ratio - preview.clientHeight;
    if (overflowX > 0.5) set(form.elements.position_x, drag.startX - (event.clientX - drag.x) / overflowX * 100);
    if (overflowY > 0.5) set(form.elements.position_y, drag.startY - (event.clientY - drag.y) / overflowY * 100);
    syncCrop();
  });
  editor.addEventListener('lostpointercapture', () => { drag = null; });

  editor.addEventListener('submit', async event => {
    event.preventDefault();
    const edit = draft, id = userId, current = generation;
    if (!edit || edit.busy || edit.preparing || !id || (edit.mode === 'edit' && !edit.url)) return;
    const status = editor.querySelector('.mm-editor-status');
    const form = event.target;
    const submit = form.querySelector('[type=submit]');
    const controls = Array.from(form.elements).filter(control => !control.disabled);
    controls.forEach(control => { control.disabled = true; });
    edit.busy = true;
    let uploaded;
    let committed = false;
    status.textContent = 'Salvando…';
    try {
      const {section, previous, mode} = edit;
      const scoped = query => query.eq('user_id', id).eq('section', section).eq('revision', previous.revision);
      let row;
      if (mode === 'restore') {
        const {data, error} = await scoped(supa.from('dashboard_backgrounds').delete()).select('revision');
        if (error) throw error;
        if (!data.length) throw new Error('O fundo mudou em outro dispositivo. Reabra a configuração.');
        committed = true;
        if (current === generation) backgrounds.delete(section);
      } else {
        if (edit.blob) {
          const path = [id, section, crypto.randomUUID() + '.' + edit.extension].join('/');
          const {error} = await storage().upload(path, edit.blob);
          if (error) throw error;
          uploaded = path;
        }
        const removing = mode === 'remove';
        row = {
          user_id: id, section, revision: crypto.randomUUID(),
          object_path: removing || edit.preset_id ? null : (uploaded || previous.object_path),
          preset_id: removing ? null : edit.preset_id,
          background_disabled: removing, width: removing ? 1 : edit.width, height: removing ? 1 : edit.height,
          shade: edit.shade, ...edit.crops.desktop,
          mobile_zoom: edit.crops.mobile.zoom, mobile_position_x: edit.crops.mobile.position_x,
          mobile_position_y: edit.crops.mobile.position_y
        };
        const query = previous
          ? scoped(supa.from('dashboard_backgrounds').update(row))
          : supa.from('dashboard_backgrounds').insert(row);
        const {data, error} = await query.select('revision');
        if (error) throw error;
        if (!data.length) throw new Error('O fundo mudou em outro dispositivo. Reabra a configuração.');
        committed = true;
        if (current === generation) {
          row.url = row.object_path && row.object_path === previous?.object_path && previous.url
            ? previous.url : await signedUrl(row);
          if (current === generation) backgrounds.set(section, row);
        }
      }
      if (previous?.object_path && previous.object_path !== row?.object_path && current === generation) {
        void storage().remove([previous.object_path]);
      }
      if (current !== generation) return;
      editor.close();
      render();
      applyBackground();
      panel()?.querySelector('[data-background-section="' + section + '"]')?.focus();
      message(mode === 'remove' ? 'Fundo removido.' : mode === 'restore' ? 'Fundo padrão restaurado.' : 'Fundo salvo.');
    } catch (error) {
      if (uploaded && !committed && current === generation) void storage().remove([uploaded]);
      if (current === generation) {
        const conflict = error?.code === '23505' || error?.message?.startsWith('O fundo mudou');
        if (conflict) {
          await refreshBackground(edit.section, id, current);
          status.textContent = 'O fundo mudou em outro dispositivo. Feche e reabra a edição para ver a versão atual.';
        } else {
          status.textContent = 'Não foi possível salvar o fundo. Tente novamente.';
        }
      }
    } finally {
      edit.busy = false;
      controls.forEach(control => { control.disabled = false; });
      if (submit) submit.disabled = edit.mode === 'edit' && !edit.url;
    }
  });

  document.addEventListener('click', event => {
    const option = event.target.closest('[data-accent-choice]');
    if (option) void chooseAccent(option.dataset.accentChoice);
    const section = event.target.closest('[data-background-section],[data-remove-section],[data-restore-section]');
    if (section) {
      const {backgroundSection, removeSection, restoreSection} = section.dataset;
      openEditor(backgroundSection || removeSection || restoreSection, removeSection ? 'remove' : restoreSection ? 'restore' : 'edit');
    }
    const picker = panel()?.querySelector('.mm-color-control[open]');
    if (picker && !picker.contains(event.target)) picker.open = false;
  });
  document.addEventListener('keydown', event => {
    const picker = event.target.closest?.('.mm-color-control[open]');
    if (!picker || event.key !== 'Escape') return;
    event.preventDefault();
    picker.open = false;
    picker.querySelector('summary').focus();
  });
  document.addEventListener('magemind:session-ready', () => void load());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && backgrounds.size) void refreshUrls();
  });
  let resizeFrame;
  new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      applyBackground();
      measurePreview();
    });
  }).observe(app, {box: 'border-box'});
  deviceMedia.addEventListener('change', applyBackground);
  window.MagemindAppearance = {route, render, clear};
  setAccent('lime');
})();
