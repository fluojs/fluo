import { describe, expect, it } from 'vitest';

import { ensureMetadataSymbol } from './metadata.js';

const metadataSymbol =
  (Symbol as typeof Symbol & { metadata?: symbol }).metadata ??
  Symbol.for('konekti.test.metadata');

Object.defineProperty(Symbol, 'metadata', {
  configurable: true,
  value: metadataSymbol,
});

function tagged(tag: string) {
  return <T>(value: T, context: ClassMethodDecoratorContext) => {
    (context.metadata as Record<string, unknown>).tag = tag;

    return value;
  };
}

class Example {
  @tagged('ok')
  run() {
    return 'done';
  }
}

describe('decorator transform baseline', () => {
  it('keeps the same metadata path in tests', () => {
    const metadata = (Example as unknown as Record<symbol, Record<string, unknown>>)[metadataSymbol];

    expect(metadata.tag).toBe('ok');
  });

  it('keeps the metadata initializer idempotent', () => {
    expect(ensureMetadataSymbol()).toBe(metadataSymbol);
    expect(ensureMetadataSymbol()).toBe(metadataSymbol);
  });
});
