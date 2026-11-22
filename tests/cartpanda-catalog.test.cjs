const { test } = require('node:test');
const assert = require('node:assert/strict');

const adapter = import('../supabase/functions/_shared/tracking/cartpanda-catalog.mjs');
const credentials = { slug: 'loja-teste', token: 'local-only' };
const product = (id, extra = {}) => ({ id, title: 'Produto ' + id, updated_at: '2026-11-22 08:00:00', ...extra });
const page = (current_page, last_page, data) => Response.json({ products: { current_page, last_page, data } });

test('Cartpanda traverses every catalog page and normalizes product IDs, prices and images', async t => {
  const { cartpandaProducts } = await adapter;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer local-only');
    assert.equal(options.redirect, 'error');
    assert.equal(new URL(url).origin, 'https://accounts.cartpanda.com');
    return new URL(url).searchParams.get('page') === '1'
      ? page(1, 2, [product(101, { product_default_variant: { price: '1.299,90' }, images: [{ url: 'http://accounts.cartpanda.com/static/photo.jpg' }] })])
      : page(2, 2, [product(102), product(103, { deleted_at: '2026-11-21' })]);
  });
  const rows = await cartpandaProducts(credentials, 'BRL');
  assert.deepEqual(rows.map(p => p.product_id), ['101', '102']);
  assert.equal(rows[0].price_minor, 129990);
  assert.equal(rows[0].image_url, 'https://accounts.cartpanda.com/static/photo.jpg');
});

test('Cartpanda rejects incomplete pagination instead of publishing a partial catalog', async t => {
  const { cartpandaProducts } = await adapter;
  t.mock.method(globalThis, 'fetch', async url => new URL(url).searchParams.get('page') === '1'
    ? page(1, 2, [product(101)]) : page(2, 3, []));
  await assert.rejects(cartpandaProducts(credentials, 'BRL'), /lista completa/);
});

test('Cartpanda sends just the edited fields and checks confirmation', async t => {
  const { updateCartpandaProduct } = await adapter;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /\/loja-teste\/products\/101$/);
    assert.equal(options.method, 'PUT');
    assert.deepEqual(JSON.parse(options.body), { id: 101, title: 'Novo nome', price: 13.5 });
    return Response.json({ product: product(101, { title: 'Novo nome', price: 13.5 }) });
  });
  const row = { product_id: '101', price_minor: 1100, compare_minor: 1700, has_variants: false };
  const saved = await updateCartpandaProduct(credentials, row, { name: 'Novo nome', price_minor: 1350 }, 'BRL');
  assert.equal(saved.price_minor, 1350);
  await assert.rejects(updateCartpandaProduct(credentials, { ...row, has_variants: true }, { price_minor: 1350 }, 'BRL'), /variação/);
  assert.equal(fetchMock.mock.callCount(), 1);
});
