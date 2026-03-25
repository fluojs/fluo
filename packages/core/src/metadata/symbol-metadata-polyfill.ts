import { ensureMetadataSymbol } from './shared.js';

export function ensureSymbolMetadataPolyfill(): symbol {
  return ensureMetadataSymbol();
}
