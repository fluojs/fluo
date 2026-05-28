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

describe('validation import side effects', () => {
  afterEach(() => {
    restoreSymbolMetadata();
  });

  it('does not install Symbol.metadata when decorators are imported', async () => {
    vi.resetModules();
    clearSymbolMetadata();

    await import('./decorators.js');

    expect(symbolConstructor.metadata).toBeUndefined();
  });
});
