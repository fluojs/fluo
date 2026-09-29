export const PRODUCTS = Object.freeze([
  Object.freeze({ sku: 'sku-42', name: 'Catalog item sku-42' }),
  Object.freeze({ sku: 'sku-84', name: 'Catalog item sku-84' }),
  Object.freeze({ sku: 'sku-126', name: 'Catalog item sku-126' }),
]);

export const SONGS = Object.freeze([
  Object.freeze({ id: 'song-1', title: 'First song' }),
  Object.freeze({ id: 'song-2', title: 'Second song' }),
  Object.freeze({ id: 'song-3', title: 'Third song' }),
]);

export const SESSION_COOKIE = 'benchmark_session';
export const SESSION_VALUE = 'benchmark-editor';
export const JUKEBOX_VIEWS = Object.freeze(['songs', 'qr', 'queue']);

export function authenticate(username, password) {
  return username === 'editor' && password === 'benchmark-pass';
}

export function isEditor(cookie) {
  return cookie?.split(';').some((part) => part.trim() === `${SESSION_COOKIE}=${SESSION_VALUE}`) ?? false;
}

export function validateProduct(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.length >= 3
    ? { ok: true, name }
    : { ok: false, code: 'PRODUCT_NAME_TOO_SHORT' };
}

export function createCatalog() {
  const products = new Map(PRODUCTS.map((product) => [product.sku, product]));
  let nextSku = 127;
  return {
    list: () => [...products.values()],
    detail: (sku) => products.get(sku),
    create(name) {
      const product = { sku: `sku-${nextSku++}`, name };
      products.set(product.sku, product);
      return product;
    },
    update(sku, name) {
      if (!products.has(sku)) return undefined;
      const product = { sku, name };
      products.set(sku, product);
      return product;
    },
    delete(sku) {
      return products.delete(sku);
    },
  };
}
