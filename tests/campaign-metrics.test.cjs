const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const adapters = import('../supabase/functions/_shared/tracking/adapters.mjs');
const reports = import('../supabase/functions/_shared/tracking/meta-column-report.mjs');
const action = (action_type,value) => ({action_type,value:String(value)});

test('Meta daily sync honors ad-set attribution and counts grouped purchases only once', async () => {
  const { metaPurchaseAmount, syncMeta } = await adapters;
  assert.equal(metaPurchaseAmount([action('omni_purchase',3),action('purchase',3),action('offsite_conversion.fb_pixel_purchase',2)]),3);
  assert.equal(metaPurchaseAmount([action('offsite_conversion.fb_pixel_purchase',2),action('onsite_conversion.purchase',1)]),3);
  assert.equal(metaPurchaseAmount([action('omni_purchase',0),action('offsite_conversion.fb_pixel_purchase',2)]),0);
  assert.equal(metaPurchaseAmount([action('omni_add_to_cart',9)]),null);
  const result = await syncMeta({version:'v25.0',access_token:'test-token'}, {account_id:'act_101',currency:'USD'},
    '2026-11-25','2026-11-25',async url => {
      assert.equal(url.searchParams.get('level'),'ad');
      assert.equal(url.searchParams.get('time_increment'),'1');
      assert.equal(url.searchParams.get('use_unified_attribution_setting'),'true');
      assert.equal(url.searchParams.get('action_report_time'),'impression');
      assert.equal(url.searchParams.has('action_attribution_windows'),false);
      return Response.json({data:[{ad_id:'101',ad_name:'Exemplo',spend:'32.50',date_start:'2026-11-25',
        actions:[action('omni_purchase',3),action('offsite_conversion.fb_pixel_purchase',2)],
        action_values:[action('omni_purchase',149.9),action('offsite_conversion.fb_pixel_purchase',100)]}]});
    });
  assert.equal(result[0].network_purchases,3);
  assert.equal(result[0].network_purchase_value_minor,14990);
  assert.equal(result[0].spend_minor,3250);
});

test('Meta period reports keep campaign-level metrics and isolate unavailable columns', async () => {
  const { metaColumnReport, metaColumnRequest } = await reports;
  const input = {account_id:'act_101',level:'campaign',from:'2026-11-20',to:'2026-11-26',
    fields:['reach','video_p50_watched_actions','unsupported_metric'],settings:['daily_budget','start_time','ad_review_feedback'],include_conversions:true};
  const config = metaColumnRequest(input);
  assert.throws(()=>metaColumnRequest({...input,fields:['actions{access_token}']}),/inválida/);
  assert.throws(()=>metaColumnRequest({...input,from:'2026-11-31'}),/inválido/);
  const requestFields = [];
  const data = await metaColumnReport({},config,async (_config,endpoint,params) => {
    if (endpoint.endsWith('/customconversions')) return {data:[{id:'901',name:'Pedido especial'},{id:'902',name:'Inativa',is_archived:true}]};
    if (endpoint.endsWith('/campaigns')) {
      assert.equal(params.fields,'id,daily_budget,start_time');
      return {data:[{id:'101',daily_budget:'5000',start_time:'2026-11-20T11:00:00-0300'}]};
    }
    assert.equal(params.level,'campaign');
    assert.equal(params.time_increment,'all_days');
    assert.equal(params.use_unified_attribution_setting,'true');
    assert.deepEqual(JSON.parse(params.time_range),{since:input.from,until:input.to});
    requestFields.push(params.fields);
    if (params.fields.includes('unsupported_metric')) throw Object.assign(new Error('Invalid field'),{
      providerCode:100,providerDetail:'unsupported_metric is not valid for fields param'
    });
    if (params.fields.includes('actions,')) return {data:[{campaign_id:'101',spend:'44.00',impressions:'4000',clicks:'54',
      actions:[action('omni_purchase',2),action('omni_add_to_cart',9)],action_values:[action('purchase',80)]}]};
    return {data:[{campaign_id:'101',reach:'1000',video_p50_watched_actions:[action('video_view',165)]}]};
  });
  assert.equal(data.rows.length,1);
  assert.equal(data.rows[0].purchases,2);
  assert.equal(data.rows[0].purchase_value,80);
  assert.equal(data.rows[0].insights.reach,'1000');
  assert.equal(data.rows[0].settings.daily_budget,'5000');
  assert.equal(data.rows[0].has_settings,true);
  assert.deepEqual(data.conversions,[{id:'901',name:'Pedido especial'}]);
  assert.ok(data.fields.includes('video_p50_watched_actions'));
  assert.ok(!data.fields.includes('unsupported_metric'));
  assert.equal(requestFields.length,3);
});

test('campaign columns calculate Meta CPA in the account currency and persist layout per operation', () => {
  const window = {}, storage = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../tracking-campaign-columns.js'),'utf8'),{
    window,matchMedia:()=>({matches:true}),localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}
  });
  const columns = window.MagemindCampaignColumns;
  const usd = {account_currency:'USD',spend_minor:1800,network_purchases:2,checkout_purchases:0,level:'campaign',meta:{
    purchases:3,purchase_value:100,insights:{spend:'24',impressions:'3000',actions:[action('omni_add_to_cart',8),action('offsite_conversion.custom.901',2)]},
    settings:{daily_budget:'5000'}
  }};
  const brl = {account_currency:'BRL',spend_minor:4800,network_purchases:4,checkout_purchases:0};
  const registry = columns.catalog('Campanha',[usd,brl],[],[{id:'901',name:'Pedido especial'}]);
  assert.equal(columns.value(usd,registry.get('network_purchases')),3);
  assert.equal(columns.value(usd,registry.get('cpa')),800);
  assert.equal(columns.value(usd,registry.get('add_to_cart')),8);
  assert.equal(columns.formatted(usd,registry.get('budget')).detail,'Diário');
  assert.equal(columns.total([usd,brl],registry.get('cpa')).length,2);
  assert.equal(columns.total([usd,brl],registry.get('reach')).length,0);
  assert.equal(registry.get('event:actions:offsite_conversion.custom.901').label,'Pedido especial');
  assert.equal(registry.has('event:unique_actions:offsite_conversion.custom.901'),false);
  const layout = columns.load('user','store');
  layout.order=['name','cpa','budget'];
  layout.sizes={cpa:180};
  columns.save(layout);
  assert.equal(columns.load('user','store').order.join(','),'name,cpa,budget');
  assert.equal(columns.load('user','store').sizes.cpa,180);
  assert.ok(columns.load('user','other-store').order.includes('impressions'));
});
