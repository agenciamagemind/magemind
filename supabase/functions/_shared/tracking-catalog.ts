import { cartpandaCredentials, cartpandaProducts, cartpandaDetail, updateCartpandaProduct, CatalogError } from './tracking/cartpanda-catalog.mjs';
import { encrypt, decrypt, allowReads } from './tracking-runtime.ts';

export { CatalogError };
const allowedCurrency = new Set(['BRL', 'USD', 'EUR', 'JPY', 'KWD']);
const conflict = () => new CatalogError('O catálogo está sendo atualizado. Aguarde e sincronize novamente.');

export async function catalogAction(db: any, integration: any, input: any) {
  if (!integration.connected || integration.provider !== 'cartpanda') {
    throw new CatalogError('Selecione uma integração Cartpanda conectada.');
  }
  allowReads();
  const snapshots = () => db.from('tracking_catalog_snapshots');
  const current = await snapshots().select('*').eq('integration_id', integration.id).eq('workspace_id', integration.workspace_id).maybeSingle();
  if (current.error) throw current.error;
  const previous = current.data;
  if (previous?.edit_until && Date.parse(previous.edit_until) > Date.now()) throw conflict();
  const isConfig = input.action === 'catalog_connect';
  if (!previous && !isConfig) throw new CatalogError('Autorize o catálogo da sua loja Cartpanda.');
  const currency = isConfig ? String(input.currency) : previous.currency;
  if (!allowedCurrency.has(currency)) throw new CatalogError('Selecione a moeda usada nos preços da loja.');
  const credentials = isConfig ? cartpandaCredentials(input) : await decrypt(previous.cipher);
  const writeIfCurrent = async (fields: Record<string, unknown>, revision: string) => {
    const { data, error } = await snapshots().update(fields)
      .eq('integration_id', integration.id).eq('workspace_id', integration.workspace_id)
      .eq('revision', revision).select('revision').maybeSingle();
    if (error) throw error;
    if (!data) throw conflict();
  };
  if (isConfig || input.action === 'catalog_sync') {
    const products = await cartpandaProducts(credentials, currency);
    const { data: connected, error } = await db.from('tracking_integrations').select('id')
      .eq('id', integration.id).eq('workspace_id', integration.workspace_id).eq('connected', true).maybeSingle();
    if (error) throw error;
    if (!connected) throw new CatalogError('Reconecte a Cartpanda para sincronizar o catálogo.');
    const revision = crypto.randomUUID();
    const fields = {
      products, currency, revision, synced_at: new Date().toISOString(), edit_until: null,
      allow_edit: isConfig ? input.allow_edit === true : previous.allow_edit
    };
    if (isConfig) Object.assign(fields, { cipher: await encrypt(credentials) });
    if (previous) await writeIfCurrent(fields, previous.revision);
    else {
      const { error: failure } = await snapshots().insert({
        integration_id: integration.id, workspace_id: integration.workspace_id, ...fields
      });
      if (failure?.code === '23505') throw conflict();
      if (failure) throw failure;
    }
    const before = new Map<string, any>((previous?.products || []).map((item: any) => [item.product_id, item]));
    const after = new Set(products.map(item => item.product_id));
    return {
      total: products.length,
      added: products.filter(item => !before.has(item.product_id)).length,
      removed: [...before.keys()].filter(id => !after.has(id)).length,
      updated: products.filter(item => before.has(item.product_id) && Object.keys(item).some(key => before.get(item.product_id)[key] !== item[key as keyof typeof item])).length
    };
  }
  if (!previous.allow_edit) throw new CatalogError('A loja está conectada somente para leitura do catálogo.');
  const id = String(input.product_id || '');
  if (!previous.products.some((item: any) => item.product_id === id)) throw new CatalogError('O produto não está no catálogo sincronizado.');
  const product = await cartpandaDetail(credentials, id, currency);
  if (input.action === 'catalog_detail') return { ...product, revision: previous.revision, currency };
  if (!product.version || input.version !== product.version || input.revision !== previous.revision) throw conflict();
  const revision = crypto.randomUUID();
  await writeIfCurrent({ revision, edit_until: new Date(Date.now() + 30000).toISOString() }, previous.revision);
  try {
    const saved = await updateCartpandaProduct(credentials, product, input, currency);
    if ('description' in saved) delete (saved as {description?: string}).description;
    await writeIfCurrent({ products: previous.products.map((item: any) => item.product_id === id ? saved : item), edit_until: null }, revision);
    return { saved: true };
  } catch (error) {
    await writeIfCurrent({ edit_until: null, ...(error && 'denied' in Object(error) ? { allow_edit: false } : {}) }, revision);
    throw error;
  }
}
