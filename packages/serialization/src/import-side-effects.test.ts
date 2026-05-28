import { afterEach, describe, expect, it, vi } from 'vitest';

const symbolConstructor = Symbol as typeof Symbol & { metadata?: symbol };
const originalMetadata = symbolConstructor.metadata;

function clearSymbolMetadata(): void {
  Reflect.deleteProperty(Symbol, 'metadata');
}

function restoreSymbolMetadata(): void {
  if (originalMetadata === undefined) {
    clearSymbolMetadata();
    return;
  }

  Object.defineProperty(Symbol, 'metadata', {
    configurable: true,
    value: originalMetadata,
  });
}

describe('serialization import side effects', () => {
  afterEach(() => {
    restoreSymbolMetadata();
  });

  it('does not install Symbol.metadata when the public entrypoint is imported', async () => {
    vi.resetModules();
    clearSymbolMetadata();

    await import('./index.js');

    expect(symbolConstructor.metadata).toBeUndefined();
  });
});
