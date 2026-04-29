import { ensureMetadataSymbol } from './shared.js';

/**
 * Ensure symbol metadata polyfill.
 *
 * @returns The ensure symbol metadata polyfill result.
 */
export function ensureSymbolMetadataPolyfill(): symbol {
  return ensureMetadataSymbol();
}
