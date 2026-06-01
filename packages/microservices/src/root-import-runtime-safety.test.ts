import { describe, expect, it, vi } from 'vitest';

const netMockState = vi.hoisted(() => ({
  loads: 0,
}));

describe('@fluojs/microservices root import runtime safety', () => {
  it('does not load node:net until TCP listen or outbound construction paths run', async () => {
    vi.resetModules();
    vi.doMock('node:net', () => {
      netMockState.loads += 1;

      return {
        Socket: class MockSocket {},
        createServer: () => {
          throw new Error('node:net should be loaded lazily by TCP runtime paths only');
        },
      };
    });

    try {
      const microservices = await import('./index.js');

      expect(microservices).toHaveProperty('MicroservicesModule');
      expect(microservices).toHaveProperty('TcpMicroserviceTransport');
      expect(netMockState.loads).toBe(0);

      const transport = new microservices.TcpMicroserviceTransport({ port: 0 });

      expect(transport).toBeInstanceOf(microservices.TcpMicroserviceTransport);
      expect(netMockState.loads).toBe(0);
      await expect(transport.listen(async () => undefined)).rejects.toThrow(
        'node:net should be loaded lazily by TCP runtime paths only',
      );
      expect(netMockState.loads).toBe(1);
    } finally {
      vi.doUnmock('node:net');
    }
  });
});
