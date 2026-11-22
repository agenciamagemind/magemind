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
      ? page(1, 2, [product(101, { price: 69790, compare_at_price: '0', product_default_variant: { price: '697.90', compare_at_price: '0.00' }, images: [{ url: 'http://accounts.cartpanda.com/static/photo.jpg' }] })])
      : page(2, 2, [product(102), product(103, { deleted_at: '2026-11-21' })]);
  });
  const rows = await cartpandaProducts(credentials, 'BRL');
  assert.deepEqual(rows.map(p => p.product_id), ['101', '102']);
  assert.equal(rows[0].price_minor, 69790);
  assert.equal(rows[0].compare_minor, 0);
  assert.equal(rows[0].image_url, 'https://accounts.cartpanda.com/static/photo.jpg');
});

test('Cartpanda distinguishes minor units from decimal prices across known formats', async () => {
  const { cartpandaProduct } = await adapter;
  for (const [currency, fields, expected] of [
    ['BRL', { price: '69790', compare_at_price: 109990 }, [69790, 109990]],
    ['BRL', { price: 9900, compare_at_price: 0, product_default_variant: { price: 'invalid', compare_at_price: '79.00' } }, [9900, 0]],
    ['BRL', { product_default_variant: { price: '1.299,90', compare_at_price: '1,499.90' } }, [129990, 149990]],
    ['BRL', { product_default_variant: { price: '697,90', compare_at_price: '699.90' } }, [69790, 69990]],
    ['BRL', { price: '697.90', compare_at_price: '1.299,90' }, [69790, 129990]],
    ['BRL', { product_default_variant: { price: '12.99,00', compare_at_price: '12,99.00' } }, [null, null]],
    ['BRL', { price: null, product_default_variant: { price: '0.00', compare_at_price: '1.005' } }, [0, null]],
    ['BRL', { price: '9007199254740992', product_default_variant: { price: '12.25' } }, [1225, null]],
    ['JPY', { price: 697, product_default_variant: { compare_at_price: '900.00' } }, [697, 900]],
    ['KWD', { price: 69790, product_default_variant: { compare_at_price: '69.999' } }, [69790, 69999]]
  ]) {
    const row = cartpandaProduct(product(101, fields), currency);
    assert.deepEqual([row.price_minor, row.compare_minor], expected, JSON.stringify(fields));
  }
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
    return Response.json({ product: product(101, { title: 'Novo nome', price: 1350, product_default_variant: { price: '13.50' } }) });
  });
  const row = { product_id: '101', price_minor: 1100, compare_minor: 1700, has_variants: false };
  const saved = await updateCartpandaProduct(credentials, row, { name: 'Novo nome', price_minor: 1350 }, 'BRL');
  assert.equal(saved.price_minor, 1350);
  await assert.rejects(updateCartpandaProduct(credentials, { ...row, has_variants: true }, { price_minor: 1350 }, 'BRL'), /variação/);
  assert.equal(fetchMock.mock.callCount(), 1);
});
