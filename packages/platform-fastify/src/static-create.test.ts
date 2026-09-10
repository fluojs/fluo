import { describe, expect, it } from 'vitest';

import { FastifyHttpApplicationAdapter } from './adapter.js';

describe('FastifyHttpApplicationAdapter.create', () => {
  it('creates the concrete adapter through the canonical public factory', async () => {
    // Given / When
    const adapter = FastifyHttpApplicationAdapter.create({
      host: '127.0.0.1',
      port: 0,
    });

    // Then
    expect(adapter).toBeInstanceOf(FastifyHttpApplicationAdapter);
    await adapter.close();
  });
});
