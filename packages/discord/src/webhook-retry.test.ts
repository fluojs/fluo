import { describe, expect, it, vi } from 'vitest';

import { DiscordConfigurationError, DiscordTransportError } from './errors.js';
import type { DiscordFetchLike } from './types.js';
import { createDiscordWebhookTransport } from './webhook.js';

describe('Discord webhook retries', () => {
  it('retries transient HTTP responses at exact exponential backoff boundaries', async () => {
    vi.useFakeTimers();

    try {
      const fetchLike = vi
        .fn<DiscordFetchLike>()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          async text() {
            return 'temporary provider response';
          },
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          async text() {
            return 'temporary provider response';
          },
        })
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
        { attachments: [], components: [], content: 'Retry HTTP backoff boundaries', embeds: [] },
        {},
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchLike).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(249);
      expect(fetchLike).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(fetchLike).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(499);
      expect(fetchLike).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toMatchObject({
        messageId: 'msg-retried',
        ok: true,
        statusCode: 200,
      });
      expect(fetchLike).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the default three-attempt policy with a 250ms initial backoff', async () => {
    vi.useFakeTimers();

    try {
      const fetchLike = vi
        .fn<DiscordFetchLike>()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          async text() {
            return 'rate limited';
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ id: 'msg-default-backoff' });
          },
        });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      const pending = transport.send(
        { attachments: [], components: [], content: 'Default retry policy', embeds: [] },
        {},
      );
      await vi.advanceTimersByTimeAsync(249);

      expect(fetchLike).toHaveBeenCalledOnce();

      const expectation = expect(pending).resolves.toMatchObject({
        messageId: 'msg-default-backoff',
        ok: true,
        statusCode: 200,
      });
      await vi.advanceTimersByTimeAsync(1);

      await expectation;
      expect(fetchLike).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the configured attempt budget and initial backoff delay', async () => {
    vi.useFakeTimers();

    try {
      const fetchLike = vi.fn<DiscordFetchLike>().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        async text() {
          return 'temporary provider response';
        },
      });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        retry: {
          attempts: 2,
          baseDelayMs: 75,
        },
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      const pending = transport.send(
        { attachments: [], components: [], content: 'Configured retry policy', embeds: [] },
        {},
      );
      const expectation = expect(pending).rejects.toThrowError(
        new DiscordTransportError(
          'Discord webhook delivery failed with status 503 Service Unavailable after 2 attempt(s). Upstream response body was omitted from the caller-visible error.',
        ),
      );
      await vi.advanceTimersByTimeAsync(74);

      expect(fetchLike).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);

      await expectation;
      expect(fetchLike).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      retry: { attempts: 0 },
      message: 'Discord webhook transport `retry.attempts` must be an integer between 1 and 10.',
    },
    {
      retry: { attempts: 11 },
      message: 'Discord webhook transport `retry.attempts` must be an integer between 1 and 10.',
    },
    {
      retry: { baseDelayMs: -1 },
      message: 'Discord webhook transport `retry.baseDelayMs` must be an integer between 0 and 60000.',
    },
    {
      retry: { baseDelayMs: 60_001 },
      message: 'Discord webhook transport `retry.baseDelayMs` must be an integer between 0 and 60000.',
    },
  ])('rejects an out-of-bounds retry configuration', ({ retry, message }) => {
    expect(() =>
      createDiscordWebhookTransport({
        fetch: vi.fn<DiscordFetchLike>(),
        retry,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      }),
    ).toThrowError(new DiscordConfigurationError(message));
  });

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
