import { createCatalog, isEditor } from '../../../fixture/domain.mjs';
import { postRedirect } from './responses';

// The mutable catalog belongs to this server process, not a render or a request.
export const catalog = globalThis.__benchmarkNextCatalog ??=
  createCatalog();

// The other route variant owns DELETE; keep its HTTP policy on the same shared store.
export const privateHeaders = { 'Cache-Control': 'no-store' };
export const editorFromCookie = isEditor;
export const redirectTo = postRedirect;
export const devCatalogTitle = 'Products';
