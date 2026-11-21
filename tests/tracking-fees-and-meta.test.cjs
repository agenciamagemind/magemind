const {test} = require('node:test');
const assert = require('node:assert/strict');

const contracts = import('../supabase/functions/_shared/tracking/contracts.mjs');
const webhooks = import('../supabase/functions/_shared/tracking/webhooks.mjs');
const adapters = import('../supabase/functions/_shared/tracking/adapters.mjs');

test('normalized order preserves a valid installment count only for card payments', async () => {
  const {validateOrder} = await contracts;
  const time = new Date(Date.now() - 60_000).toISOString();
  const input = {
    schema_version: '1', event_id: 'evt-test', order_id: 'test-order', status: 'paid',
    currency: 'BRL', amount_scale: 2, gross_amount_minor: 10000, refunded_amount_minor: 0,
    is_test: true, created_at: time, approved_at: time, occurred_at: time,
    items: [{external_product_id: 'test', name: 'Produto', amount_minor: 10000, quantity: 1}]
  };
  const card = validateOrder({...input, payment_method: 'cc', installments: '12'});
  assert.equal(card.payment_method, 'CREDIT_CARD');
  assert.equal(card.installments, 12);
  assert.deepEqual(card.money_components, {payment_method: 'CREDIT_CARD', installments: 12});
  assert.equal(validateOrder(card).money_components.installments, 12);
  for (const count of [0, 61, -1, 2.5, '12x', true, null]) {
    assert.equal(validateOrder({...input, payment_method: 'card', installments: count}).installments, undefined);
  }
  assert.equal(validateOrder({...input, payment_method: 'pix', installments: 12}).money_components.installments, undefined);
});

test('Appmax card and Kirvano use their documented installment fields', async () => {
  const {normalizeAppmax, normalizeKirvano} = await webhooks;
  const created = '2026-11-19T13:00:00Z';
  const approved = '2026-11-19T13:05:00Z';
  const context = {eventId: 'test-webhook', isTest: true, manual_fees: true};
  const appmax = normalizeAppmax({
    event: 'order_approved', event_type: 'order',
    data: {
      order_id: 'appmax-test', total: 100, paid_at: approved, created_at: created,
      products: [{sku: 'test', name: 'Produto', price: 100, quantity: 1}],
      payment_info: {credit_card: {installments: 12}}
    }
  }, context);
  assert.equal(appmax.installments, 12);
  assert.equal(appmax.payment_method, 'CREDIT_CARD');
  assert.equal(appmax.money_components.manual_fees, true);
  const kirvano = normalizeKirvano({
    event: 'SALE_APPROVED', sale_id: 'kirvano-test', created_at: created,
    payment_method: 'CREDIT_CARD', payment: {finished_at: approved, installments: 5},
    total_price: '100,00', products: [{id: 'test', name: 'Produto', price: '100,00'}]
  }, context);
  assert.equal(kirvano.money_components.installments, 5);
});

test('Meta responses distinguish invalid authorization, account permissions and retryable failures', async () => {
  const {metaFailure, setMetaStatus, metaAccountManagement, oauthStart} = await adapters;
  const connection = {version: 'v25.0', access_token: 'simulated-token'};
  for (const [http, code, subcode, expected] of [
    [400, 190, 463, 'token_revoked'],
    [400, 190, 459, 'meta_confirmation_required'],
    [400, 200, 0, 'meta_manage_denied'],
    [403, 10, 0, 'meta_manage_denied'],
    [429, 4, 0, 'rate_limit'],
    [500, 0, 0, 'meta_update_unconfirmed']
  ]) {
    const fetcher = async () => Response.json({error: {code, error_subcode: subcode}}, {status: http});
    await assert.rejects(setMetaStatus(connection, '123456', 'PAUSED', fetcher),
      error => metaFailure(error, 'write') === expected);
  }
  assert.equal(metaAccountManagement({canManage: true}, {user_tasks: ['ANALYZE']}), false);
  assert.equal(metaAccountManagement({canManage: true}, {user_tasks: ['ADVERTISE']}), true);
  assert.equal(metaAccountManagement({canManage: null}, {}), null);
  const recovery = new URL(await oauthStart('meta', {
    clientId: '1', redirectUri: 'https://example.test/callback', state: 'state', reconnect: true,
    allowManagement: true
  }));
  assert.equal(recovery.searchParams.get('auth_type'), 'rerequest');
  assert.equal(recovery.searchParams.get('scope'), 'ads_read,ads_management');
});
