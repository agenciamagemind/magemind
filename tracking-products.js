(() => {
 'use strict';
 const svg=path=>'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
 const box=svg('<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10M7.5 5 16 9"/>');
 const sync=svg('<path d="M20 7v5h-5M4 17v-5h5M5 9a8 8 0 0 1 13-3l2 3M4 15l2 3a8 8 0 0 0 13-3"/>');
 const search=svg('<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>');
 const $=id=>document.getElementById(id);
 const close=()=>$('tracking-dialog').close();
 const active=(workspace)=>$('pg-products').classList.contains('active')&&workspace===window.MagemindTrackingProducts.workspace;
 const error='<p class="mt-form-error wide" role="alert" hidden></p>';
 let items=[],sources=[],workspace=null,syncing=false,syncMessage='';
 function onPage(ctx){return workspace===ctx.state.workspace&&$('pg-products').classList.contains('active');}
 function image(row,esc){
  return '<span class="mt-product-image">'+box+(/^https:\/\//i.test(row.image_url||'')?
   '<img src="'+esc(row.image_url)+'" alt="" loading="lazy" referrerpolicy="no-referrer">':'')+'</span>';
 }
 document.addEventListener('error',event=>{if(event.target.matches?.('.mt-product-image img'))event.target.remove();},true);
 function card(row,index,ctx){
  const {esc,money,button,brand,canWrite}=ctx;
  const cost=row.cost_minor==null?'Custo a configurar':'Custo por unidade · '+money(row.cost_minor,row.currency);
  const origin=brand.name(row.provider)+(row.store?' · '+row.store:'');
  const compare=row.compare_minor>row.price_minor?'<del>'+esc(money(row.compare_minor,row.currency))+'</del>':'';
  return '<li class="mt-product-card"><div class="mt-product-ident">'+image(row,esc)+'<div><small class="mt-product-origin">'+esc(origin)+'</small><h2>'+esc(row.name)+'</h2>'+
   '<small>'+esc(row.sku?'SKU '+row.sku:'ID '+row.product_id)+'</small></div></div>'+
   (row.price_minor!=null?'<div class="mt-product-price"><strong>'+esc(money(row.price_minor,row.currency))+'</strong>'+compare+'</div>':'')+
   '<div class="mt-product-foot"><small class="'+(row.cost_minor==null?'':'mt-product-has-cost')+'">'+esc(cost)+'</small>'+
   (canWrite?'<div class="mt-product-actions">'+button('Configurar custo','catalog-cost','data-index="'+index+'"')+
    (row.editable?button('Editar produto','catalog-edit','data-index="'+index+'"'):'')+'</div>':'')+'</div></li>';
 }
 function emptyState(title,description,action=''){
  return '<section class="mt-catalog-empty">'+box+'<h2>'+title+'</h2><p>'+description+'</p>'+action+'</section>';
 }
 async function render(ctx){
  const {state,api,esc,button,paginate,canWrite,hasCheckout}=ctx;
  const w=state.workspace,query=state.search,page=state.page;
  const result=await api('/catalog',null,{search:query});
  if(state.workspace!==w||state.search!==query||state.page!==page)return '';
  if(!result.rows.length&&page>1){state.page=Math.max(1,Math.ceil(result.total/24));return render(ctx);}
  if(workspace!==w){workspace=w;syncMessage='';syncing=false;}
  items=result.rows;sources=result.sources;
  const needsConnection=!query&&!result.total&&!hasCheckout&&!sources.length;
  const integrationsButton=canWrite?button('Abrir integrações','setup-checkouts','',needsConnection):'';
  if(needsConnection){
   return emptyState('Conecte sua plataforma de vendas',
    'Escolha seu checkout, gateway de pagamento ou API de pedidos para trazer seus produtos e configurar o custo de cada um.',
    integrationsButton);
  }
  const needsAuthorization=sources.some(s=>!s.synced_at);
  const hint=needsAuthorization?'Autorize a Cartpanda para importar fotos, preços e produtos sem pedidos.':
   'Os produtos de integrações sem catálogo são identificados pelos pedidos recebidos.';
  const emptyDescription=needsAuthorization?'Autorize o catálogo da loja conectada ou aguarde os primeiros pedidos.':
   sources.length?'Sincronize o catálogo da loja ou aguarde os primeiros pedidos da sua integração.':
    'Os produtos aparecerão aqui assim que a sua integração enviar os primeiros pedidos.';
  const emptyAction=sources.length&&canWrite?button('Abrir catálogo Cartpanda','catalog-sources'):integrationsButton;
  return '<div class="mt-catalog-toolbar"><label class="mt-catalog-search">'+search+'<input id="tracking-search" type="search" maxlength="120" value="'+esc(query)+
   '" placeholder="Buscar produto" aria-label="Pesquisar produtos"></label>'+
   (canWrite?button(sync+'<span>'+(syncing?'Sincronizando…':'Sincronizar produtos')+'</span>','catalog-sync',(syncing?'disabled':''),true): '')+'</div>'+
   '<div class="mt-catalog-meta"><span>'+result.total+' '+(result.total===1?'produto':'produtos')+'</span>'+
   (sources.length&&canWrite?button('Catálogo Cartpanda','catalog-sources'):'')+'</div>'+
   '<p class="mt-catalog-status" id="catalog-status" role="status">'+esc(syncMessage||hint)+'</p>'+
   (items.length?'<ul class="mt-product-grid">'+items.map((row,i)=>card(row,i,ctx)).join('')+'</ul>':
    query?emptyState('Nenhum produto encontrado','Experimente outro nome, SKU ou ID.'):
     emptyState('Nenhum produto disponível',emptyDescription,emptyAction))+
   (result.total>24?paginate(result.total,24):'');
 }
 function connectDialog(ctx,id){
  const store=sources.find(row=>row.id===id);
  if(!store)throw new Error('Selecione uma loja Cartpanda conectada.');
  ctx.modal('Autorizar catálogo Cartpanda','<form class="form-grid mt-catalog-form" data-form="catalog-connect"><input type="hidden" name="integration" value="'+ctx.esc(id)+'">'+
   '<p class="wide">Informe o identificador e o token de API da loja <strong>'+ctx.esc(store.name)+'</strong>. Use a mesma loja que envia os pedidos para esta integração.</p>'+
   '<label>Identificador da loja<input name="slug" placeholder="minha-loja" required maxlength="80" autocapitalize="none"></label>'+
   '<label>Moeda dos preços<select name="currency">'+Object.keys(ctx.scale).map(c=>'<option>'+c+'</option>').join('')+'</select></label>'+
   '<label class="wide">Token de API<input name="token" type="password" required maxlength="2048" autocomplete="off"></label>'+
   '<label class="wide checkbox"><input type="checkbox" name="allow_edit" '+(store.allow_edit?'checked':'')+'>Permitir edição quando o token tiver acesso de escrita</label>'+
   '<button type="submit" class="primary wide">Autorizar e sincronizar</button>'+error+'</form>');
 }
 function sourceDialog(ctx){
  ctx.modal('Catálogo Cartpanda','<div class="mt-catalog-connections">'+sources.map(store=>
   '<div><span>'+ctx.brand.logo('cartpanda')+'</span><div><strong>'+ctx.esc(store.name)+'</strong><small>'+
   (store.synced_at?'Última sincronização '+ctx.esc(ctx.dt(store.synced_at)):'Aguardando autorização do catálogo')+'</small></div>'+
   ctx.button(store.synced_at?'Reconfigurar':'Autorizar','catalog-connect','data-id="'+ctx.esc(store.id)+'"')+'</div>').join('')+'</div>');
 }
 function priceInput(name,label,value,scale){
  const decimal=value==null?'':(value/10**scale).toFixed(scale).replace('.',',');
  return '<label>'+label+'<input name="'+name+'" inputmode="decimal" value="'+decimal+'" maxlength="18" placeholder="0,00"></label>';
 }
 function descriptionText(html){
  const template=document.createElement('template');
  template.innerHTML=html.replace(/<br\s*\/?>|<\/p>/gi,'\n');
  return template.content.textContent;
 }
 async function action(name,el,ctx){
  if(!ctx.canWrite||!onPage(ctx))return;
  const w=ctx.state.workspace;
  if(name==='catalog-sources')return sourceDialog(ctx);
  if(name==='catalog-connect')return connectDialog(ctx,el.dataset.id);
  if(name==='catalog-sync'){
   if(syncing)return;
   syncing=true;syncMessage='Sincronizando produtos…';
   if($('catalog-status'))$('catalog-status').textContent=syncMessage;
   try{
    const stores=sources.filter(s=>s.synced_at);
    const results=await Promise.allSettled(stores.map(s=>ctx.edge('catalog_sync',{integration:s.id})));
    if(!onPage(ctx)||ctx.state.workspace!==w)return;
    const messages=results.map((result,i)=>result.status==='fulfilled'?
     stores[i].name+' · Novos '+result.value.added+', atualizados '+result.value.updated+', removidos '+result.value.removed+'.':
     stores[i].name+' · '+(result.reason?.message||'A sincronização falhou.'));
    syncMessage=['Produtos dos pedidos recebidos atualizados.',...messages,
     sources.some(s=>!s.synced_at)?'Autorize o catálogo das lojas pendentes para trazer todos os produtos da Cartpanda.':''].filter(Boolean).join(' ');
   }finally{
    if(workspace===w)syncing=false;
   }
   if(onPage(ctx)&&ctx.state.workspace===w)await ctx.render();
   return;
  }
  const row=items[Number(el.dataset.index)];
  if(!row)return;
  if(name==='catalog-cost'){
   const rules=await ctx.api('/costs');
   if(!onPage(ctx)||ctx.state.workspace!==w)return;
   const current=rules.filter(r=>!r.archived_at&&!r.effective_until&&r.category==='product'&&r.product_id===row.product_id&&r.provider===row.provider&&r.currency===row.currency).at(-1);
   return ctx.costForm(current,null,row);
  }
  if(name==='catalog-edit'&&row.editable){
   const product=await ctx.edge('catalog_detail',{integration:row.integration_id,product_id:row.product_id});
   if(!onPage(ctx)||ctx.state.workspace!==w)return;
   const ids={integration:row.integration_id,product_id:row.product_id,revision:product.revision,version:product.version,currency:product.currency};
   ctx.modal('Editar produto na Cartpanda','<form class="form-grid mt-catalog-form" data-form="catalog-edit">'+
    Object.entries(ids).map(([k,v])=>'<input type="hidden" name="'+k+'" value="'+ctx.esc(v)+'">').join('')+
    '<label class="wide">Nome<input name="name" value="'+ctx.esc(product.name)+'" required maxlength="255"></label>'+
    (product.has_variants?'<p class="wide">Os preços deste produto são definidos por variação no painel da Cartpanda.</p>':
     priceInput('price','Preço · '+product.currency,product.price_minor,ctx.scale[product.currency])+priceInput('compare','Preço de comparação',product.compare_minor,ctx.scale[product.currency]))+
    '<label class="wide">Descrição<textarea name="description" maxlength="12000" rows="5">'+ctx.esc(descriptionText(product.description))+'</textarea></label>'+
    '<p class="wide">As alterações serão publicadas na loja conectada.</p><button type="submit" class="primary wide">Salvar na Cartpanda</button>'+error+'</form>');
   const form=$('dialog-content').querySelector('[data-form="catalog-edit"]');
   for(const input of form.elements){if(input.name)input.dataset.original=input.value;}
  }
 }
 async function submit(type,form,data,ctx){
  const w=ctx.state.workspace;
  if(!ctx.canWrite||!onPage(ctx))return;
  if(type==='catalog-connect'){
   await ctx.edge('catalog_connect',{...data,allow_edit:form.elements.allow_edit.checked});
   if(!onPage(ctx)||ctx.state.workspace!==w)return;
   form.reset();close();ctx.toast('Catálogo Cartpanda sincronizado.');
  }else{
   const {integration,product_id,revision,version,currency}=data,payload={integration,product_id,revision,version};
   for(const name of ['name','description']){
    if(form.elements[name].dataset.original!==data[name])payload[name]=data[name];
   }
   const convert=(name,key)=>{
    if(form.elements[name]&&form.elements[name].dataset.original!==data[name]){
     const amount=ctx.minorInput(data[name].trim(),ctx.scale[currency]);
     if(amount==null&&name==='price')throw new Error('Informe o preço do produto.');
     payload[key]=amount??0;
    }
   };
   convert('price','price_minor');convert('compare','compare_minor');
   await ctx.edge('catalog_update',payload);
   if(!onPage(ctx)||ctx.state.workspace!==w)return;
   close();ctx.toast('Produto atualizado na Cartpanda.');
  }
  if(onPage(ctx)&&ctx.state.workspace===w)await ctx.render();
 }
 window.MagemindTrackingProducts={render,action,submit};
})();
