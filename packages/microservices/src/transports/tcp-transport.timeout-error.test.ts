import { describe, expect, it, vi } from 'vitest';

import { TcpMicroserviceTransport } from './tcp-transport.js';

describe('TcpMicroserviceTransport request failures', () => {
  it('rejects a non-responding request after requestTimeoutMs instead of leaving it pending', async () => {
    // Given
    vi.useFakeTimers();
    const requestTimeoutMs = 1_500;
    const controller = new AbortController();
    let markHandlerEntered: () => void = () => undefined;
    const handlerEntered = new Promise<void>((resolve) => {
      markHandlerEntered = resolve;
    });
    const handler = vi.fn(async () => {
      markHandlerEntered();
      return await new Promise<never>(() => undefined);
    });
    const transport = new TcpMicroserviceTransport({ port: 0, requestTimeoutMs });

    try {
      await transport.listen(handler);

      // When
      const sending = transport.send('inventory.reserve-preview', { sku: 'sku-1' }, controller.signal);
      const rejected = vi.fn();
      void sending.then(() => undefined, rejected);
      await handlerEntered;

      // Then
      expect(handler).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(requestTimeoutMs - 1);
      expect(rejected).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(rejected).toHaveBeenCalledOnce();
      await expect(sending).rejects.toThrow(`Microservice TCP request timed out after ${String(requestTimeoutMs)}ms.`);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort();
      try {
        await transport.close();
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it('receives a thrown remote handler error frame and rejects send with its documented message', async () => {
    // Given
    const remoteErrorMessage = 'Product not found';
    const handler = vi.fn(async () => {
      throw new Error(remoteErrorMessage);
    });
    const transport = new TcpMicroserviceTransport({ port: 0, requestTimeoutMs: 1_000 });

    try {
      await transport.listen(handler);

      // When
      const sending = transport.send('catalog.get', { productId: 'missing-product' });

      // Then
      await expect(sending).rejects.toMatchObject({
        message: remoteErrorMessage,
        name: 'Error',
      });
      await expect(sending).rejects.not.toHaveProperty('code');
      expect(handler).toHaveBeenCalledWith({
        kind: 'message',
        pattern: 'catalog.get',
        payload: { productId: 'missing-product' },
        requestId: expect.any(String),
      });
    } finally {
      await transport.close();
    }
  });
});
