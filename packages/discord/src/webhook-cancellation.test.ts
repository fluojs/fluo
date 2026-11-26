import { rejects } from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import type { DiscordFetchLike } from './types.js';

function createForeignAbortError(): unknown {
  return runInNewContext('Object.assign(new Error("reader cancelled"), { name: "AbortError" })');
}

const vitest = process.env.NODE_TEST_CONTEXT === undefined
  ? { ...await import('vitest'), ...await import('./webhook.js') }
  : undefined;

if (!vitest) {
  const { test } = await import('node:test');
  const { createDiscordWebhookTransport } = await import('../dist/webhook.js');

  test('Discord webhook preserves the cross-realm HTTP 200 body AbortError', async () => {
    const abortError = createForeignAbortError();
    const transport = createDiscordWebhookTransport({
      async fetch() {
        return {
          ok: true,
          status: 200,
          async text() {
            throw abortError;
          },
        };
      },
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });

    await rejects(
      transport.send({ attachments: [], components: [], content: 'Cancel body read', embeds: [] }, {}),
      (error: unknown) => error === abortError,
    );
  });
}

vitest?.describe('Discord webhook retry cancellation', () => {
  const { createDiscordWebhookTransport, expect, it, vi } = vitest;

  it.each([200, 429])('preserves the signal reason when reading an HTTP %s body is cancelled', async (status) => {
    vi.useFakeTimers();

    try {
      const controller = new AbortController();
      const reason = status === 200 ? new Error('caller cancelled the body read') : null;
      const fetchLike = vi.fn<DiscordFetchLike>().mockResolvedValue({
        ok: status === 200,
        status,
        async text() {
          controller.abort(reason);
          throw new DOMException('reader cancelled', 'AbortError');
        },
      });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      await expect(
        transport.send(
          { attachments: [], components: [], content: 'Cancel body read', embeds: [] },
          { signal: controller.signal },
        ),
      ).rejects.toBe(reason);
      expect(fetchLike).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [200, 'same-realm', () => new DOMException('reader cancelled', 'AbortError')],
    [503, 'same-realm', () => new DOMException('reader cancelled', 'AbortError')],
    [200, 'cross-realm', createForeignAbortError],
    [503, 'cross-realm', createForeignAbortError],
  ] as const)('preserves the HTTP %s %s body AbortError without a caller signal', async (status, _realm, createAbortError) => {
    vi.useFakeTimers();

    try {
      const abortError = createAbortError();
      const fetchLike = vi.fn<DiscordFetchLike>().mockResolvedValue({
        ok: status === 200,
        status,
        async text() {
          throw abortError;
        },
      });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      const pending = transport.send({ attachments: [], components: [], content: 'Cancel body read', embeds: [] }, {});
      const outcome = pending.then(
        (receipt) => receipt,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(0);
      const backoffs = vi.getTimerCount();
      await vi.runAllTimersAsync();

      expect(await outcome).toBe(abortError);
      expect(fetchLike).toHaveBeenCalledOnce();
      expect(backoffs).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not make a zero-delay retry request after cancellation when fetch ignores the signal', async () => {
    const controller = new AbortController();
    const reason = new DOMException('zero-delay retry cancelled', 'AbortError');
    const fetchLike = vi
      .fn<DiscordFetchLike>()
      .mockImplementationOnce(async () => {
        controller.abort(reason);

        return {
          ok: false,
          status: 429,
          async text() {
            return 'rate limited';
          },
        };
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ id: 'should-not-send' });
        },
      });
    const transport = createDiscordWebhookTransport({
      fetch: fetchLike,
      retry: { baseDelayMs: 0 },
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });

    await expect(
      transport.send(
        { attachments: [], components: [], content: 'Zero-delay retry abort path', embeds: [] },
        { signal: controller.signal },
      ),
    ).rejects.toBe(reason);
    expect(fetchLike).toHaveBeenCalledOnce();
  });

  it('does not start retry backoff when the signal is already aborted', async () => {
    vi.useFakeTimers();

    try {
      const controller = new AbortController();
      const reason = new DOMException('retry cancelled', 'AbortError');
      const fetchLike = vi.fn<DiscordFetchLike>().mockResolvedValue({
        ok: false,
        status: 429,
        async text() {
          return 'rate limited';
        },
      });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });
      controller.abort(reason);

      const pending = transport.send(
        { attachments: [], components: [], content: 'Retry abort path', embeds: [] },
        { signal: controller.signal },
      );
      let rejection: unknown;
      pending.catch((error: unknown) => {
        rejection = error;
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(rejection).toBe(reason);
      expect(fetchLike).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
