import { describe, expect, it, vi } from 'vitest';

import type { DiscordFetchLike } from './types.js';
import { createDiscordWebhookTransport } from './webhook.js';

describe('Discord webhook retry cancellation', () => {
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
