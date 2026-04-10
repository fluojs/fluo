import { describe, expect, it } from 'vitest';

import * as coreInternalApi from './internal.js';
import * as corePublicApi from './index.js';

describe('@fluojs/core public API surface', () => {
  it('keeps documented root-barrel exports for application code', () => {
    expect(corePublicApi).toHaveProperty('Module');
    expect(corePublicApi).toHaveProperty('Global');
    expect(corePublicApi).toHaveProperty('Inject');
    expect(corePublicApi).toHaveProperty('Scope');
    expect(corePublicApi).toHaveProperty('KonektiError');
    expect(corePublicApi).toHaveProperty('InvariantError');
    expect(corePublicApi).toHaveProperty('ensureMetadataSymbol');
  });

  it('does not expose internal metadata helpers on the root barrel', () => {
    expect(corePublicApi).not.toHaveProperty('defineModuleMetadata');
    expect(corePublicApi).not.toHaveProperty('getModuleMetadata');
    expect(corePublicApi).not.toHaveProperty('defineControllerMetadata');
    expect(corePublicApi).not.toHaveProperty('getControllerMetadata');
    expect(corePublicApi).not.toHaveProperty('getClassDiMetadata');
    expect(corePublicApi).not.toHaveProperty('metadataSymbol');
    expect(corePublicApi).not.toHaveProperty('ensureSymbolMetadataPolyfill');
    expect(corePublicApi).not.toHaveProperty('cloneWithFallback');
    expect(corePublicApi).not.toHaveProperty('fallbackClone');
  });

  it('keeps internal metadata helpers available from the internal subpath', () => {
    expect(coreInternalApi).toHaveProperty('defineModuleMetadata');
    expect(coreInternalApi).toHaveProperty('getModuleMetadata');
    expect(coreInternalApi).toHaveProperty('defineControllerMetadata');
    expect(coreInternalApi).toHaveProperty('getControllerMetadata');
    expect(coreInternalApi).toHaveProperty('getClassDiMetadata');
    expect(coreInternalApi).toHaveProperty('metadataSymbol');
    expect(coreInternalApi).toHaveProperty('ensureSymbolMetadataPolyfill');
    expect(coreInternalApi).toHaveProperty('cloneWithFallback');
    expect(coreInternalApi).toHaveProperty('fallbackClone');
  });
});
