import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Constructor, Token } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';

import { DiscordChannel } from './channel.js';
import { DiscordConfigurationError, DiscordMessageValidationError, DiscordTransportError } from './errors.js';
import { DiscordModule } from './module.js';
import { DiscordService } from './service.js';
import { DISCORD } from './tokens.js';
import { createDiscordWebhookTransport } from './webhook.js';
import type {
  Discord,
  DiscordFetchLike,
  DiscordTransport,
  DiscordTransportFactory,
  NormalizedDiscordMessage,
} from './types.js';

const transportState = vi.hoisted(() => ({
  closeCalls: 0,
  sent: [] as NormalizedDiscordMessage[],
  sequence: 0,
  verifyCalls: 0,
}));

class RecordingTransport implements DiscordTransport {
  constructor(private readonly responsePrefix: string) {}

  async close(): Promise<void> {
    transportState.closeCalls += 1;
  }

  async send(message: NormalizedDiscordMessage) {
    transportState.sequence += 1;
    transportState.sent.push(message);

    return {
      channelId: 'channel-1',
      guildId: 'guild-1',
      messageId: `${this.responsePrefix}-${transportState.sequence}`,
      ok: true,
      response: JSON.stringify({ id: `${this.responsePrefix}-${transportState.sequence}` }),
      statusCode: 200,
      threadId: message.threadId,
      warnings: [],
    };
  }

  async verify(): Promise<void> {
    transportState.verifyCalls += 1;
  }
}

class PassiveTransport implements DiscordTransport {
  readonly sent: string[] = [];

  async send(message: NormalizedDiscordMessage) {
    this.sent.push(message.content ?? '');

    return {
      messageId: 'passive-1',
      ok: true,
      response: 'ok',
      statusCode: 200,
      threadId: message.threadId,
      warnings: [],
    };
  }
}

class UnsuccessfulTransport implements DiscordTransport {
  async send() {
    return {
      ok: false,
      response: 'denied',
      statusCode: 200,
      warnings: [],
    };
  }
}

function createRecordingTransportFactory(
  overrides: Partial<Pick<DiscordTransportFactory, 'kind' | 'ownsResources'>> & { responsePrefix?: string } = {},
): DiscordTransportFactory {
  return {
    create: async () => new RecordingTransport(overrides.responsePrefix ?? 'message'),
    kind: overrides.kind ?? 'recording-transport',
    ownsResources: overrides.ownsResources ?? true,
  };
}

function moduleProviders(moduleType: Constructor): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    throw new Error('DiscordModule did not register providers metadata.');
  }

  return metadata.providers as Provider[];
}

describe('DiscordModule', () => {
  beforeEach(() => {
    transportState.closeCalls = 0;
    transportState.sent.length = 0;
    transportState.sequence = 0;
    transportState.verifyCalls = 0;
  });

  it('registers sync providers and delivers Discord messages through an injected transport factory', async () => {
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      defaultThreadId: 'thread-ops',
      transport: createRecordingTransportFactory(),
      verifyOnModuleInit: true,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);
    await service.onModuleInit();

    const result = await service.send({
      content: 'Deploy finished.',
    });

    expect(result).toMatchObject({
      messageId: 'message-1',
      ok: true,
      threadId: 'thread-ops',
    });
    expect(transportState.verifyCalls).toBe(1);
    expect(transportState.sent[0]).toMatchObject({
      content: 'Deploy finished.',
      threadId: 'thread-ops',
    });

    await service.onApplicationShutdown();
    expect(transportState.closeCalls).toBe(1);
  });

  it('resolves async options once and exposes the compatibility facade and channel token', async () => {
    const DISCORD_CONFIG = Symbol('discord-config');
    const factoryCalls: string[] = [];
    const container = new Container();
    const moduleType = DiscordModule.forRootAsync({
      inject: [DISCORD_CONFIG],
      useFactory: async (...deps: unknown[]) => {
        const [threadId] = deps;

        if (typeof threadId !== 'string') {
          throw new Error('default thread id must be a string');
        }

        factoryCalls.push(threadId);

        return {
          defaultThreadId: threadId,
          notifications: { channel: 'alerts' },
          transport: createRecordingTransportFactory({ kind: `factory:${threadId}`, responsePrefix: 'async' }),
        };
      },
    });

    container.register({ provide: DISCORD_CONFIG as Token<string>, useValue: 'thread-release' }, ...moduleProviders(moduleType));

    const facade = await container.resolve<Discord>(DISCORD);
    const channel = await container.resolve(DiscordChannel);
    const result = await facade.send({ content: 'Shipped' });

    expect(result.messageId).toBe('async-1');
    expect(result.threadId).toBe('thread-release');
    expect(channel.channel).toBe('alerts');
    expect(factoryCalls).toEqual(['thread-release']);
  });

  it('renders notification templates and adapts them through DiscordChannel', async () => {
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      renderer: {
        async render(input) {
          return {
            content: `Hello ${String(input.payload.userId)}`,
            embeds: [{ description: `Subject ${String(input.subject)}` }],
          };
        },
      },
      transport: createRecordingTransportFactory({ responsePrefix: 'channel' }),
    });

    container.register(...moduleProviders(moduleType));
    const channel = await container.resolve(DiscordChannel);

    const result = await channel.send(
      {
        channel: 'discord',
        payload: { userId: 'user-1' },
        recipients: ['thread-product'],
        subject: 'Welcome',
        template: 'welcome',
      },
      {},
    );

    expect(result.externalId).toBe('channel-1');
    expect(transportState.sent[0]).toMatchObject({
      content: 'Hello user-1',
      threadId: 'thread-product',
    });
    expect(transportState.sent[0]?.embeds).toHaveLength(1);
  });

  it('creates a webhook-first transport with an explicit fetch-compatible boundary', async () => {
    const calls: Array<{ body?: string; input: string; method?: string }> = [];
    const fetchLike: DiscordFetchLike = async (input, init) => {
      calls.push({ body: init?.body, input, method: init?.method });

      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ channel_id: 'chan-1', guild_id: 'guild-1', id: 'msg-1' });
        },
      };
    };
    const transport = createDiscordWebhookTransport({
      fetch: fetchLike,
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });

    const result = await transport.send(
      {
        attachments: [],
        components: [],
        content: 'Webhook path',
        embeds: [],
        threadId: 'thread-ops',
      },
      {},
    );

    expect(result).toMatchObject({ messageId: 'msg-1', ok: true, statusCode: 200, threadId: 'thread-ops' });
    expect(calls).toEqual([
      {
        body: JSON.stringify({ content: 'Webhook path' }),
        input: 'https://discord.com/api/webhooks/123/abc?wait=true&thread_id=thread-ops',
        method: 'POST',
      },
    ]);
  });

  it('rejects multi-recipient notification fan-out inside one Discord dispatch', async () => {
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      transport: createRecordingTransportFactory(),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);

    await expect(
      service.sendNotification({
        channel: 'discord',
        payload: { content: 'Fan-out not allowed' },
        recipients: ['thread-eng', 'thread-ops'],
      }),
    ).rejects.toThrowError(
      new DiscordMessageValidationError(
        'Discord notifications accept exactly one target thread per dispatch. Use `sendMany(...)` for fan-out delivery.',
      ),
    );
  });

  it('surfaces an unsuccessful transport receipt as a notifications channel failure', async () => {
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      transport: new UnsuccessfulTransport(),
    });

    container.register(...moduleProviders(moduleType));
    const channel = await container.resolve(DiscordChannel);

    await expect(
      channel.send(
        {
          channel: 'discord',
          payload: { content: 'Denied' },
          recipients: ['thread-ops'],
        },
        {},
      ),
    ).rejects.toThrowError(new DiscordTransportError('Discord transport reported an unsuccessful delivery.'));
  });

  it('retries transient webhook failures with exponential backoff before succeeding', async () => {
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
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          async text() {
            return '{"message":"temporary outage"}';
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ channel_id: 'chan-1', guild_id: 'guild-1', id: 'msg-1' });
          },
        });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      const pending = transport.send({ attachments: [], components: [], content: 'Retry path', embeds: [], threadId: 'thread-ops' }, {});
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toMatchObject({ messageId: 'msg-1', ok: true, statusCode: 200, threadId: 'thread-ops' });
      expect(fetchLike).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sanitizes webhook failure errors after bounded retries', async () => {
    vi.useFakeTimers();

    try {
      const fetchLike = vi.fn<DiscordFetchLike>().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        async text() {
          return '{"token":"secret","detail":"should not leak"}';
        },
      });
      const transport = createDiscordWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      });

      const pending = transport.send({ attachments: [], components: [], content: 'Retry path', embeds: [], threadId: 'thread-ops' }, {});
      const expectation = expect(pending).rejects.toThrowError(
        new DiscordTransportError(
          'Discord webhook delivery failed with status 500 Internal Server Error after 3 attempt(s). Upstream response body was omitted from the caller-visible error.',
        ),
      );
      await vi.runAllTimersAsync();

      await expectation;
      expect(fetchLike).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts custom provider-backed transports without bootstrap verification', async () => {
    const transport = new PassiveTransport();
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      defaultThreadId: 'thread-provider',
      transport,
    });

    container.register(...moduleProviders(moduleType));
    const facade = await container.resolve<Discord>(DISCORD);
    const result = await facade.send({ content: 'Provider transport' });

    expect(result.ok).toBe(true);
    expect(result.threadId).toBe('thread-provider');
    expect(transport.sent).toEqual(['Provider transport']);
    expect(transportState.verifyCalls).toBe(0);
  });

  it('rejects module registration without an explicit transport contract', () => {
    expect(() =>
      DiscordModule.forRoot({
        defaultThreadId: 'thread-ops',
      } as never),
    ).toThrowError(new DiscordConfigurationError('DiscordModule requires an explicit `transport` to be configured.'));
  });
});
