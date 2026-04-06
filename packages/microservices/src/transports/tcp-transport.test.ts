import { describe, expect, it, vi } from 'vitest';

import { TcpMicroserviceTransport } from './tcp-transport.js';

describe('TcpMicroserviceTransport', () => {
  it('removes abort listener after a request completes normally', async () => {
    const port = 40_000 + Math.floor(Math.random() * 10_000);
    const transport = new TcpMicroserviceTransport({ port, requestTimeoutMs: 1_000 });

    await transport.listen(async () => 'ok');

    const controller = new AbortController();
    const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener');

    await expect(transport.send('success.pattern', {}, controller.signal)).resolves.toBe('ok');

    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));

    await transport.close();
  });
});
