import { describe, expect, it } from 'vitest';

import { createNodeHttpAdapter, NodeHttpApplicationAdapter } from './node.js';

describe('createNodeHttpAdapter', () => {
  it('uses the runtime default port instead of process.env.PORT', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = '4321';

    try {
      const adapter = createNodeHttpAdapter() as NodeHttpApplicationAdapter;

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
      const adapter = createNodeHttpAdapter() as NodeHttpApplicationAdapter;

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
});
