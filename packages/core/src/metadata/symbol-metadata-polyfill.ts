import { ensureMetadataSymbol } from './shared.js';

/**
 * Delegate to ensureMetadataSymbol to return native Symbol.metadata when present,
 * or define the canonical fallback symbol on Symbol and return it.
 * Importing @fluojs/core alone does not install the polyfill; installation is explicit.
 *
 * @returns The existing native metadata symbol or the installed canonical fallback symbol.
 */
export function ensureSymbolMetadataPolyfill(): symbol {
  return ensureMetadataSymbol();
}
