import { afterAll, describe, expect, it } from 'vitest';

import { ensureMetadataSymbol } from './metadata.js';

const originalMetadataDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
const metadataSymbol =
  (Symbol as typeof Symbol & { metadata?: symbol }).metadata ??
  Symbol.for('fluo.test.metadata');

Object.defineProperty(Symbol, 'metadata', {
  configurable: true,
  value: metadataSymbol,
});

afterAll(() => {
  if (originalMetadataDescriptor) {
    Object.defineProperty(Symbol, 'metadata', originalMetadataDescriptor);
  } else {
    delete (Symbol as typeof Symbol & { metadata?: symbol }).metadata;
  }
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
