import { describe, expect, it, vi } from 'vitest';

import { DiscordTransportError } from './errors.js';
import type { DiscordFetchLike } from './types.js';
import { createDiscordWebhookTransport } from './webhook.js';

describe('Discord webhook retries', () => {
  it.each([408, 429, 502])('retries transient HTTP %s responses before succeeding', async (status) => {
    vi.useFakeTimers();

    try {
      const fetchLike = vi
        .fn<DiscordFetchLike>()
        .mockResolvedValueOnce({
          ok: false,
          status,
          async text() {
            return 'temporary provider response';
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ id: `msg-${String(status)}` });
          },
        });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      const pending = transport.send(
        { attachments: [], components: [], content: `Retry HTTP ${String(status)}`, embeds: [] },
        {},
      );
      const expectation = expect(pending).resolves.toMatchObject({
        messageId: `msg-${String(status)}`,
        ok: true,
        statusCode: 200,
      });
      await vi.runAllTimersAsync();

      await expectation;
      expect(fetchLike).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries transport-level exceptions before succeeding', async () => {
    vi.useFakeTimers();

    try {
      const fetchLike = vi
        .fn<DiscordFetchLike>()
        .mockRejectedValueOnce(new Error('provider response contained a secret'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ id: 'msg-retried' });
          },
        });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      const pending = transport.send(
        { attachments: [], components: [], content: 'Retry transport failure', embeds: [] },
        {},
      );
      const expectation = expect(pending).resolves.toMatchObject({
        messageId: 'msg-retried',
        ok: true,
        statusCode: 200,
      });
      await vi.runAllTimersAsync();

      await expectation;
      expect(fetchLike).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a sanitized status error after transient retries are exhausted', async () => {
    vi.useFakeTimers();

    try {
      const fetchLike = vi.fn<DiscordFetchLike>().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        async text() {
          return '{"token":"secret","detail":"provider unavailable"}';
        },
      });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      const pending = transport.send(
        { attachments: [], components: [], content: 'Retry exhausted status', embeds: [] },
        {},
      );
      const expectation = expect(pending).rejects.toThrowError(
        new DiscordTransportError(
          'Discord webhook delivery failed with status 503 Service Unavailable after 3 attempt(s). Upstream response body was omitted from the caller-visible error.',
        ),
      );
      await vi.runAllTimersAsync();

      await expectation;
      expect(fetchLike).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry permanent HTTP failures', async () => {
    const fetchLike = vi.fn<DiscordFetchLike>().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      async text() {
        return '{"token":"secret","detail":"invalid request"}';
      },
    });
    const transport = createDiscordWebhookTransport({
      fetch: fetchLike,
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });

    await expect(
      transport.send({ attachments: [], components: [], content: 'Permanent failure', embeds: [] }, {}),
    ).rejects.toThrowError(
      new DiscordTransportError(
        'Discord webhook delivery failed with status 400 Bad Request after 1 attempt(s). Upstream response body was omitted from the caller-visible error.',
      ),
    );
    expect(fetchLike).toHaveBeenCalledOnce();
  });
});
