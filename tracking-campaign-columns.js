(() => {
  'use strict';

  const minWidth = 90;
  const maxWidth = 520;
  const desktop = matchMedia('(min-width: 901px) and (pointer: fine)');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
  const groups = ['Resultados', 'Tráfego e entrega', 'Conversões', 'Interações e vídeo', 'Configurações', 'Eventos da conta', 'Mais métricas da Meta'];
  const defaults = ['status','name','spend_minor','network_purchases','cpa','budget','add_to_cart','impressions','clicks','ctr'];
  const scales = { BRL: 2, USD: 2, EUR: 2, JPY: 0, KWD: 3 };
  const currencyOf = row => row.account_currency || 'BRL';
  const units = row => 10 ** (scales[currencyOf(row)] ?? 2);
  const amount = value => value == null || value === '' || typeof value === 'object' || typeof value === 'boolean' ||
    !Number.isFinite(Number(value)) ? null : Number(value);
  const ratio = (top, bottom, factor = 1) => top != null && bottom > 0 ? top * factor / bottom : null;
  const width = (value, fallback = 146) => Number.isFinite(Number(value)) && value != null && value !== '' ?
    Math.max(minWidth, Math.min(maxWidth, Math.round(Number(value)))) : fallback;

  const base = [
    { key:'status', label:'Veiculação', group:'Configurações', kind:'status', width:108 },
    { key:'name', label:'Campanha', group:'Configurações', kind:'name', width:216, required:true },
    { key:'spend_minor', label:'Valor gasto', group:'Resultados', kind:'minor', width:119, total:'sum' },
    { key:'network_purchases', label:'Vendas (Meta)', group:'Resultados', kind:'number', width:118, total:'sum',
      description:'Compras atribuídas pela Meta no período selecionado.' },
    { key:'cpa', label:'CPA', group:'Resultados', kind:'minor', width:101, total:'purchase_cost',
      description:'Valor gasto dividido pelas compras atribuídas pela Meta.' },
    { key:'budget', label:'Orçamento', group:'Configurações', kind:'budget', width:123,
      settings:['daily_budget','lifetime_budget'] },
    { key:'impressions', label:'Impressões', group:'Tráfego e entrega', kind:'number', width:110, total:'sum' },
    { key:'clicks', label:'Cliques (todos)', group:'Tráfego e entrega', kind:'number', width:122, total:'sum' },
    { key:'ctr', label:'CTR (todos)', group:'Tráfego e entrega', kind:'percent', width:107, total:'click_rate' },
    { key:'purchase_value', label:'Valor das compras (Meta)', group:'Resultados', kind:'money', total:'sum',
      description:'Valor de conversão reportado pela Meta na moeda da conta.' },
    { key:'roas', label:'ROAS de compras (Meta)', group:'Resultados', kind:'multiple', total:'purchase_roas' },
    { key:'checkout_purchases', label:'Vendas do checkout atribuídas', group:'Resultados', kind:'number', total:'sum',
      description:'Pedidos aprovados que a Magemind conseguiu associar a este anúncio ou nível.' },
    { key:'checkout_cpa', label:'CPA do checkout', group:'Resultados', kind:'minor', total:'checkout_cost' },
    { key:'account_name', label:'Conta de anúncios', group:'Configurações', kind:'text', width:195 },
    { key:'account_currency', label:'Moeda da conta', group:'Configurações', kind:'text' },
    { key:'entity_id', label:'ID do item', group:'Configurações', kind:'text', width:180 },
    { key:'campaign_name', label:'Nome da campanha', group:'Configurações', kind:'text', width:220 },
    { key:'group_name', label:'Nome do conjunto', group:'Configurações', kind:'text', width:220 },
    { key:'campaign_id', label:'ID da campanha', group:'Configurações', kind:'text', width:190 },
    { key:'group_id', label:'ID do conjunto', group:'Configurações', kind:'text', width:190 }
  ];

  const direct = [
    ['Resultados','results','Resultados','stat'],
    ['Resultados','cost_per_result','Custo por resultado','money'],
    ['Resultados','result_rate','Taxa de resultados','percent'],
    ['Resultados','objective_results','Resultados do objetivo','stat'],
    ['Resultados','cost_per_objective_result','Custo por resultado do objetivo','money'],
    ['Resultados','objective_result_rate','Taxa de resultados do objetivo','percent'],
    ['Resultados','website_purchase_roas','ROAS de compras no site','multiple'],
    ['Resultados','mobile_app_purchase_roas','ROAS de compras no app','multiple'],
    ['Resultados','average_purchases_conversion_value','Valor médio por compra','money'],
    ['Tráfego e entrega','reach','Alcance','number'],
    ['Tráfego e entrega','frequency','Frequência','number'],
    ['Tráfego e entrega','inline_link_clicks','Cliques no link','number','sum'],
    ['Tráfego e entrega','unique_inline_link_clicks','Cliques únicos no link','number'],
    ['Tráfego e entrega','outbound_clicks','Cliques de saída','number','sum'],
    ['Tráfego e entrega','unique_outbound_clicks','Cliques de saída únicos','number'],
    ['Tráfego e entrega','inline_link_click_ctr','CTR do link','percent'],
    ['Tráfego e entrega','outbound_clicks_ctr','CTR de saída','percent'],
    ['Tráfego e entrega','unique_clicks','Cliques únicos (todos)','number'],
    ['Tráfego e entrega','unique_ctr','CTR único (todos)','percent'],
    ['Tráfego e entrega','cpc','CPC (todos)','money'],
    ['Tráfego e entrega','cost_per_inline_link_click','CPC do link','money'],
    ['Tráfego e entrega','cost_per_outbound_click','Custo por clique de saída','money'],
    ['Tráfego e entrega','cpm','CPM','money'],
    ['Tráfego e entrega','cpp','Custo por mil pessoas alcançadas','money'],
    ['Tráfego e entrega','quality_ranking','Classificação de qualidade','text'],
    ['Tráfego e entrega','engagement_rate_ranking','Classificação de engajamento','text'],
    ['Tráfego e entrega','conversion_rate_ranking','Classificação de conversão','text'],
    ['Interações e vídeo','inline_post_engagement','Engajamento com a publicação','number','sum'],
    ['Interações e vídeo','instagram_profile_visits','Visitas ao perfil do Instagram','number','sum'],
    ['Interações e vídeo','video_play_actions','Reproduções de vídeo','number','sum'],
    ['Interações e vídeo','video_continuous_2_sec_watched_actions','Vídeo de 2 segundos contínuos','number','sum'],
    ['Interações e vídeo','video_15_sec_watched_actions','Reproduções de 15 segundos','number','sum'],
    ['Interações e vídeo','video_30_sec_watched_actions','Reproduções de 30 segundos','number','sum'],
    ['Interações e vídeo','video_thruplay_watched_actions','ThruPlays','number','sum'],
    ['Interações e vídeo','cost_per_thruplay','Custo por ThruPlay','money'],
    ['Interações e vídeo','video_avg_time_watched_actions','Tempo médio de vídeo','seconds'],
    ['Interações e vídeo','video_p25_watched_actions','Vídeo visto a 25%','number','sum'],
    ['Interações e vídeo','video_p50_watched_actions','Vídeo visto a 50%','number','sum'],
    ['Interações e vídeo','video_p75_watched_actions','Vídeo visto a 75%','number','sum'],
    ['Interações e vídeo','video_p95_watched_actions','Vídeo visto a 95%','number','sum'],
    ['Interações e vídeo','video_p100_watched_actions','Vídeo visto a 100%','number','sum'],
    ['Configurações','attribution_setting','Configuração de atribuição','text'],
    ['Configurações','optimization_goal','Meta de otimização','text'],
    ['Configurações','objective','Objetivo','text'],
    ['Configurações','creative_media_type','Formato do criativo','text'],
    ['Configurações','buying_type','Tipo de compra de mídia','text']
  ];
  const configuration = [
    ['daily_budget','Orçamento diário','minor'], ['lifetime_budget','Orçamento total','minor'],
    ['budget_remaining','Orçamento restante','minor'], ['spend_cap','Limite de gastos','minor'],
    ['bid_strategy','Estratégia de lance','text'], ['bid_amount','Valor do lance','minor'],
    ['start_time','Início da programação','date'], ['end_time','Fim da programação','date'],
    ['created_time','Criação','date'], ['updated_time','Última edição','date'],
    ['effective_status','Status de entrega (Meta)','text'], ['billing_event','Evento de cobrança','text'],
    ['destination_type','Destino da conversão','text'], ['conversion_domain','Domínio da conversão','text'],
    ['attribution_spec','Janelas de atribuição','stat'], ['special_ad_categories','Categorias especiais','text']
  ];
  const actions = [
    ['website_purchase','Compras no site',['offsite_conversion.fb_pixel_purchase']],
    ['app_purchase','Compras no app',['app_custom_event.fb_mobile_purchase']],
    ['onsite_purchase','Compras na Meta',['onsite_conversion.purchase']],
    ['offline_purchase','Compras offline',['offline_conversion.purchase']],
    ['add_to_cart','Adições ao carrinho',['omni_add_to_cart','add_to_cart','offsite_conversion.fb_pixel_add_to_cart']],
    ['website_add_to_cart','Adições ao carrinho no site',['offsite_conversion.fb_pixel_add_to_cart']],
    ['app_add_to_cart','Adições ao carrinho no app',['app_custom_event.fb_mobile_add_to_cart']],
    ['checkout_started','Finalizações de compra iniciadas',['omni_initiated_checkout','initiate_checkout','offsite_conversion.fb_pixel_initiate_checkout']],
    ['website_checkout','Finalizações iniciadas no site',['offsite_conversion.fb_pixel_initiate_checkout']],
    ['payment_info','Dados de pagamento adicionados',['omni_add_payment_info','add_payment_info','offsite_conversion.fb_pixel_add_payment_info']],
    ['landing_page','Visualizações da página de destino',['landing_page_view']],
    ['content_views','Visualizações de conteúdo',['omni_view_content','view_content','offsite_conversion.fb_pixel_view_content']],
    ['leads','Leads',['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead']],
    ['website_leads','Leads no site',['offsite_conversion.fb_pixel_lead']],
    ['form_leads','Leads de formulário',['leadgen_grouped','onsite_conversion.lead_grouped']],
    ['registrations','Cadastros concluídos',['omni_complete_registration','offsite_conversion.fb_pixel_complete_registration']],
    ['searches','Pesquisas',['omni_search','offsite_conversion.fb_pixel_search']],
    ['wishlist','Adições à lista de desejos',['offsite_conversion.fb_pixel_add_to_wishlist']],
    ['subscriptions','Assinaturas',['subscribe','offsite_conversion.fb_pixel_subscribe']],
    ['started_trials','Testes iniciados',['start_trial','offsite_conversion.fb_pixel_start_trial']],
    ['app_installs','Instalações de app',['omni_app_install','mobile_app_install']],
    ['app_activations','Ativações de app',['omni_activate_app','app_custom_event.fb_mobile_activate_app']],
    ['messages','Conversas por mensagem iniciadas',['onsite_conversion.messaging_conversation_started_7d']],
    ['new_messages','Novos contatos por mensagem',['onsite_conversion.messaging_first_reply']],
    ['calls','Chamadas realizadas',['click_to_call_native_call_placed']],
    ['reactions','Reações à publicação',['post_reaction']],
    ['comments','Comentários',['comment']],
    ['shares','Compartilhamentos',['post']],
    ['saves','Salvamentos',['onsite_conversion.post_save']],
    ['page_likes','Curtidas na página',['like']],
    ['page_engagement','Engajamento com a página',['page_engagement']]
  ];

  // Fields exposed by AdsInsights in Meta's Business SDK 25.0.0. Availability
  // still depends on the connected account, report level and attribution.
  const sdkFields = `
    account_currency account_id account_name action_values actions
    ad_click_actions ad_id ad_impression_actions ad_name adset_end
    adset_id adset_name adset_start advanced_actions_28d_view advanced_reach_1d_lookback
    advanced_reach_28d_lookback advanced_reach_7d_lookback age_targeting anchor_event_attribution_setting anchor_events_performance_indicator
    attribution_setting auction_bid auction_competitiveness auction_max_competitor_bid average_purchases_conversion_value
    buying_type campaign_id campaign_name canvas_avg_view_percent canvas_avg_view_time
    catalog_segment_actions catalog_segment_value catalog_segment_value_mobile_purchase_roas catalog_segment_value_omni_purchase_roas catalog_segment_value_website_purchase_roas
    clicks conversion_lead_rate conversion_leads conversion_rate_ranking conversion_values
    conversions converted_product_app_custom_event_fb_mobile_purchase converted_product_app_custom_event_fb_mobile_purchase_value converted_product_offline_purchase converted_product_offline_purchase_value
    converted_product_omni_purchase converted_product_omni_purchase_values converted_product_quantity converted_product_value converted_product_website_pixel_purchase
    converted_product_website_pixel_purchase_value converted_promoted_product_app_custom_event_fb_mobile_purchase converted_promoted_product_app_custom_event_fb_mobile_purchase_value converted_promoted_product_offline_purchase converted_promoted_product_offline_purchase_value
    converted_promoted_product_omni_purchase converted_promoted_product_omni_purchase_values converted_promoted_product_quantity converted_promoted_product_value converted_promoted_product_website_pixel_purchase
    converted_promoted_product_website_pixel_purchase_value cost_per_15_sec_video_view cost_per_2_sec_continuous_video_view cost_per_action_type cost_per_ad_click
    cost_per_conversion cost_per_conversion_lead cost_per_dda_countby_convs cost_per_estimated_ad_recallers cost_per_inline_link_click
    cost_per_inline_post_engagement cost_per_objective_result cost_per_one_thousand_ad_impression cost_per_outbound_click cost_per_result
    cost_per_thruplay cost_per_unique_action_type cost_per_unique_click cost_per_unique_conversion cost_per_unique_inline_link_click
    cost_per_unique_outbound_click cpc cpm cpp created_time
    creative_media_type ctr date_start date_stop dda_countby_convs
    dda_results engagement_rate_ranking estimated_ad_recall_rate estimated_ad_recall_rate_lower_bound estimated_ad_recall_rate_upper_bound
    estimated_ad_recallers estimated_ad_recallers_lower_bound estimated_ad_recallers_upper_bound frequency full_view_impressions
    full_view_reach gender_targeting impressions inline_link_click_ctr inline_link_clicks
    inline_post_engagement instagram_profile_visits instagram_upcoming_event_reminders_set instant_experience_clicks_to_open instant_experience_clicks_to_start
    instant_experience_outbound_clicks interactive_component_tap labels landing_page_view_actions_per_link_click landing_page_view_per_link_click
    landing_page_view_per_purchase_rate link_clicks_per_results location marketing_messages_click_rate_benchmark marketing_messages_cost_per_delivered
    marketing_messages_cost_per_link_btn_click marketing_messages_delivered marketing_messages_delivery_rate marketing_messages_link_btn_click marketing_messages_link_btn_click_rate
    marketing_messages_media_view_rate marketing_messages_phone_call_btn_click_rate marketing_messages_quick_reply_btn_click marketing_messages_quick_reply_btn_click_rate marketing_messages_read
    marketing_messages_read_rate marketing_messages_read_rate_benchmark marketing_messages_sent marketing_messages_spend marketing_messages_spend_currency
    marketing_messages_website_add_to_cart marketing_messages_website_initiate_checkout marketing_messages_website_purchase marketing_messages_website_purchase_values mobile_app_purchase_roas
    multi_event_conversion_attribution_setting objective objective_result_rate objective_results onsite_conversion_messaging_detected_purchase_deduped
    optimization_goal outbound_clicks outbound_clicks_ctr place_page_name product_group_retailer_id
    product_retailer_id product_views purchase_per_landing_page_view purchase_roas purchases_per_link_click
    qualifying_question_qualify_answer_rate quality_ranking reach result_rate result_values_performance_indicator
    results shops_assisted_purchases social_spend spend total_card_view
    total_postbacks total_postbacks_detailed total_postbacks_detailed_v4 unique_actions unique_clicks
    unique_conversions unique_ctr unique_inline_link_click_ctr unique_inline_link_clicks unique_link_clicks_ctr
    unique_outbound_clicks unique_outbound_clicks_ctr unique_video_continuous_2_sec_watched_actions unique_video_view_15_sec updated_time
    video_15_sec_watched_actions video_30_sec_watched_actions video_avg_time_watched_actions video_continuous_2_sec_watched_actions video_p100_watched_actions
    video_p25_watched_actions video_p50_watched_actions video_p75_watched_actions video_p95_watched_actions video_play_actions
    video_play_curve_actions video_play_retention_0_to_15s_actions video_play_retention_20_to_60s_actions video_play_retention_graph_actions video_thruplay_watched_actions
    video_time_watched_actions video_view_per_impression website_ctr website_purchase_roas wish_bid`.trim().split(/\s+/);

  const metric = (key, label, group, field, kind, total, actionTypes) =>
    ({ key, label, group, field, kind, total, actionTypes });
  const known = [
    ...direct.map(([group,field,label,kind,total]) => metric(field,label,group,field,kind,total)),
    ...configuration.map(([field,label,kind]) => ({ key:'config_'+field,label,group:'Configurações',kind,
      settings:field==='end_time'?['end_time','stop_time']:[field] })),
    ...actions.flatMap(([key,label,types]) => {
      const group = ['reactions','comments','shares','saves','page_likes','page_engagement'].includes(key) ? 'Interações e vídeo' : 'Conversões';
      return [
        { ...metric(key,label,group,'actions','number','sum',types), ...(key==='add_to_cart'?{width:144}:{}) },
        { ...metric('cost_'+key,'Custo por '+label.toLowerCase(),group,'actions','money',null,types), perAction:true },
        metric('value_'+key,'Valor · '+label,group,'action_values','money','sum',types),
        metric('unique_'+key,'Únicos · '+label,group,'unique_actions','number',null,types)
      ];
    })
  ];
  const previouslyListed = new Set([
    ...known.filter(item => item.key === item.field).map(item => item.field),
    'spend','impressions','clicks','ctr','account_name','account_currency','campaign_id','campaign_name','adset_id','adset_name'
  ]);
  const fieldLabel = field => String(field).replaceAll('_',' ').replace(/^./, char => char.toUpperCase());
  const generic = sdkFields.filter(field => !previouslyListed.has(field)).map(field => metric(
    'meta_'+field, fieldLabel(field), 'Mais métricas da Meta', field,
    /^cost_|_spend$|_purchase_values?$/.test(field) ? 'money' : /_ctr$|_rate$|_percent$/.test(field) ? 'percent' : /roas$/.test(field) ? 'multiple' : 'stat'
  ));
  const canonicalActionTypes = new Set(actions.flatMap(action => action[2]));
  const customActionId = code => /^(?:offsite_conversion\.)?custom[._](\d+)$/.exec(code)?.[1];
  const actionName = code => {
    code = String(code);
    const id = customActionId(code);
    return id ? 'Conversão personalizada '+id : fieldLabel(code.replace(/^offsite_conversion\.fb_pixel_|^app_custom_event\.fb_mobile_|^onsite_conversion\./,''));
  };
  const dynamicSources = { actions:'', action_values:'Valor · ', unique_actions:'Únicos · ', cost_per_action_type:'Custo · ' };
  const eventId = /^event:(actions|action_values|unique_actions|cost_per_action_type):([a-zA-Z0-9_.:-]{1,110})$/;
  function dynamicMetric(field, type, name) {
    return metric('event:'+field+':'+type, dynamicSources[field]+(name||actionName(type)), 'Eventos da conta', field,
      ['action_values','cost_per_action_type'].includes(field)?'money':'number',
      ['actions','action_values'].includes(field)?'sum':null,[type]);
  }

  function catalog(title, rows, saved = [], conversions = []) {
    const map = new Map([...base.map(item => item.key === 'name' ? { ...item, label:title } : item), ...known, ...generic].map(item => [item.key,item]));
    const names = new Map(conversions.map(conversion => [conversion.id, conversion.name]));
    function addEvent(type) {
      const custom = customActionId(type);
      for (const variant of Object.keys(dynamicSources)) {
        if (custom && variant==='unique_actions') continue;
        const column = dynamicMetric(variant,type,names.get(custom));
        map.set(column.key,column);
      }
    }
    for (const id of names.keys()) addEvent('offsite_conversion.custom.'+id);
    for (const row of rows) {
      for (const field of Object.keys(dynamicSources)) {
        const values = row.meta?.insights?.[field];
        for (const item of Array.isArray(values)?values:[]) {
          const type = item?.action_type;
          if (!/^[a-zA-Z0-9_.:-]{1,110}$/.test(type || '') || canonicalActionTypes.has(type)) continue;
          // A discovered conversion remains selectable even when the report period changes.
          addEvent(type);
        }
      }
    }
    for (const key of saved) {
      const match = eventId.exec(key);
      if (match && !map.has(key)) map.set(key,dynamicMetric(match[1],match[2],names.get(customActionId(match[2]))));
    }
    return map;
  }

  function load(userId, workspace) {
    const storage = 'mm_meta_campaign_columns_v1:'+userId+':'+workspace;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storage)); } catch { /* Browser storage is optional. */ }
    const order = Array.isArray(saved?.order) ? [...new Set(saved.order.filter(key => typeof key === 'string' && /^[\w.:-]{1,145}$/.test(key)))] : defaults.slice();
    if (!order.includes('name')) order.unshift('name');
    const sizes = Object.fromEntries(order.flatMap(key => {
      const stored = saved?.sizes?.[key];
      return amount(stored) != null ? [[key,width(stored)]] : [];
    }));
    return { storage, order, sizes };
  }

  function save(layout) {
    try { localStorage.setItem(layout.storage,JSON.stringify({ order:layout.order, sizes:layout.sizes })); }
    catch { /* Keep the preference for the open app even if the browser refuses to save it. */ }
  }

  function columns(layout, registry) {
    return layout.order.flatMap(key => registry.has(key) ? [registry.get(key)] : []);
  }

  function reportFields(selected) {
    return {
      fields:[...new Set(selected.flatMap(column => column.field ? [column.field] : []))].sort(),
      settings:[...new Set(selected.flatMap(column => column.settings || []))].sort()
    };
  }

  function actionValue(list, keys) {
    if (!Array.isArray(list)) return null;
    for (const key of keys) {
      const entry = list.find(item => item?.action_type === key && amount(item.value) != null);
      if (entry) return amount(entry.value);
    }
    return null;
  }

  function scalar(raw) {
    if (typeof raw === 'string' || typeof raw === 'number') return raw;
    if (Array.isArray(raw) && raw.length === 1) return scalar(raw[0]);
    if (raw && typeof raw === 'object') {
      if (typeof raw.value === 'string' || typeof raw.value === 'number') return raw.value;
      if (Array.isArray(raw.values) && raw.values.length === 1) return scalar(raw.values[0]);
    }
    return null;
  }

  const spend = row => {
    const live = amount(row.meta?.insights?.spend);
    return live == null ? amount(row.spend_minor) : Math.round(live * units(row));
  };
  const impressions = row => amount(row.meta?.insights?.impressions) ?? amount(row.impressions);
  const clicks = row => amount(row.meta?.insights?.clicks) ?? amount(row.clicks);
  const sales = row => amount(row.meta?.purchases) ?? amount(row.network_purchases);
  const purchaseValue = row => amount(row.meta?.purchase_value);

  function budget(row) {
    const daily = amount(row.meta?.settings?.daily_budget);
    const lifetime = amount(row.meta?.settings?.lifetime_budget);
    if (daily > 0) return { amount:daily, label:'Diário' };
    if (lifetime > 0) return { amount:lifetime, label:'Total' };
    const inherited = row.level === 'ad' ? 'No conjunto ou campanha' : row.meta?.has_settings ?
      (row.level === 'group' ? 'Na campanha' : 'Nos conjuntos') : null;
    return inherited ? { amount:null, label:inherited } : null;
  }

  function value(row,column) {
    const { key, field, actionTypes, kind } = column;
    if (key === 'spend_minor') return spend(row);
    if (key === 'network_purchases') return sales(row);
    if (key === 'impressions') return impressions(row);
    if (key === 'clicks') return clicks(row);
    if (key === 'ctr') return ratio(clicks(row),impressions(row),100);
    if (key === 'cpa') return ratio(spend(row),sales(row));
    if (key === 'purchase_value') return purchaseValue(row);
    if (key === 'roas') return ratio(purchaseValue(row),spend(row),units(row));
    if (key === 'checkout_cpa') return ratio(spend(row),amount(row.checkout_purchases));
    if (key === 'budget') return budget(row)?.amount ?? null;
    if (key === 'status') return row.effective_active ? 1 : 0;
    if (column.settings) {
      const result = row.meta?.settings?.[column.settings[0]] ??
        (column.settings[0] === 'end_time' ? row.meta?.settings?.stop_time : null);
      return kind === 'minor' ? amount(result) : result ?? null;
    }
    if (!field) return row[key] ?? null;
    const raw = row.meta?.insights?.[field];
    if (actionTypes) {
      const result = actionValue(raw,actionTypes);
      if (column.perAction) return ratio(spend(row),result,1/units(row));
      if (result != null) return result;
      return field === 'actions' && Array.isArray(raw) ? 0 : null;
    }
    if (kind === 'text' || kind === 'stat') return raw ?? null;
    return amount(scalar(raw)) ?? (Array.isArray(raw) && raw.length > 1 ? raw : null);
  }

  function formatMoney(value, currency, minor) {
    return new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(minor ? value / (10 ** (scales[currency] ?? 2)) : value);
  }

  function plainLabel(value) {
    const labels = { ACTIVE:'Ativa', PAUSED:'Pausada', ARCHIVED:'Arquivada', DELETED:'Excluída',
      OUTCOME_SALES:'Vendas', OUTCOME_TRAFFIC:'Tráfego', OUTCOME_LEADS:'Leads',
      OUTCOME_AWARENESS:'Reconhecimento', OUTCOME_ENGAGEMENT:'Engajamento', OUTCOME_APP_PROMOTION:'Promoção do app',
      ABOVE_AVERAGE:'Acima da média', AVERAGE:'Na média', BELOW_AVERAGE:'Abaixo da média',
      BELOW_AVERAGE_10:'Abaixo da média · 10%', BELOW_AVERAGE_20:'Abaixo da média · 20%', BELOW_AVERAGE_35:'Abaixo da média · 35%' };
    return Object.hasOwn(labels,value) ? labels[value] : String(value);
  }

  function display(value, kind, currency) {
    if (value == null) return '—';
    if (Array.isArray(value)) {
      const parts = value.flatMap(item => {
        const simple = scalar(item);
        if (simple != null) {
          const label = item?.indicator || item?.action_type;
          return [(label ? actionName(label)+': ' : '')+display(simple,kind,currency)];
        }
        if (item?.event_type && item?.window_days) return [item.window_days+' d · '+fieldLabel(item.event_type)];
        return [];
      });
      return parts.length ? parts.join(' · ') : '—';
    }
    if (typeof value === 'object') return display(scalar(value),kind,currency);
    if (kind === 'date') {
      const date = new Date(value);
      return Number.isFinite(+date) ? date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '—';
    }
    if (kind === 'text' || kind === 'name') return plainLabel(value);
    const n = amount(value);
    if (n == null) return plainLabel(value);
    if (kind === 'money' || kind === 'minor') return formatMoney(n,currency,kind==='minor');
    return number.format(n) + ({ percent:'%', multiple:'×', seconds:' s' }[kind] || '');
  }

  function formatted(row,column) {
    if (column.key === 'budget') {
      const entry = budget(row);
      return entry ? { text:entry.amount==null?entry.label:display(entry.amount,'minor',currencyOf(row)), detail:entry.amount==null?'':entry.label } : { text:'—' };
    }
    return { text:display(value(row,column),column.kind,currencyOf(row)) };
  }

  const usesCurrency = column => ['minor','money','budget','multiple'].includes(column.kind);
  function sum(rows, select) {
    const values = rows.map(select).map(amount).filter(value => value != null);
    return values.length ? values.reduce((a,b)=>a+b,0) : null;
  }
  function aggregatePair(rows, numerator, denominator, factor = 1) {
    const valid = rows.filter(row => numerator(row)!=null && denominator(row)!=null);
    return ratio(sum(valid,numerator),sum(valid,denominator),factor);
  }

  function total(rows,column) {
    if (!column.total) return [];
    const grouped = new Map();
    for (const row of rows) {
      const key = usesCurrency(column)?currencyOf(row):'';
      if (!grouped.has(key)) grouped.set(key,[]);
      grouped.get(key).push(row);
    }
    return [...grouped].sort(([a],[b])=>a.localeCompare(b)).flatMap(([currency,entries]) => {
      const result = {
        sum:()=>sum(entries,row=>value(row,column)),
        click_rate:()=>aggregatePair(entries,clicks,impressions,100),
        purchase_cost:()=>aggregatePair(entries,spend,sales),
        checkout_cost:()=>aggregatePair(entries,spend,row=>amount(row.checkout_purchases)),
        purchase_roas:()=>aggregatePair(entries,purchaseValue,spend,units(entries[0]))
      }[column.total]();
      return result==null?[]:[display(result,column.kind,currency||'BRL')];
    });
  }

  const geometry = (layout,column) => width(layout.sizes[column.key],column.width || 156);
  const adjustIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 5v14M15 5v14M3 9h18"/></svg>';

  function editor(modal,dialog,registry,original,onSave) {
    let draft = { ...original, order:columns(original,registry).map(column=>column.key), sizes:{ ...original.sizes } };
    modal('Personalizar colunas',
      '<div class="mt-column-editor"><div class="mt-column-layout">'+
      '<section class="mt-column-library" aria-label="Colunas disponíveis">'+
      '<div class="mt-column-searchbar"><label class="mt-column-search"><span class="sr-only">Buscar métricas</span>'+
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/></svg>'+
      '<input type="search" placeholder="Buscar métricas..." autocomplete="off" data-column-search></label>'+
      '<label class="mt-column-category"><span class="sr-only">Categoria</span><select data-column-category><option value="">Todas as categorias</option>'+
      groups.map(group=>'<option>'+esc(group)+'</option>').join('')+'</select></label></div>'+
      '<div class="mt-column-library-list" data-column-library></div></section>'+
      '<section class="mt-column-selected" aria-label="Colunas selecionadas"><header><h3 data-column-count></h3>'+
      '<p>Arraste para ordenar. Larguras em pixels.</p></header>'+
      '<ol class="mt-column-selected-list" data-column-selected></ol>'+
      '<span class="sr-only" role="status" data-column-message></span></section></div>'+
      '<footer class="mt-column-footer"><button type="button" class="quiet" data-column-editor-action="reset">Restaurar padrão</button>'+
      '<div><button type="button" class="quiet" data-column-editor-action="cancel">Cancelar</button>'+
      '<button type="button" class="primary" data-column-editor-action="apply">Aplicar colunas</button></div></footer></div>');

    const root = dialog.querySelector('.mt-column-editor');
    const library = root.querySelector('[data-column-library]');
    const selected = root.querySelector('[data-column-selected]');
    const search = root.querySelector('[data-column-search]');
    const category = root.querySelector('[data-column-category]');
    const count = root.querySelector('[data-column-count]');
    const message = root.querySelector('[data-column-message]');
    const opened = new Set(['Resultados','Conversões']);
    let dragKey = '';
    let marked = null;

    function renderLibrary() {
      const text = clean(search.value);
      const matches = [...registry.values()].filter(column =>
        (!category.value || column.group === category.value) &&
        (!text || clean([column.label,column.key,column.field,column.description,...(column.actionTypes||[])].join(' ')).includes(text))
      );
      library.innerHTML = matches.length ? groups.map(group => {
        const options = matches.filter(column => column.group === group);
        if (!options.length) return '';
        return '<details data-column-group="'+esc(group)+'" '+(text || category.value || opened.has(group) ? 'open' : '')+
          '><summary>'+esc(group)+'<span>'+options.length+'</span></summary><div class="mt-column-options">'+
          options.map(column => '<label class="mt-column-option" title="'+esc(column.description || column.field || column.label)+'">'+
            '<input type="checkbox" data-column-add="'+esc(column.key)+'" '+(draft.order.includes(column.key)?'checked ':'')+
            (column.required?'disabled ':'')+'><span>'+esc(column.label)+'</span></label>').join('')+'</div></details>';
      }).join('') : '<p class="mt-column-empty">Nenhuma métrica encontrada.</p>';
    }

    const moveUp = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 10 4-4 4 4"/></svg>';
    const moveDown = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
    const remove = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg>';
    const grip = '<svg viewBox="0 0 14 18" width="14" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1.2"/><circle cx="9" cy="4" r="1.2"/><circle cx="5" cy="9" r="1.2"/><circle cx="9" cy="9" r="1.2"/><circle cx="5" cy="14" r="1.2"/><circle cx="9" cy="14" r="1.2"/></svg>';

    function renderSelected() {
      count.textContent = draft.order.length + (draft.order.length===1?' coluna selecionada':' colunas selecionadas');
      selected.innerHTML = draft.order.map((key,index) => {
        const column = registry.get(key);
        const name = esc(column.label);
        return '<li data-column-item="'+esc(key)+'"><span class="mt-column-grip" draggable="true" title="Arrastar '+name+'">'+grip+'</span>'+
          '<span class="mt-column-item-name" title="'+name+'">'+name+'</span>'+
          '<input type="number" inputmode="numeric" min="'+minWidth+'" max="'+maxWidth+'" step="1" value="'+geometry(draft,column)+
          '" aria-label="Largura em pixels: '+name+'" data-column-width>'+
          '<div class="mt-column-order-buttons"><button type="button" data-column-editor-action="up" aria-label="Subir '+name+'" '+(index===0?'disabled':'')+'>'+moveUp+'</button>'+
          '<button type="button" data-column-editor-action="down" aria-label="Descer '+name+'" '+(index===draft.order.length-1?'disabled':'')+'>'+moveDown+'</button></div>'+
          '<button type="button" class="mt-column-remove" data-column-editor-action="remove" aria-label="Remover '+name+'" '+(column.required?'disabled title="Coluna obrigatória"':'')+'>'+remove+'</button></li>';
      }).join('');
    }

    function updateChecks() {
      for (const input of library.querySelectorAll('[data-column-add]')) input.checked = draft.order.includes(input.dataset.columnAdd);
    }

    function move(key, to, direction) {
      const from = draft.order.indexOf(key);
      if (from < 0 || to < 0 || to >= draft.order.length || from === to) return;
      draft.order.splice(from,1);
      draft.order.splice(to,0,key);
      renderSelected();
      message.textContent = registry.get(key).label+' movida para a posição '+(to+1)+'.';
      if (direction) {
        const row = [...selected.children].find(item=>item.dataset.columnItem===key);
        const control = row.querySelector('[data-column-editor-action="'+direction+'"]');
        (control.disabled?row.querySelector('[data-column-width]'):control).focus();
      }
    }

    search.addEventListener('input',renderLibrary);
    category.addEventListener('change',renderLibrary);
    library.addEventListener('toggle',event=>{
      const group=event.target.dataset?.columnGroup;
      if (!group || search.value || category.value) return;
      if (event.target.open) opened.add(group);
      else opened.delete(group);
    },true);
    library.addEventListener('change',event=>{
      const key=event.target.dataset.columnAdd;
      if (!key || registry.get(key).required) return;
      if (event.target.checked) draft.order.push(key);
      else draft.order=draft.order.filter(item=>item!==key);
      renderSelected();
    });
    selected.addEventListener('change',event=>{
      if (!event.target.matches('[data-column-width]')) return;
      const key=event.target.closest('[data-column-item]').dataset.columnItem;
      const size=width(event.target.value,geometry(draft,registry.get(key)));
      draft.sizes[key]=size;
      event.target.value=size;
    });
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-column-editor-action]');
      if (!button) return;
      const { columnEditorAction:action }=button.dataset;
      const row=button.closest('[data-column-item]');
      const key=row?.dataset.columnItem;
      if (action==='cancel') dialog.close();
      if (action==='apply') {
        for (const input of selected.querySelectorAll('[data-column-width]')) {
          const columnKey=input.closest('[data-column-item]').dataset.columnItem;
          draft.sizes[columnKey]=width(input.value,geometry(draft,registry.get(columnKey)));
        }
        dialog.close();
        onSave(draft);
      }
      if (action==='reset') {
        draft={ ...draft, order:defaults.slice(), sizes:{} };
        renderSelected();
        updateChecks();
        message.textContent='Colunas padrão restauradas.';
      }
      if (action==='remove' && key && !registry.get(key).required) {
        const index=draft.order.indexOf(key);
        draft.order=draft.order.filter(item=>item!==key);
        renderSelected();
        updateChecks();
        selected.children[Math.min(index,selected.children.length-1)]?.querySelector('[data-column-width]')?.focus();
        message.textContent=registry.get(key).label+' removida.';
      }
      if (action==='up'||action==='down') move(key,draft.order.indexOf(key)+(action==='up'?-1:1),action);
    });
    function clearMarker() {
      if (marked) marked.classList.remove('drop-before','drop-after');
      marked=null;
    }
    selected.addEventListener('dragstart',event=>{
      const grip=event.target.closest('.mt-column-grip');
      if (!grip) return;
      dragKey=grip.closest('[data-column-item]').dataset.columnItem;
      event.dataTransfer.setData('text/plain',dragKey);
      event.dataTransfer.effectAllowed='move';
    });
    selected.addEventListener('dragover',event=>{
      const target=event.target.closest('[data-column-item]');
      if (!dragKey || !target || target.dataset.columnItem===dragKey) return;
      event.preventDefault();
      event.dataTransfer.dropEffect='move';
      clearMarker();
      const bounds=target.getBoundingClientRect();
      marked=target;
      target.classList.add(event.clientY < bounds.top + bounds.height/2 ? 'drop-before':'drop-after');
    });
    selected.addEventListener('drop',event=>{
      if (!dragKey || !marked) return;
      event.preventDefault();
      const from=draft.order.indexOf(dragKey);
      const index=draft.order.indexOf(marked.dataset.columnItem)+(marked.classList.contains('drop-after')?1:0);
      move(dragKey,index-(from<index?1:0));
      clearMarker();
      dragKey='';
    });
    selected.addEventListener('dragend',()=>{clearMarker();dragKey='';});
    renderLibrary();
    renderSelected();
    search.focus({preventScroll:true});
  }

  function resizeColumn(handle,size) {
    const table=handle.closest('.mt-ad-table');
    const col=table?.querySelector('colgroup')?.children[Number(handle.dataset.columnIndex)];
    if (!col) return;
    const previous=Number(handle.getAttribute('aria-valuenow'));
    const next=width(size);
    const tableSize=parseFloat(table.style.width)+next-previous;
    table.style.width=tableSize+'px';
    table.style.minWidth=tableSize+'px';
    col.style.width=next+'px';
    handle.setAttribute('aria-valuenow',next);
    return next;
  }

  function pointerResize(event,handle,onSave) {
    if (event.button!==0 || !desktop.matches) return;
    event.preventDefault();
    const id=event.pointerId;
    const start=event.clientX;
    const original=Number(handle.getAttribute('aria-valuenow'));
    let current=original;
    handle.classList.add('is-resizing');
    handle.setPointerCapture(id);
    const move=evt=>{ if(evt.pointerId===id) current=resizeColumn(handle,original+evt.clientX-start); };
    function finish(evt) {
      if (evt.pointerId!==id) return;
      handle.classList.remove('is-resizing');
      handle.removeEventListener('pointermove',move);
      handle.removeEventListener('pointerup',finish);
      handle.removeEventListener('pointercancel',finish);
      if (evt.type==='pointercancel') resizeColumn(handle,original);
      else if (current!==original) onSave(handle.dataset.columnResize,current);
    }
    handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',finish);
    handle.addEventListener('pointercancel',finish);
  }

  function keyboardResize(event,handle,onSave) {
    if (!['ArrowLeft','ArrowRight'].includes(event.key) || !desktop.matches) return;
    event.preventDefault();
    const current=Number(handle.getAttribute('aria-valuenow'));
    const step=(event.shiftKey?32:8)*(event.key==='ArrowLeft'?-1:1);
    const size=resizeColumn(handle,current+step);
    if (size!==current) onSave(handle.dataset.columnResize,size);
  }

  window.MagemindCampaignColumns=Object.freeze({
    catalog,load,save,columns,reportFields,value,formatted,total,usesCurrency,geometry,
    editor,pointerResize,keyboardResize,desktop,adjustIcon,minWidth,maxWidth
  });
})();
