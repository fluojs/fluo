import { describe, expect, it } from 'vitest';

import {
  createNoopHttpApplicationAdapter,
  createPortableHttpAdapterMultipartCapability,
} from './adapter.js';

describe('HTTP adapter multipart capability', () => {
  it('declares the versioned portable buffered and streaming modes', () => {
    expect(createPortableHttpAdapterMultipartCapability()).toEqual({
      contract: 'portable-multipart',
      kind: 'multipart',
      modes: ['buffered', 'streaming'],
      version: 1,
    });
  });

  it('reports multipart as unsupported for the no-op adapter', () => {
    expect(createNoopHttpApplicationAdapter().getMultipartCapability?.()).toEqual({
      kind: 'unsupported',
      reason: 'No-op HTTP adapter does not consume request bodies.',
      version: 1,
    });
  });
});
