import { localizedMinor, SCALES } from './contracts.mjs';

const base = 'https://accounts.cartpanda.com';
const ids = /^[1-9]\d{0,15}$/;
export class CatalogError extends Error {}

export function cartpandaCredentials(input) {
  const slug = String(input.slug || '').trim().toLowerCase();
  const token = String(input.token || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) || !/^[!-~]{8,2048}$/.test(token)) {
    throw new CatalogError('Informe o identificador da loja e um token de API válido.');
  }
  return { slug, token };
}

async function request(credentials, path, options = {}) {
  const response = await fetch(base + '/api/' + credentials.slug + '/products' + path, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(9000),
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' }
  }).catch(() => { throw new CatalogError('A Cartpanda demorou a responder. Tente sincronizar novamente.'); });
  if (response.status === 401 || response.status === 403) {
    const error = new CatalogError('A Cartpanda negou o acesso. Confira o token e as permissões da loja.');
    error.denied = true;
    throw error;
  }
  if (!response.ok) throw new CatalogError('A Cartpanda recusou a solicitação (' + response.status + '). Confira o acesso ao catálogo e tente novamente.');
  return response.json().catch(() => { throw new CatalogError('A Cartpanda retornou um catálogo em formato inesperado.'); });
}

function amount(productValue, variantValue, currency) {
  const text = String(productValue ?? '').trim();
  // Cartpanda returns integer minor units on the product and decimal prices on its default variant.
  if (/^\d+$/.test(text) && Number.isSafeInteger(Number(text))) return Number(text);
  const scale = SCALES[currency];
  if (scale == null) return null;
  for (const value of [variantValue, productValue]) {
    if (value == null || value === '') continue;
    try { return localizedMinor(value, scale); }
    catch { /* Try the remaining price field when one is unavailable or malformed. */ }
  }
  return null;
}

export function cartpandaProduct(product, currency) {
  const product_id = String(product?.id ?? '');
  const name = String(product?.title || '').trim().slice(0, 255);
  if (!ids.test(product_id) || !Number.isSafeInteger(Number(product_id)) || !name) throw new CatalogError('A Cartpanda retornou um produto sem identificação válida.');
  const variants = Array.isArray(product.product_variants) ? product.product_variants.filter(row => !row.deleted_at) : [];
  const primary = product.product_default_variant || {};
  const image = product.images?.find(item => item?.url || item?.src);
  let image_url = null;
  try {
    if (image) {
      const url = new URL(image.url || image.src, base);
      if (url.protocol === 'http:') url.protocol = 'https:';
      if (url.protocol === 'https:' && !url.username && !url.password) image_url = url.href.slice(0, 2048);
    }
  } catch { /* An unavailable image is replaced by the product icon. */ }
  return {
    product_id, name, image_url,
    sku: String(primary.sku || product.sku || '').slice(0, 200),
    price_minor: amount(product.price, primary.price, currency),
    compare_minor: amount(product.compare_at_price, primary.compare_at_price, currency),
    has_variants: variants.some(row => row.id !== primary.id),
    version: typeof product.updated_at === 'string' ? product.updated_at.slice(0, 80) : null
  };
}

export async function cartpandaProducts(credentials, currency) {
  const products = new Map();
  let last = 1;
  for (let page = 1; page <= last; page++) {
    const { products: result } = await request(credentials, '?per_page=100&page=' + page);
    const pages = Number(result?.last_page);
    if (!Array.isArray(result?.data) || Number(result.current_page) !== page ||
        !Number.isInteger(pages) || pages < page || pages > 100 || (page > 1 && pages !== last)) {
      throw new CatalogError('A Cartpanda não confirmou a lista completa. O último catálogo sincronizado foi preservado.');
    }
    last = pages;
    for (const item of result.data) {
      if (item.deleted_at) continue;
      const product = cartpandaProduct(item, currency);
      if (products.has(product.product_id)) throw new CatalogError('O catálogo mudou durante a consulta. Sincronize novamente.');
      products.set(product.product_id, product);
    }
  }
  return [...products.values()];
}

export async function cartpandaDetail(credentials, id, currency) {
  if (!ids.test(id)) throw new CatalogError('Selecione um produto válido.');
  const { product } = await request(credentials, '/' + id);
  if (String(product?.id) !== id || product.deleted_at) throw new CatalogError('O produto mudou. Sincronize o catálogo novamente.');
  return { ...cartpandaProduct(product, currency), description: String(product.description ?? '').slice(0, 12000) };
}

export async function updateCartpandaProduct(credentials, current, input, currency) {
  const id = current.product_id;
  const patch = { id: Number(id) };
  if ('name' in input) {
    const title = String(input.name).trim();
    if (!title || title.length > 255) throw new CatalogError('Informe um nome de até 255 caracteres.');
    patch.title = title;
  }
  if ('description' in input) {
    if (typeof input.description !== 'string' || input.description.length > 12000) throw new CatalogError('Informe uma descrição de até 12.000 caracteres.');
    patch.description = input.description.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/\r?\n/g, '<br>');
  }
  if ('price_minor' in input || 'compare_minor' in input) {
    if (current.has_variants) throw new CatalogError('Altere os preços de cada variação no painel da Cartpanda.');
    for (const [key, field] of [['price_minor', 'price'], ['compare_minor', 'compare_at_price']]) {
      if (!(key in input)) continue;
      const value = input[key];
      if (!Number.isSafeInteger(value) || value < 0) throw new CatalogError('Informe um preço válido.');
      patch[field] = value / 10 ** SCALES[currency];
    }
    const price = input.price_minor ?? current.price_minor;
    const compare = input.compare_minor ?? current.compare_minor;
    if (compare > 0 && compare < price) throw new CatalogError('O preço de comparação deve ser igual ou maior que o preço de venda.');
  }
  if (Object.keys(patch).length === 1) return current;
  const { product } = await request(credentials, '/' + id, { method: 'PUT', body: JSON.stringify(patch) });
  if (String(product?.id) !== id) throw new CatalogError('A Cartpanda não confirmou a alteração. Confira o produto na loja e sincronize novamente.');
  const saved = cartpandaProduct(product, currency);
  if (('title' in patch && patch.title !== saved.name) ||
      ('price_minor' in input && input.price_minor !== saved.price_minor) ||
      ('compare_minor' in input && input.compare_minor !== (saved.compare_minor ?? 0))) {
    throw new CatalogError('A Cartpanda não confirmou todos os campos. Confira o produto na loja e sincronize novamente.');
  }
  return saved;
}
