import type { Constructor, Token } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { NOTIFICATION_CHANNELS, NotificationsModule, NotificationsService } from '@fluojs/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscordChannel } from './channel.js';
import { DiscordConfigurationError, DiscordMessageValidationError, DiscordTransportError } from './errors.js';
import { DiscordModule } from './module.js';
import { DiscordService } from './service.js';
import { DISCORD, DISCORD_CHANNEL } from './tokens.js';
import type {
  Discord,
  DiscordFetchLike,
  DiscordTransport,
  DiscordTransportFactory,
  NormalizedDiscordMessage,
} from './types.js';
import { createDiscordWebhookTransport } from './webhook.js';

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
  closeCalls = 0;
  readonly sent: string[] = [];
  verifyCalls = 0;

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

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

  async verify(): Promise<void> {
    this.verifyCalls += 1;
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

class SelectiveFailureDiscordTransport implements DiscordTransport {
  readonly sent: string[] = [];

  async send(message: NormalizedDiscordMessage) {
    const content = message.content ?? '';
    this.sent.push(content);

    if (content.includes('fail')) {
      throw new Error(`provider rejected ${content}`);
    }

    return {
      messageId: `selective-${this.sent.length}`,
      ok: true,
      response: 'ok',
      statusCode: 200,
      threadId: message.threadId,
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
    const service = await container.resolve(DiscordService);
    const channel = await container.resolve(DiscordChannel);
    await service.onModuleInit();

    const result = await facade.send({ content: 'Shipped' });

    expect(result.messageId).toBe('async-1');
    expect(result.threadId).toBe('thread-release');
    expect(channel.channel).toBe('alerts');
    expect(factoryCalls).toEqual(['thread-release']);
  });

  it('wires module-first async Discord and notifications registration through DISCORD_CHANNEL', async () => {
    const DISCORD_CONFIG = Symbol('discord-config');
    const container = new Container();
    const discordModuleType = DiscordModule.forRootAsync({
      inject: [DISCORD_CONFIG],
      useFactory: async (...deps: unknown[]) => {
        const [defaultThreadId] = deps;

        if (typeof defaultThreadId !== 'string') {
          throw new Error('default thread id must be a string');
        }

        return {
          defaultThreadId,
          notifications: { channel: ' alerts ' },
          transport: createRecordingTransportFactory({ responsePrefix: 'integration' }),
        };
      },
    });
    const notificationsModuleType = NotificationsModule.forRootAsync({
      inject: [DISCORD_CHANNEL],
      useFactory: async (...deps: unknown[]) => {
        const [channel] = deps;

        return {
          channels: [channel as DiscordChannel],
        };
      },
    });

    container.register(
      { provide: DISCORD_CONFIG as Token<string>, useValue: ' thread-release ' },
      ...moduleProviders(discordModuleType),
      ...moduleProviders(notificationsModuleType),
    );

    const notifications = await container.resolve(NotificationsService);
    const service = await container.resolve(DiscordService);
    const channels = await container.resolve(NOTIFICATION_CHANNELS);
    await service.onModuleInit();

    const result = await notifications.dispatch({
      channel: 'alerts',
      metadata: { source: 'ci' },
      payload: {
        content: 'Async integration ready',
        metadata: { correlationId: 'deploy-1' },
      },
    });

    expect(result).toMatchObject({
      channel: 'alerts',
      deliveryId: 'integration-1',
      queued: false,
      status: 'delivered',
    });
    expect(channels.map((channel: { channel: string }) => channel.channel)).toEqual(['alerts']);
    expect(transportState.sent[0]).toMatchObject({
      content: 'Async integration ready',
      metadata: {
        correlationId: 'deploy-1',
        source: 'ci',
      },
      threadId: 'thread-release',
    });
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
    const service = await container.resolve(DiscordService);
    const channel = await container.resolve(DiscordChannel);
    await service.onModuleInit();

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

  it('serializes the documented Discord webhook payload fields through the built-in transport', async () => {
    const calls: Array<{ body?: string; input: string; method?: string }> = [];
    const fetchLike: DiscordFetchLike = async (input, init) => {
      calls.push({ body: init?.body, input, method: init?.method });

      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ id: 'msg-1', thread_id: 'thread-ops' });
        },
      };
    };
    const transport = createDiscordWebhookTransport({
      fetch: fetchLike,
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });

    await transport.send(
      {
        allowedMentions: { parse: ['users'] },
        attachments: [{ id: '0', filename: 'deploy.txt' }],
        avatarUrl: 'https://cdn.example.com/avatar.png',
        components: [{ type: 1 }],
        content: 'Deploy finished',
        embeds: [{ description: 'Build 124 succeeded.' }],
        flags: 4096,
        metadata: { correlationId: 'deploy-1' },
        poll: { question: { text: 'Ship?' } },
        threadId: 'thread-ops',
        threadName: 'Deploy thread',
        tts: true,
        username: 'Deploy Bot',
      },
      {},
    );

    expect(calls).toEqual([
      {
        body: JSON.stringify({
          allowed_mentions: { parse: ['users'] },
          attachments: [{ id: '0', filename: 'deploy.txt' }],
          avatar_url: 'https://cdn.example.com/avatar.png',
          components: [{ type: 1 }],
          content: 'Deploy finished',
          embeds: [{ description: 'Build 124 succeeded.' }],
          flags: 4096,
          poll: { question: { text: 'Ship?' } },
          thread_name: 'Deploy thread',
          tts: true,
          username: 'Deploy Bot',
        }),
        input: 'https://discord.com/api/webhooks/123/abc?wait=true&thread_id=thread-ops',
        method: 'POST',
      },
    ]);
  });

  it('classifies malformed webhook configuration as a configuration error before delivery starts', () => {
    expect(() =>
      createDiscordWebhookTransport({
        fetch: vi.fn<DiscordFetchLike>(),
        webhookUrl: 'not-a-valid-webhook-url',
      }),
    ).toThrowError(
      new DiscordConfigurationError('Discord webhook transport requires a valid absolute `webhookUrl`.'),
    );
  });

  it('rejects sends before module bootstrap marks the transport ready', async () => {
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      transport: createRecordingTransportFactory(),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);

    await expect(service.send({ content: 'Before bootstrap' })).rejects.toThrowError(
      new DiscordTransportError('Discord transport is not ready for delivery.'),
    );
    expect(transportState.sent).toEqual([]);
  });

  it('accepts poll-only Discord payloads documented by the notifications contract', async () => {
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      transport: createRecordingTransportFactory({ responsePrefix: 'poll' }),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);
    await service.onModuleInit();

    const result = await service.sendNotification({
      channel: 'discord',
      payload: {
        poll: { question: { text: 'Ship?' } },
      },
    });

    expect(result.messageId).toBe('poll-1');
    expect(transportState.sent[0]).toMatchObject({
      poll: { question: { text: 'Ship?' } },
    });
  });

  it('rejects multi-recipient notification fan-out inside one Discord dispatch', async () => {
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      transport: createRecordingTransportFactory(),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);
    await service.onModuleInit();

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

  it('delivers sendMany messages sequentially as direct Discord message batches', async () => {
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      defaultThreadId: 'thread-ops',
      transport: createRecordingTransportFactory({ responsePrefix: 'batch' }),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);
    await service.onModuleInit();

    const result = await service.sendMany([{ content: 'one' }, { content: 'two' }, { content: 'three' }]);

    expect(result).toMatchObject({ failed: 0, succeeded: 3 });
    expect(result.results.map((entry) => entry.messageId)).toEqual(['batch-1', 'batch-2', 'batch-3']);
    expect(transportState.sent.map((entry) => entry.content)).toEqual(['one', 'two', 'three']);
  });

  it('stops sendMany at the first provider error by default', async () => {
    const transport = new SelectiveFailureDiscordTransport();
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      defaultThreadId: 'thread-ops',
      transport,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);
    await service.onModuleInit();

    await expect(service.sendMany([{ content: 'ok-1' }, { content: 'fail-2' }, { content: 'ok-3' }])).rejects.toThrowError(
      'provider rejected fail-2',
    );
    expect(transport.sent).toEqual(['ok-1', 'fail-2']);
  });

  it('collects sendMany failures when continueOnError is enabled', async () => {
    const transport = new SelectiveFailureDiscordTransport();
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      defaultThreadId: 'thread-ops',
      transport,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);
    await service.onModuleInit();

    const result = await service.sendMany([{ content: 'ok-1' }, { content: 'fail-2' }, { content: 'ok-3' }], {
      continueOnError: true,
    });

    expect(result).toMatchObject({ failed: 1, succeeded: 2 });
    expect(result.failures[0]?.error).toMatchObject({ message: 'provider rejected fail-2' });
    expect(result.results.map((entry) => entry.messageId)).toEqual(['selective-1', 'selective-3']);
    expect(transport.sent).toEqual(['ok-1', 'fail-2', 'ok-3']);
  });

  it('surfaces an unsuccessful transport receipt as a notifications channel failure', async () => {
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      transport: new UnsuccessfulTransport(),
    });

    container.register(...moduleProviders(moduleType));
    const channel = await container.resolve(DiscordChannel);
    const service = await container.resolve(DiscordService);
    await service.onModuleInit();

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

  it('does not retry permanent webhook failures', async () => {
    const fetchLike = vi.fn<DiscordFetchLike>().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      async text() {
        return '{"message":"invalid request"}';
      },
    });
    const transport = createDiscordWebhookTransport({
      fetch: fetchLike,
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });

    await expect(
      transport.send({ attachments: [], components: [], content: 'Permanent failure', embeds: [], threadId: 'thread-ops' }, {}),
    ).rejects.toThrowError(
      new DiscordTransportError(
        'Discord webhook delivery failed with status 400 Bad Request after 1 attempt(s). Upstream response body was omitted from the caller-visible error.',
      ),
    );
    expect(fetchLike).toHaveBeenCalledTimes(1);
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
    const service = await container.resolve(DiscordService);
    await service.onModuleInit();

    const result = await facade.send({ content: 'Provider transport' });

    expect(result.ok).toBe(true);
    expect(result.threadId).toBe('thread-provider');
    expect(transport.sent).toEqual(['Provider transport']);
    expect(transport.verifyCalls).toBe(0);
  });

  it('preserves direct transport ownership across bootstrap and shutdown lifecycle hooks', async () => {
    const transport = new PassiveTransport();
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      defaultThreadId: 'thread-owned-by-app',
      transport,
      verifyOnModuleInit: true,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);

    await service.onModuleInit();
    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: {
        lifecycleState: 'ready',
        transportKind: 'custom-instance',
        verifiedOnModuleInit: true,
      },
      ownership: {
        externallyManaged: true,
        ownsResources: false,
      },
      readiness: { critical: true, status: 'ready' },
    });

    await service.send({ content: 'App-owned transport' });
    await service.onApplicationShutdown();

    expect(transport.sent).toEqual(['App-owned transport']);
    expect(transport.closeCalls).toBe(0);
    expect(transport.verifyCalls).toBe(1);
    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: { lifecycleState: 'stopped' },
      ownership: {
        externallyManaged: true,
        ownsResources: false,
      },
      readiness: {
        reason: 'Discord transport is shutting down or already stopped.',
        status: 'not-ready',
      },
    });

    await expect(service.send({ content: 'After shutdown' })).rejects.toThrowError(
      new DiscordTransportError('Discord transport is shutting down or already stopped.'),
    );
    expect(transport.sent).toEqual(['App-owned transport']);
  });

  it('preserves the cause when bootstrap verification fails', async () => {
    const cause = new Error('webhook credentials revoked');
    const transport: DiscordTransport = {
      async send() {
        return { ok: true, warnings: [] };
      },
      async verify() {
        throw cause;
      },
    };
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      transport,
      verifyOnModuleInit: true,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);

    await expect(service.onModuleInit()).rejects.toMatchObject({
      cause,
      message: 'Discord transport failed to initialize.',
    });
    await expect(service.send({ content: 'After failed bootstrap' })).rejects.toThrowError(
      new DiscordTransportError('Discord transport failed to initialize.'),
    );
  });

  it('rejects aborted notification sends before rendering templates', async () => {
    const render = vi.fn().mockResolvedValue({ content: 'Rendered' });
    const container = new Container();
    const moduleType = DiscordModule.forRoot({
      renderer: { render },
      transport: createRecordingTransportFactory(),
    });
    const controller = new AbortController();
    controller.abort();

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(DiscordService);

    await expect(
      service.sendNotification(
        {
          channel: 'discord',
          payload: {},
          template: 'welcome',
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      message: 'Discord delivery was aborted.',
      name: 'AbortError',
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects module registration without an explicit transport contract', () => {
    expect(() =>
      DiscordModule.forRoot({
        defaultThreadId: 'thread-ops',
      } as never),
    ).toThrowError(new DiscordConfigurationError('DiscordModule requires an explicit `transport` to be configured.'));
  });
});
