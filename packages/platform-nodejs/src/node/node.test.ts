import * as rootRuntimeApi from '@fluojs/runtime';

import { defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import * as publicNodeApi from '../index.js';
import { createNodeTestApplication, startNodeTestApplication } from '../test-support/application.js';

describe('NodeHttpApplicationAdapter.create', () => {
  it('keeps Node lifecycle helpers out of the runtime root barrel', () => {
    expect(rootRuntimeApi).not.toHaveProperty('bootstrapNodeApplication');
    expect(rootRuntimeApi).not.toHaveProperty('createNodeHttpAdapter');
    expect(rootRuntimeApi).not.toHaveProperty('runNodeApplication');
  });

  it('uses the runtime default port instead of process.env.PORT', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = '4321';

    try {
      const adapter = publicNodeApi.NodeHttpApplicationAdapter.create();

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
      const adapter = publicNodeApi.NodeHttpApplicationAdapter.create();

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
    expect(publicNodeApi.NodeHttpApplicationAdapter.create).toBeTypeOf('function');
    expect(publicNodeApi).not.toHaveProperty('compressNodeResponse');
    expect(publicNodeApi).not.toHaveProperty('createNodeResponseCompression');
  });

  it('fails fast when maxBodySize is not provided as numeric bytes', () => {
    expect(() => Function.prototype.call.call(publicNodeApi.NodeHttpApplicationAdapter.create, undefined, { maxBodySize: '1mb' })).toThrow(
      'Invalid maxBodySize value: 1mb. Expected a non-negative integer number of bytes.',
    );
  });

  it('fails fast before Factory creation when maxBodySize is invalid', () => {
    class AppModule {}
    defineModule(AppModule, {});

    expect(() => createNodeTestApplication(AppModule, { maxBodySize: -1 }))
      .toThrow('Invalid maxBodySize value: -1. Expected a non-negative integer number of bytes.');
  });

  it('fails fast before Factory listener startup when maxBodySize is invalid', async () => {
    class AppModule {}
    defineModule(AppModule, {});

    await expect(
      startNodeTestApplication(AppModule, { maxBodySize: 1.5, shutdownSignals: false }),
    ).rejects.toThrow('Invalid maxBodySize value: 1.5. Expected a non-negative integer number of bytes.');
  });

  it.each([
    ['retryDelayMs', -1, 'Invalid retryDelayMs value: -1. Expected a non-negative integer.'],
    ['retryLimit', 1.5, 'Invalid retryLimit value: 1.5. Expected a non-negative integer.'],
    ['shutdownTimeoutMs', Number.NaN, 'Invalid shutdownTimeoutMs value: NaN. Expected a non-negative integer.'],
  ] as const)('fails fast when %s is not a non-negative integer', (name, value, message) => {
    expect(() => publicNodeApi.NodeHttpApplicationAdapter.create({ [name]: value })).toThrow(message);
  });
});
