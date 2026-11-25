import { cartpandaCredentials } from './cartpanda-catalog.mjs';
import { reconciliationIdentity } from './contracts.mjs';
import { isSyntheticWebhook, normalizeCartpanda } from './webhooks.mjs';

export function cartpandaSyncDue(integration, date) {
  const retryAfter = Date.parse(integration.retry_after_at);
  if (Number.isFinite(retryAfter)) return +date >= retryAfter;
  if (integration.error_code === 'sync_requested' || integration.sync_cursor?.cartpanda_orders) return true;
  const previous = Date.parse(integration.last_sync_at);
  return !Number.isFinite(previous) || +date - previous >= (integration.sync_interval_seconds ?? 600) * 1000;
}

export async function cartpandaOrders(credentials, { from, to, page }, fetcher = fetch) {
  const { slug, token } = cartpandaCredentials(credentials);
  const url = new URL('https://accounts.cartpanda.com/api/' + slug + '/orders');
  url.search = new URLSearchParams({ updated_at_min: from, updated_at_max: to, page: String(page) }).toString();
  const response = await fetcher(url, {
    redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
  });
  if (response.status === 429) throw new Error('rate_limit');
  if (!response.ok) throw new Error('provider_http_' + response.status);
  const { orders } = await response.json();
  if (!Array.isArray(orders?.data) || orders.current_page !== page ||
      !Number.isInteger(orders.last_page) || orders.last_page < 1) {
    throw new Error('Unexpected Cartpanda orders page');
  }
  return { rows: orders.data, hasNextPage: page < orders.last_page };
}

export async function cartpandaOrderSnapshot(order, context) {
  if (isSyntheticWebhook('cartpanda', order)) return null;
  // The provider's update time is stable across scans and lets the ledger ignore stale events.
  if (!order.updated_at) throw new Error('Cartpanda order update time required');
  const event = normalizeCartpanda(order, { ...context, eventId: 'cartpanda-order-snapshot' });
  return reconciliationIdentity(event);
}
