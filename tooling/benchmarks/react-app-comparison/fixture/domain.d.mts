export type Product = Readonly<{ sku: string; name: string }>;
export type Song = Readonly<{ id: string; title: string }>;
export type ValidProduct = Readonly<{ ok: true; name: string }>;
export type InvalidProduct = Readonly<{ ok: false; code: 'PRODUCT_NAME_TOO_SHORT' }>;
export type Catalog = Readonly<{
  list(): Product[];
  detail(sku: string): Product | undefined;
  create(name: string): Product;
  update(sku: string, name: string): Product | undefined;
  delete(sku: string): boolean;
}>;

export const PRODUCTS: readonly Product[];
export const SONGS: readonly Song[];
export const SESSION_COOKIE: 'benchmark_session';
export const SESSION_VALUE: 'benchmark-editor';
export const JUKEBOX_VIEWS: readonly ['songs', 'qr', 'queue'];
export function authenticate(username: unknown, password: unknown): boolean;
export function isEditor(cookie: string | null | undefined): boolean;
export function validateProduct(value: unknown): ValidProduct | InvalidProduct;
export function createCatalog(): Catalog;
