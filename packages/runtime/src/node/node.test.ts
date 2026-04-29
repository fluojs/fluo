import { describe, expect, it } from 'vitest';

import * as rootRuntimeApi from '../index.js';
import * as publicNodeApi from '../node.js';
import type { NodeHttpApplicationAdapter } from '../node.js';

describe('createNodeHttpAdapter', () => {
  it('keeps Node lifecycle helpers out of the runtime root barrel', () => {
    expect(rootRuntimeApi).not.toHaveProperty('bootstrapNodeApplication');
    expect(rootRuntimeApi).not.toHaveProperty('createNodeHttpAdapter');
    expect(rootRuntimeApi).not.toHaveProperty('runNodeApplication');
  });

  it('uses the runtime default port instead of process.env.PORT', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = '4321';

    try {
      const adapter = publicNodeApi.createNodeHttpAdapter() as NodeHttpApplicationAdapter;

      expect(adapter.getListenTarget().url).toBe('http://localhost:3000');
      await adapter.close();
    } finally {
      if (previousPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previousPort;
      }
    }
  });

  it('does not fail when process.env.PORT is invalid', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = 'not-a-number';

    try {
      const adapter = publicNodeApi.createNodeHttpAdapter() as NodeHttpApplicationAdapter;

      expect(adapter.getListenTarget().url).toBe('http://localhost:3000');
      await adapter.close();
    } finally {
      if (previousPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previousPort;
      }
    }
  });

  it('does not expose node compression internals on the public node subpath', () => {
    expect(publicNodeApi.createNodeHttpAdapter).toBeTypeOf('function');
    expect(publicNodeApi).not.toHaveProperty('compressNodeResponse');
    expect(publicNodeApi).not.toHaveProperty('createNodeResponseCompression');
  });

  it('fails fast when maxBodySize is not provided as numeric bytes', () => {
    expect(() => Function.prototype.call.call(publicNodeApi.createNodeHttpAdapter, undefined, { maxBodySize: '1mb' })).toThrow(
      'Invalid maxBodySize value: 1mb. Expected a non-negative integer number of bytes.',
    );
  });
});
