import {
  createDiscordWebhookTransport,
  DISCORD_CHANNEL,
  DiscordConfigurationError,
  type DiscordFetchLike,
  DiscordMessageValidationError,
  DiscordModule,
  DiscordService,
  type DiscordTransport,
  DiscordTransportError,
} from '@fluojs/discord';
import { type NotificationChannel, NotificationsModule, NotificationsService } from '@fluojs/notifications';
import { defineModule, FluoFactory, type ModuleType } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/discord guide evidence: webhook URL construction (wait + thread_id),
 * the configurable retry policy over transient failures, permanent-status
 * fail-fast, policy validation, message validation, notifications routing,
 * and the shutdown lifecycle gate - recording fetches with baseDelayMs: 0 so
 * retry paths stay deterministic, no network, no sleeps.
 */

function okResponse(body = '{"id":"m1","channel_id":"c1"}'): DiscordFetchLike {
  return async () => ({ ok: true, status: 200, text: async () => body });
}

class RecordingFetch {
  readonly calls: Array<{ body: Record<string, unknown>; url: string }> = [];

  constructor(private readonly responses: DiscordFetchLike[] = [okResponse()]) {}

  readonly fetchLike: DiscordFetchLike = async (input, init) => {
    this.calls.push({ body: JSON.parse(init?.body ?? '{}') as Record<string, unknown>, url: input });
    const response = this.responses.shift() ?? this.responses[0];
    if (!response) {
      throw new Error('RecordingFetch ran out of scripted responses');
    }
    return await response(input, init);
  };
}

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc';

function buildTransport(fetchLike: DiscordFetchLike, retry?: { attempts: number; baseDelayMs: number }): DiscordTransport {
  return createDiscordWebhookTransport({
    fetch: fetchLike,
    ...(retry ? { retry } : {}),
    webhookUrl: WEBHOOK_URL,
  });
}

function buildAppModule(transport: DiscordTransport): ModuleType {
  class DiscordAppModule {}

  return defineModule(DiscordAppModule, {
    imports: [
      DiscordModule.forRoot({
        defaultThreadId: 'release-thread-id',
        transport,
      }),
    ],
  });
}

async function withApplicationContext<T>(
  module: ModuleType,
  run: (context: Awaited<ReturnType<typeof FluoFactory.createApplicationContext>>) => Promise<T>,
): Promise<T> {
  const context = await FluoFactory.createApplicationContext(module);
  try {
    return await run(context);
  } finally {
    await context.close();
  }
}

describe('@fluojs/discord guide examples', () => {
  it('posts one JSON payload per send with wait=true and the thread route', async () => {
    const fetch = new RecordingFetch();
    await withApplicationContext(buildAppModule(buildTransport(fetch.fetchLike)), async (context) => {
      const discord = await context.get(DiscordService);

      const result = await discord.send({
        content: 'Deploy v1.2.3 finished successfully.',
        embeds: [{ description: 'Build 124 succeeded.', title: 'Release report' }],
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('m1');
      expect(result.threadId).toBe('release-thread-id');
      expect(fetch.calls).toHaveLength(1);
      expect(fetch.calls[0]?.url).toContain('wait=true');
      expect(fetch.calls[0]?.url).toContain('thread_id=release-thread-id');
      expect(fetch.calls[0]?.body.content).toBe('Deploy v1.2.3 finished successfully.');
    });
  });

  it('retries transient 503 responses with the configured policy until success', async () => {
    const transient: DiscordFetchLike = async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '',
    });
    const fetch = new RecordingFetch([transient, transient, okResponse()]);
    await withApplicationContext(
      buildAppModule(buildTransport(fetch.fetchLike, { attempts: 3, baseDelayMs: 0 })),
      async (context) => {
        const discord = await context.get(DiscordService);

        const result = await discord.send({ content: 'after backoff' });

        expect(result.ok).toBe(true);
        expect(fetch.calls).toHaveLength(3);
      },
    );
  });

  it('fails fast on permanent statuses without retrying', async () => {
    const permanent: DiscordFetchLike = async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '',
    });
    const fetch = new RecordingFetch([permanent, okResponse()]);
    await withApplicationContext(
      buildAppModule(buildTransport(fetch.fetchLike, { attempts: 3, baseDelayMs: 0 })),
      async (context) => {
        const discord = await context.get(DiscordService);

        await expect(discord.send({ content: 'hi' })).rejects.toBeInstanceOf(DiscordTransportError);
        expect(fetch.calls).toHaveLength(1);
      },
    );
  });

  it('validates the retry policy and webhook url at transport construction', () => {
    const fetch = new RecordingFetch();

    expect(() => buildTransport(fetch.fetchLike, { attempts: 0, baseDelayMs: 250 })).toThrow(
      DiscordConfigurationError,
    );
    expect(() => buildTransport(fetch.fetchLike, { attempts: 11, baseDelayMs: 250 })).toThrow(
      DiscordConfigurationError,
    );
    expect(() => buildTransport(fetch.fetchLike, { attempts: 3, baseDelayMs: 60001 })).toThrow(
      DiscordConfigurationError,
    );
    expect(() =>
      createDiscordWebhookTransport({ fetch: fetch.fetchLike, webhookUrl: 'not-a-url' }),
    ).toThrow(DiscordConfigurationError);
  });

  it('rejects messages without Discord-visible content', async () => {
    const fetch = new RecordingFetch();
    await withApplicationContext(buildAppModule(buildTransport(fetch.fetchLike)), async (context) => {
      const discord = await context.get(DiscordService);

      await expect(discord.send({})).rejects.toBeInstanceOf(DiscordMessageValidationError);
      expect(fetch.calls).toHaveLength(0);
    });
  });

  it('routes one notification dispatch to one thread through the notifications foundation', async () => {
    const fetch = new RecordingFetch();

    class RoutedAppModule {}

    await withApplicationContext(
      defineModule(RoutedAppModule, {
        imports: [
          DiscordModule.forRoot({ defaultThreadId: 'release-thread-id', transport: buildTransport(fetch.fetchLike) }),
          NotificationsModule.forRootAsync({
            inject: [DISCORD_CHANNEL],
            useFactory: (...deps: unknown[]) => ({ channels: deps as NotificationChannel[] }),
          }),
        ],
      }),
      async (context) => {
        const notifications = await context.get(NotificationsService);

        const result = await notifications.dispatch({
          channel: 'discord',
          recipients: ['thread-9'],
          subject: 'New order received',
          payload: { content: 'Order #123 is ready for review.' },
        });
        expect(result.status).toBe('delivered');
        expect(fetch.calls[0]?.url).toContain('thread_id=thread-9');

        // Fan-out is never implicit: two recipients are a validation error.
        await expect(
          notifications.dispatch({
            channel: 'discord',
            recipients: ['thread-9', 'thread-10'],
            payload: { content: 'hi' },
          }),
        ).rejects.toBeInstanceOf(DiscordMessageValidationError);
      },
    );
  });

  it('rejects sends after shutdown with the lifecycle gate', async () => {
    const fetch = new RecordingFetch();
    const context = await FluoFactory.createApplicationContext(buildAppModule(buildTransport(fetch.fetchLike)));
    const discord = await context.get(DiscordService);

    await discord.send({ content: 'before close' });
    await context.close();

    await expect(discord.send({ content: 'after close' })).rejects.toThrow(
      'Discord transport is shutting down or already stopped.',
    );
  });
});
