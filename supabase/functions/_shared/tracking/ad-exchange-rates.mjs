const quoteUrl = 'https://api.coinbase.com/v2/exchange-rates?currency=USD';
const currencies = ['USD', 'EUR', 'JPY', 'KWD'];

function readRate(value) {
  if (!/^\d+(?:\.\d+)?$/.test(String(value))) return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export async function fetchAdExchangeRates(fetcher = fetch, now = Date.now()) {
  const response = await fetcher(quoteUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('ad_exchange_http_' + response.status);
  const {data} = await response.json();
  const brlPerUsd = readRate(data?.rates?.BRL);
  if (data?.currency !== 'USD' || !brlPerUsd) throw new Error('ad_exchange_empty');
  const respondedAt = Date.parse(response.headers.get('date') || '');
  const quoted_at = new Date(Number.isFinite(respondedAt) && respondedAt <= now + 120_000 ? respondedAt : now).toISOString();
  const rates = [];
  for (const currency of currencies) {
    const unitsPerUsd = currency === 'USD' ? 1 : readRate(data.rates[currency]);
    if (!unitsPerUsd) continue;
    const brlRate = brlPerUsd / unitsPerUsd;
    if (brlRate >= 0.000000000001 && brlRate < 10000) {
      rates.push({currency, brl_rate: brlRate.toFixed(12), quoted_at});
    }
  }
  if (!rates.length) throw new Error('ad_exchange_empty');
  return rates;
}
