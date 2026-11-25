const { test } = require('node:test');
const assert = require('node:assert/strict');

const adapter = import('../supabase/functions/_shared/tracking/ad-exchange-rates.mjs');
const now = Date.parse('2026-11-25T12:00:00Z');
const quote = (rates, currency = 'USD') => ({data: {currency, rates}});

test('ad exchange rates convert all supported currencies into BRL from one market snapshot', async () => {
  const {fetchAdExchangeRates} = await adapter;
  const rates = await fetchAdExchangeRates(async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.coinbase.com');
    assert.equal(new URL(url).searchParams.get('currency'), 'USD');
    assert.equal(options.redirect, 'error');
    return Response.json(quote({BRL: '5.80', EUR: '0.8', JPY: '160', KWD: '0.3125'}),
      {headers: {date: 'Wed, 25 Nov 2026 11:59:00 GMT'}});
  }, now);
  assert.deepEqual(rates.map(({currency,brl_rate}) => [currency, Number(brl_rate)]),
    [['USD', 5.8], ['EUR', 7.25], ['JPY', 0.03625], ['KWD', 18.56]]);
  assert.equal(rates[3].quoted_at, '2026-11-25T11:59:00.000Z');
});

test('ad exchange rates discard invalid prices and fail when none can be used', async () => {
  const {fetchAdExchangeRates} = await adapter;
  const rates = await fetchAdExchangeRates(async () => Response.json(quote({
    BRL: '5.8', EUR: '-0.8', JPY: '160', KWD: '0'
  })), now);
  assert.deepEqual(rates.map(row => row.currency), ['USD', 'JPY']);
  await assert.rejects(fetchAdExchangeRates(async () => Response.json(quote({BRL: '5.8'}, 'EUR')), now),
    /ad_exchange_empty/);
  await assert.rejects(fetchAdExchangeRates(async () => Response.json(quote({BRL: '0'})), now),
    /ad_exchange_empty/);
  await assert.rejects(fetchAdExchangeRates(async () => new Response(null, {status: 429}), now),
    /ad_exchange_http_429/);
});
