import { metaAttribution, metaPurchaseAmount, metaRead } from './adapters.mjs';

const levels = {
  campaign: { api: 'campaign', id: 'campaign_id', edge: 'campaigns' },
  group: { api: 'adset', id: 'adset_id', edge: 'adsets' },
  ad: { api: 'ad', id: 'ad_id', edge: 'ads' }
};
const commonSettings = ['created_time', 'updated_time', 'status', 'effective_status'];
const budgets = ['daily_budget', 'lifetime_budget', 'budget_remaining', 'bid_strategy', 'start_time'];
const settings = {
  campaign: [...commonSettings, ...budgets, 'stop_time', 'spend_cap', 'objective', 'buying_type', 'special_ad_categories'],
  group: [...commonSettings, ...budgets, 'end_time', 'bid_amount', 'billing_event', 'optimization_goal', 'attribution_spec', 'destination_type'],
  ad: [...commonSettings, 'ad_review_feedback', 'conversion_domain']
};
const baseMetrics = ['spend', 'impressions', 'clicks', 'actions', 'action_values'];
const metricName = /^[a-z][a-z0-9_]{1,79}$/;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function metaColumnRequest(input) {
  const { account_id: accountId, level, from, to } = input;
  if (!/^act_\d{1,24}$/.test(accountId) || !Object.hasOwn(levels, level) ||
      !validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 1125 * 86400000) {
    throw new Error('Conta, nível ou período inválido para o relatório da Meta.');
  }
  const fields = input.fields ?? [];
  const configuration = input.settings ?? [];
  if (!Array.isArray(fields) || fields.length > 260 || fields.some(field => typeof field !== 'string' || !metricName.test(field)) ||
      !Array.isArray(configuration) || configuration.length > 30 || configuration.some(field => typeof field !== 'string' || !metricName.test(field))) {
    throw new Error('Seleção de métricas da Meta inválida.');
  }
  return { accountId, level, from, to, fields: [...new Set(fields)],
    settings: [...new Set(configuration)].filter(field => settings[level].includes(field)),
    includeConversions: input.include_conversions === true };
}

function safeValue(value, depth = 0) {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 240);
  if (!value || depth >= 4) return null;
  if (Array.isArray(value)) return value.slice(0, 160).map(item => safeValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 40)
    .filter(([key]) => /^[\w.:-]{1,100}$/.test(key) && !/token|secret|authorization/i.test(key))
    .map(([key, item]) => [key, safeValue(item, depth + 1)]));
}

async function metaPages(read, config, path, params) {
  const rows = [];
  const cursors = new Set();
  let after;
  do {
    const response = await read(config, path, { ...params, limit: '200', ...(after ? { after } : {}) });
    if (!Array.isArray(response.data)) throw new Error('Invalid Meta report page');
    rows.push(...response.data);
    if (!response.paging?.next) return rows;
    after = response.paging.cursors?.after;
    if (!after || cursors.has(after) || cursors.size >= 29) throw new Error('Incomplete Meta report');
    cursors.add(after);
  } while (after);
}

async function optionalFields(fields, query, publish) {
  const available = [];
  const queue = [];
  for (let offset = 0; offset < fields.length; offset += 32) queue.push(fields.slice(offset, offset + 32));
  const deadline = Date.now() + 24000;
  for (let attempt = 0; queue.length && attempt < 15 && Date.now() < deadline; attempt++) {
    const group = queue.shift();
    try {
      publish(await query(group), group);
      available.push(...group);
    } catch (error) {
      if (Number(error?.providerCode) !== 100) break;
      if (group.length === 1) continue;
      const detail = String(error?.providerDetail || '');
      const named = group.find(field => new RegExp('(^|[^a-z0-9_])' + field + '([^a-z0-9_]|$)', 'i').test(detail));
      if (named) queue.unshift(group.filter(field => field !== named));
      else {
        const middle = Math.ceil(group.length / 2);
        queue.unshift(group.slice(0, middle), group.slice(middle));
      }
    }
  }
  return available;
}

export async function metaColumnReport(config, request, read = metaRead) {
  const { accountId, level, from, to, fields, settings: configuration, includeConversions } = request;
  const { api, id, edge } = levels[level];
  const insightRows = group => metaPages(read, config, accountId + '/insights', {
    fields: [id, ...group].join(','), level: api, time_increment: 'all_days',
    time_range: JSON.stringify({ since: from, until: to }), ...metaAttribution
  });
  const configurationRows = group => metaPages(read, config, accountId + '/' + edge, { fields: ['id', ...group].join(',') });
  const byEntity = new Map();
  function publish(rows, fields, target, idField) {
    for (const row of rows) {
      const entityId = String(row[idField] ?? '');
      if (!/^\d{1,40}$/.test(entityId)) continue;
      if (!byEntity.has(entityId)) byEntity.set(entityId, { entity_id: entityId, insights: {}, settings: {} });
      const entity = byEntity.get(entityId);
      if (target === 'settings') entity.has_settings = true;
      const entry = entity[target];
      for (const field of fields) if (Object.hasOwn(row, field)) entry[field] = safeValue(row[field]);
    }
  }
  const [core, extra, configured, conversions] = await Promise.all([
    insightRows(baseMetrics),
    optionalFields(fields.filter(field => !baseMetrics.includes(field) && field !== id), insightRows,
      (rows, group) => publish(rows, group, 'insights', id)),
    optionalFields(configuration, configurationRows, (rows, group) => publish(rows, group, 'settings', 'id')),
    includeConversions ? metaPages(read, config, accountId + '/customconversions', { fields: 'id,name,is_archived,is_unavailable' })
      .then(rows => rows.filter(row => /^\d{1,40}$/.test(String(row.id)) && row.name && !row.is_archived && !row.is_unavailable)
        .map(row => ({ id: String(row.id), name: String(row.name).trim().slice(0, 140) })))
      .catch(() => []) : []
  ]);
  publish(core, baseMetrics, 'insights', id);
  for (const row of byEntity.values()) {
    const actions = row.insights.actions;
    row.purchases = metaPurchaseAmount(actions) ?? (Array.isArray(actions) ? 0 : null);
    row.purchase_value = metaPurchaseAmount(row.insights.action_values);
  }
  return { rows: [...byEntity.values()], fields: [...baseMetrics, ...extra], settings: configured, conversions };
}
