import { describe, expect, it, vi } from 'vitest';

import type { DiscordFetchLike } from './types.js';
import { createDiscordWebhookTransport } from './webhook.js';

describe('Discord webhook retry cancellation', () => {
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

  it.each([200, 503])('preserves the HTTP %s body AbortError without a caller signal', async (status) => {
    vi.useFakeTimers();

    try {
      const abortError = new DOMException('reader cancelled', 'AbortError');
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
