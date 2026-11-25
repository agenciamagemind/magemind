const assert = require('node:assert/strict');
const test = require('node:test');

const webhooks = import('../supabase/functions/_shared/tracking/webhooks.mjs');
const orders = import('../supabase/functions/_shared/tracking/cartpanda-orders.mjs');
const cartpandaOrder = (fields = {}) => ({
  id: 4001, currency: 'BRL', total_price: '745,80', unformatted_total_price: 74580,
  test: 0, is_cartx_test: 1, payment_status: 3, payment_type: 'cc', no_of_installments: 12,
  payment_gateway: 'appmax', payment_gateway_id: '3001', source_name: 'checkout',
  shop: { cartxpayments_mode: 'production' },
  created_at: '2026-10-02 03:05:47', updated_at: '2026-10-02 03:07:48',
  payment: {
    gateway: 'appmax', status_id: 3, order_id: 4001, appmax_payment_id: '3001',
    updated_at: '2026-10-02 03:07:33'
  },
  line_items: [{ product_id: 21, quantity: 1, price: '697.90', title: 'Produto de exemplo' }],
  ...fields
});
const context = { manual_fees: true, receivedAt: '2026-10-02T06:08:00Z' };

test('Cartpanda imports a real Appmax transaction with the legacy test flag', async () => {
  const { normalizeWebhook } = await webhooks;
  const event = await normalizeWebhook('cartpanda', { data: { order: cartpandaOrder() } }, context);
  assert.equal(event.status, 'paid');
  assert.equal(event.gross_amount_minor, 74580);
  assert.equal(event.items[0].amount_minor, 74580);
  assert.equal(event.payment_method, 'CREDIT_CARD');
  assert.equal(event.installments, 12);
  assert.equal(event.approved_at, '2026-10-02T06:07:33.000Z');
});

test('explicit tests, sandbox and unverified Cartpanda payments stay excluded', async () => {
  const { normalizeWebhook, isSyntheticWebhook } = await webhooks;
  for (const fields of [
    { test: 1 }, { is_test: true }, { shop: { cartxpayments_mode: 'sandbox' } },
    { payment_gateway_id: '0' }, { payment_gateway_id: '5001' },
    { payment: undefined }, { payment: { ...cartpandaOrder().payment, order_id: 4002 } },
    { payment: { ...cartpandaOrder().payment, test: true } },
    { payment: { ...cartpandaOrder().payment, status_id: 1 } }
  ]) {
    await assert.rejects(normalizeWebhook('cartpanda', { order: cartpandaOrder(fields) }, context), /Synthetic events/);
  }
  assert.equal(isSyntheticWebhook('appmax', { is_test: true }), true);
  assert.equal(isSyntheticWebhook('kiwify', { order: { test: '1' } }), true);
  assert.equal(isSyntheticWebhook('appmax', { is_cartx_test: 1 }), false);
});

test('Cartpanda recovery is stable across scans and skips confirmed synthetic orders', async () => {
  const { cartpandaOrderSnapshot } = await orders;
  const recovered = await cartpandaOrderSnapshot(cartpandaOrder(), context);
  const retried = await cartpandaOrderSnapshot(cartpandaOrder(), { ...context, receivedAt: '2026-10-03T12:00:00Z' });
  assert.deepEqual(retried, recovered);
  assert.equal(recovered.order_id, '4001');
  assert.equal(await cartpandaOrderSnapshot(cartpandaOrder({ test: 1 }), context), null);
});

test('Cartpanda recovery reads the requested page from the documented orders endpoint', async () => {
  const { cartpandaOrders } = await orders;
  const window = { from: '2026-10-01', to: '2026-10-03', page: 2 };
  const credentials = { slug: 'loja-exemplo', token: 'fake-token-123' };
  const receipt = await cartpandaOrders(credentials, window, async (url, options) => {
    assert.equal(url.origin + url.pathname, 'https://accounts.cartpanda.com/api/loja-exemplo/orders');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      updated_at_min: window.from, updated_at_max: window.to, page: '2'
    });
    assert.equal(options.redirect, 'error');
    return Response.json({ orders: { data: [cartpandaOrder()], current_page: 2, last_page: 3 } });
  });
  assert.equal(receipt.hasNextPage, true);
  assert.equal(receipt.rows.length, 1);
  await assert.rejects(cartpandaOrders(credentials, window, async () =>
    Response.json({ orders: { data: [], current_page: 1, last_page: 1 } })), /Unexpected Cartpanda orders page/);
});
