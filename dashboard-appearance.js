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
    dashboard: {name: 'Menu', sample: ['Faturamento', 'Pedidos', 'Minhas demandas']},
    demands: {name: 'Minhas demandas', sample: ['A fazer', 'Em andamento', 'Concluídas']},
    campaigns: {name: 'Campanhas', sample: ['Campanha', 'Valor gasto', 'Vendas']},
    orders: {name: 'Pedidos', sample: ['Pedido', 'Pagamento', 'Status']},
    affiliates: {name: 'Indique e ganhe', sample: ['Convide um cliente', 'Suas indicações']}
  };
  const bucket = 'dashboard-backgrounds';
  const backgrounds = new Map();
  const app = document.getElementById('app');
  const main = app.querySelector('.main');
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

  function paint(element, info) {
    element.hidden = !info?.url;
    if (!info?.url) {
      element.style.removeProperty('--background-image');
      return;
    }
    const scale = Math.max(element.clientWidth / info.width, element.clientHeight / info.height) * info.zoom;
    element.style.setProperty('--background-image', 'url(' + JSON.stringify(info.url) + ')');
    element.style.setProperty('--background-size', (info.width * scale) + 'px ' + (info.height * scale) + 'px');
    element.style.setProperty('--background-position', info.position_x + '% ' + info.position_y + '%');
    element.dataset.shade = info.shade;
  }

  function applyBackground() {
    const info = backgrounds.get(page);
    app.toggleAttribute('data-custom-background', Boolean(info?.url));
    paint(layer, info);
  }

  function route(next) {
    page = next;
    applyBackground();
  }

  async function signedUrl(row) {
    const result = await storage().createSignedUrl(row.object_path, 3600);
    return result.data?.signedUrl || null;
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
                <button class="btn btn-ghost" type="button" data-background-section="${key}">${backgrounds.has(key) ? 'Editar fundo' : 'Adicionar imagem'}</button>
                ${backgrounds.has(key) ? `<button class="btn btn-ghost mm-remove-bg" type="button" data-remove-section="${key}">Remover<span class="sr-only"> fundo de ${name}</span></button>` : ''}
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
    if (!draft || !editor.open || !viewport) return;
    const rail = parseFloat(getComputedStyle(app).getPropertyValue('--sidebar-rail')) || 0;
    const closedWidth = app.clientWidth - (matchMedia('(min-width:901px)').matches ? rail : 0);
    // Preserve the whole panel's aspect ratio even when it is scaled into the editor.
    const ratio = closedWidth / Math.max(app.clientHeight, 1);
    const width = Math.min(viewport.parentElement.clientWidth, Math.round(app.clientHeight * .48 * ratio));
    if (ratio > 0 && width > 0) {
      viewport.style.width = width + 'px';
      viewport.style.aspectRatio = String(ratio);
    }
    paint(viewport.querySelector('.mm-background'), draft);
  }

  function syncCrop() {
    if (!draft || draft.remove) return;
    const form = editor.querySelector('form');
    for (const name of ['zoom', 'position_x', 'position_y']) draft[name] = form.elements[name].valueAsNumber;
    draft.shade = form.elements.shade.value;
    measurePreview();
  }

  function openEditor(section, remove = false) {
    if (!userId || !Object.hasOwn(sections, section) || !canAccessPage(section)) return;
    releaseDraft();
    const previous = backgrounds.get(section);
    const {name, sample} = sections[section];
    draft = {section, previous, zoom: 1, position_x: 50, position_y: 50, shade: 'medium', ...previous, remove};
    editor.innerHTML = remove ? `
      <form class="mm-editor-form">
        <h2 id="appearance-editor-title">Remover fundo</h2>
        <p>${name} voltará ao fundo cinza do painel.</p>
        <p class="mm-editor-status" role="status"></p>
        <div class="mm-editor-actions"><button type="button" class="btn btn-ghost" data-cancel>Cancelar</button><button type="submit" class="btn mm-danger">Remover fundo</button></div>
      </form>` : `
      <form class="mm-editor-form" data-backdrop>
        <header><h2 id="appearance-editor-title">Fundo · ${name}</h2><p>Escolha a imagem e ajuste o enquadramento na prévia.</p></header>
        <label class="mm-image-file"><span>Imagem de fundo</span><input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"></label>
        <div class="mm-preview-wrap"><div class="mm-image-preview mm-preview-${section}" aria-hidden="true">
          <div class="mm-background" hidden></div>
          <div class="mm-preview-interface">
            <b>${name}</b>
            <div class="mm-preview-panels">${sample.map(label => `<div><span>${label}</span><i></i><i></i></div>`).join('')}</div>
          </div>
        </div></div>
        <div class="mm-crop-sliders">
          <label>Zoom<input type="range" name="zoom" min="1" max="3" step=".01" value="${draft.zoom}"></label>
          <label>Horizontal<input type="range" name="position_x" min="0" max="100" step=".1" value="${draft.position_x}"></label>
          <label>Vertical<input type="range" name="position_y" min="0" max="100" step=".1" value="${draft.position_y}"></label>
        </div>
        <fieldset class="mm-shade"><legend>Intensidade do degradê</legend><div>${[['weak','Fraco'],['medium','Médio'],['strong','Forte']].map(([key, label]) => `
          <label><input type="radio" name="shade" value="${key}" ${key === draft.shade ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
        </fieldset>
        <p class="mm-editor-status" role="status"></p>
        <div class="mm-editor-actions"><button type="button" class="btn btn-ghost" data-cancel>Cancelar</button><button type="submit" class="btn btn-primary" ${draft.url ? '' : 'disabled'}>Salvar fundo</button></div>
      </form>`;
    window.openAccessibleDialog(editor);
    measurePreview();
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
    if (!file || !draft) return;
    const edit = draft;
    const form = event.target.form;
    const status = form.querySelector('.mm-editor-status');
    form.querySelector('[type=submit]').disabled = true;
    status.textContent = 'Preparando imagem…';
    try {
      const image = await prepareImage(file);
      if (draft !== edit || event.target.files?.[0] !== file) return;
      if (edit.fileUrl) URL.revokeObjectURL(edit.fileUrl);
      edit.fileUrl = URL.createObjectURL(image.blob);
      Object.assign(edit, image, {url: edit.fileUrl});
      for (const [name, value] of [['zoom', 1], ['position_x', 50], ['position_y', 50]]) form.elements[name].value = value;
      syncCrop();
      status.textContent = 'Arraste a imagem na prévia ou ajuste a posição pelos controles.';
    } catch {
      if (draft === edit) status.textContent = 'Não foi possível abrir essa imagem. Use JPG, PNG ou WebP de até 25 MB.';
    } finally {
      if (draft === edit && event.target.files?.[0] === file) form.querySelector('[type=submit]').disabled = !edit.url;
    }
  });
  editor.addEventListener('input', event => { if (!event.target.files) syncCrop(); });
  editor.addEventListener('click', event => { if (event.target.closest('[data-cancel]') && !draft?.busy) editor.close(); });
  editor.addEventListener('cancel', event => { if (draft?.busy) event.preventDefault(); });
  editor.addEventListener('close', releaseDraft);

  let drag;
  editor.addEventListener('pointerdown', event => {
    const preview = event.target.closest('.mm-image-preview');
    if (!draft?.url || draft.busy || !preview || event.button !== 0) return;
    drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: draft.position_x, startY: draft.position_y, edit: draft
    };
    preview.setPointerCapture(event.pointerId);
  });
  editor.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId || drag.edit !== draft) return;
    const form = editor.querySelector('form');
    const preview = editor.querySelector('.mm-image-preview');
    const ratio = Math.max(preview.clientWidth / draft.width, preview.clientHeight / draft.height) * draft.zoom;
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
    if (!edit || edit.busy || !id || (!edit.remove && !edit.url)) return;
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
      const {section, previous} = edit;
      const scoped = query => query.eq('user_id', id).eq('section', section).eq('revision', previous.revision);
      if (edit.remove) {
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
        const row = {
          user_id: id, section, object_path: uploaded || previous.object_path, revision: crypto.randomUUID(),
          width: edit.width, height: edit.height, zoom: edit.zoom, shade: edit.shade,
          position_x: edit.position_x, position_y: edit.position_y
        };
        const query = previous
          ? scoped(supa.from('dashboard_backgrounds').update(row))
          : supa.from('dashboard_backgrounds').insert(row);
        const {data, error} = await query.select('revision');
        if (error) throw error;
        if (!data.length) throw new Error('O fundo mudou em outro dispositivo. Reabra a configuração.');
        committed = true;
        if (current === generation) {
          row.url = uploaded ? await signedUrl(row) : previous.url;
          if (current === generation) backgrounds.set(section, row);
        }
      }
      if (previous && (uploaded || edit.remove) && current === generation) {
        void storage().remove([previous.object_path]);
      }
      if (current !== generation) return;
      editor.close();
      render();
      applyBackground();
      panel()?.querySelector('[data-background-section="' + section + '"]')?.focus();
      message(edit.remove ? 'Fundo removido.' : 'Fundo salvo.');
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
      if (submit) submit.disabled = !edit.remove && !edit.url;
    }
  });

  document.addEventListener('click', event => {
    const option = event.target.closest('[data-accent-choice]');
    if (option) void chooseAccent(option.dataset.accentChoice);
    const section = event.target.closest('[data-background-section],[data-remove-section]');
    if (section) openEditor(section.dataset.backgroundSection || section.dataset.removeSection, Boolean(section.dataset.removeSection));
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
  }).observe(main);
  window.MagemindAppearance = {route, render, clear};
  setAccent('lime');
})();
