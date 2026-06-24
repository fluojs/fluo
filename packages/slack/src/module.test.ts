import type { Constructor, Token } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { NOTIFICATION_CHANNELS, NotificationsModule, NotificationsService } from '@fluojs/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SlackChannel } from './channel.js';
import { SlackConfigurationError, SlackLifecycleError, SlackMessageValidationError, SlackTransportError } from './errors.js';
import { createSlackProviders, SlackModule } from './module.js';
import { SlackService } from './service.js';
import { SLACK, SLACK_CHANNEL } from './tokens.js';
import type {
  NormalizedSlackMessage,
  Slack,
  SlackFetchLike,
  SlackTransport,
  SlackTransportFactory,
} from './types.js';
import { createSlackWebhookTransport } from './webhook.js';

const transportState = vi.hoisted(() => ({
  closeCalls: 0,
  sent: [] as NormalizedSlackMessage[],
  sequence: 0,
  verifyCalls: 0,
}));

class RecordingTransport implements SlackTransport {
  constructor(private readonly responsePrefix: string) {}

  async close(): Promise<void> {
    transportState.closeCalls += 1;
  }

  async send(message: NormalizedSlackMessage) {
    transportState.sequence += 1;
    transportState.sent.push(message);

    return {
      channel: message.channel,
      messageTs: `${this.responsePrefix}-${transportState.sequence}`,
      ok: true,
      response: 'ok',
      statusCode: 200,
      warnings: [],
    };
  }

  async verify(): Promise<void> {
    transportState.verifyCalls += 1;
  }
}

class PassiveTransport implements SlackTransport {
  closeCalls = 0;
  readonly sent: string[] = [];

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  async send(message: NormalizedSlackMessage) {
    this.sent.push(message.text ?? '');

    return {
      channel: message.channel,
      ok: true,
      response: 'ok',
      statusCode: 200,
      warnings: [],
    };
  }
}

class FailingVerificationTransport extends PassiveTransport {
  verifyCalls = 0;

  constructor(private readonly failure: Error) {
    super();
  }

  async verify(): Promise<void> {
    this.verifyCalls += 1;
    throw this.failure;
  }
}

class UnsuccessfulTransport implements SlackTransport {
  async send(message: NormalizedSlackMessage) {
    return {
      channel: message.channel,
      ok: false,
      response: 'denied',
      statusCode: 200,
      warnings: [],
    };
  }
}

class SelectiveFailureSlackTransport implements SlackTransport {
  readonly sent: string[] = [];

  async send(message: NormalizedSlackMessage) {
    const text = message.text ?? '';
    this.sent.push(text);

    if (text.includes('fail')) {
      throw new Error(`provider rejected ${text}`);
    }

    return {
      channel: message.channel,
      messageTs: `selective-${this.sent.length}`,
      ok: true,
      response: 'ok',
      statusCode: 200,
      warnings: [],
    };
  }
}

class DelayedLifecycleTransport implements SlackTransport {
  closeCalls = 0;
  sendCalls = 0;
  verifyCalls = 0;

  constructor(private readonly verifyDelay: Promise<void> | undefined = undefined) {}

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  async send(message: NormalizedSlackMessage) {
    this.sendCalls += 1;

    return {
      channel: message.channel,
      ok: true,
      response: 'ok',
      statusCode: 200,
      warnings: [],
    };
  }

  async verify(): Promise<void> {
    this.verifyCalls += 1;
    await this.verifyDelay;
  }
}

function createRecordingTransportFactory(
  overrides: Partial<Pick<SlackTransportFactory, 'kind' | 'ownsResources'>> & { responsePrefix?: string } = {},
): SlackTransportFactory {
  return {
    create: async () => new RecordingTransport(overrides.responsePrefix ?? 'message'),
    kind: overrides.kind ?? 'recording-transport',
    ownsResources: overrides.ownsResources ?? true,
  };
}

function moduleProviders(moduleType: Constructor): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    throw new Error('SlackModule did not register providers metadata.');
  }

  return metadata.providers as Provider[];
}

function providerToken(provider: Provider): unknown {
  return typeof provider === 'function' ? provider : provider.provide;
}

describe('SlackModule', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    transportState.closeCalls = 0;
    transportState.sent.length = 0;
    transportState.sequence = 0;
    transportState.verifyCalls = 0;
  });

  it('registers sync providers and delivers Slack messages through an injected transport factory', async () => {
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#ops',
      transport: createRecordingTransportFactory(),
      verifyOnModuleInit: true,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    await service.onModuleInit();

    const result = await service.send({
      text: 'Deploy finished.',
    });

    expect(result).toMatchObject({
      channel: '#ops',
      messageTs: 'message-1',
      ok: true,
    });
    expect(transportState.verifyCalls).toBe(1);
    expect(transportState.sent[0]).toMatchObject({
      channel: '#ops',
      text: 'Deploy finished.',
    });

    await service.onApplicationShutdown();
    expect(transportState.closeCalls).toBe(1);
  });

  it('creates helper providers with the same normalized options and facade tokens as SlackModule.forRoot', async () => {
    const options = {
      defaultChannel: ' #ops ',
      notifications: { channel: ' alerts ' },
      transport: createRecordingTransportFactory(),
      verifyOnModuleInit: true,
    };
    const moduleType = SlackModule.forRoot(options);
    const helperProviders = createSlackProviders(options);
    const moduleRuntimeProviders = moduleProviders(moduleType);
    const helperContainer = new Container();

    expect(helperProviders).toHaveLength(moduleRuntimeProviders.length);
    expect(helperProviders.map(providerToken)).toEqual(moduleRuntimeProviders.map(providerToken));

    helperContainer.register(...helperProviders);

    const service = await helperContainer.resolve(SlackService);
    const facade = await helperContainer.resolve<Slack>(SLACK);
    const channel = await helperContainer.resolve(SlackChannel);

    await service.onModuleInit();

    const result = await facade.send({
      text: 'helper contract',
    });

    expect(result.messageTs).toBe('message-1');
    expect(channel.channel).toBe('alerts');
    expect(transportState.verifyCalls).toBe(1);
    expect(transportState.sent[0]).toMatchObject({
      channel: '#ops',
      text: 'helper contract',
    });

    await service.onApplicationShutdown();
    expect(transportState.closeCalls).toBe(1);
  });

  it('normalizes missing notification channel fallbacks for module and manual provider registration', async () => {
    const moduleContainer = new Container();
    const helperContainer = new Container();

    moduleContainer.register(
      ...moduleProviders(
        SlackModule.forRoot({
          defaultChannel: '#ops',
          transport: createRecordingTransportFactory(),
        }),
      ),
    );
    helperContainer.register(
      ...createSlackProviders({
        defaultChannel: '#ops',
        notifications: { channel: '   ' },
        transport: createRecordingTransportFactory(),
      }),
    );

    const moduleChannel = await moduleContainer.resolve(SlackChannel);
    const moduleChannelToken = await moduleContainer.resolve(SLACK_CHANNEL);
    const helperChannel = await helperContainer.resolve(SlackChannel);
    const helperChannelToken = await helperContainer.resolve(SLACK_CHANNEL);

    expect(moduleChannel.channel).toBe('slack');
    expect(moduleChannelToken).toBe(moduleChannel);
    expect(helperChannel.channel).toBe('slack');
    expect(helperChannelToken).toBe(helperChannel);
  });

  it('rejects helper-based registration without an explicit transport contract', () => {
    expect(() =>
      createSlackProviders({
        defaultChannel: '#ops',
      } as never),
    ).toThrowError(new SlackConfigurationError('SlackModule requires an explicit `transport` to be configured.'));
  });

  it('honors an already-aborted signal before direct provider handoff', async () => {
    const controller = new AbortController();
    const transport = new PassiveTransport();
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      transport,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    controller.abort();

    await expect(service.send({ text: 'Already aborted' }, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(transport.sent).toEqual([]);
  });

  it('honors an already-aborted signal before notification rendering or provider handoff', async () => {
    const controller = new AbortController();
    const render = vi.fn(async () => ({ text: 'rendered' }));
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      renderer: { render },
      transport: createRecordingTransportFactory(),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    controller.abort();

    await expect(
      service.sendNotification(
        {
          channel: 'slack',
          payload: { text: 'Already aborted' },
          template: 'abort-template',
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(render).not.toHaveBeenCalled();
    expect(transportState.sent).toEqual([]);
  });

  it('honors an already-aborted signal before returning an empty sendMany batch', async () => {
    const controller = new AbortController();
    const create = vi.fn(async () => new PassiveTransport());
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      transport: {
        create,
        ownsResources: true,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    controller.abort();

    await expect(service.sendMany([], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(create).not.toHaveBeenCalled();
  });

  it('honors an already-aborted signal before sending a non-empty sendMany batch', async () => {
    const controller = new AbortController();
    const create = vi.fn(async () => new PassiveTransport());
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      transport: {
        create,
        ownsResources: true,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    controller.abort();

    await expect(service.sendMany([{ text: 'Already aborted batch item' }], { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('resolves async options once and exposes the compatibility facade and channel token', async () => {
    const SLACK_CONFIG = Symbol('slack-config');
    const factoryCalls: string[] = [];
    const container = new Container();
    const moduleType = SlackModule.forRootAsync({
      inject: [SLACK_CONFIG],
      useFactory: async (...deps: unknown[]) => {
        const [channel] = deps;

        if (typeof channel !== 'string') {
          throw new Error('default channel must be a string');
        }

        factoryCalls.push(channel);

        return {
          defaultChannel: channel,
          notifications: { channel: 'alerts' },
          transport: createRecordingTransportFactory({ kind: `factory:${channel}`, responsePrefix: 'async' }),
        };
      },
    });

    container.register({ provide: SLACK_CONFIG as Token<string>, useValue: '#release' }, ...moduleProviders(moduleType));

    const facade = await container.resolve<Slack>(SLACK);
    const channel = await container.resolve(SlackChannel);
    const result = await facade.send({ text: 'Shipped' });

    expect(result.messageTs).toBe('async-1');
    expect(channel.channel).toBe('alerts');
    expect(factoryCalls).toEqual(['#release']);
  });

  it('wires module-first async Slack and notifications registration through SLACK_CHANNEL', async () => {
    const SLACK_CONFIG = Symbol('slack-config');
    const container = new Container();
    const slackModuleType = SlackModule.forRootAsync({
      inject: [SLACK_CONFIG],
      useFactory: async (...deps: unknown[]) => {
        const [defaultChannel] = deps;

        if (typeof defaultChannel !== 'string') {
          throw new Error('default channel must be a string');
        }

        return {
          defaultChannel,
          notifications: { channel: ' alerts ' },
          transport: createRecordingTransportFactory({ responsePrefix: 'integration' }),
        };
      },
    });
    const notificationsModuleType = NotificationsModule.forRootAsync({
      inject: [SLACK_CHANNEL],
      useFactory: async (...deps: unknown[]) => {
        const [channel] = deps;

        return {
          channels: [channel as SlackChannel],
        };
      },
    });

    container.register(
      { provide: SLACK_CONFIG as Token<string>, useValue: ' #release ' },
      ...moduleProviders(slackModuleType),
      ...moduleProviders(notificationsModuleType),
    );

    const notifications = await container.resolve(NotificationsService);
    const channels = await container.resolve(NOTIFICATION_CHANNELS);
    const result = await notifications.dispatch({
      channel: 'alerts',
      metadata: { source: 'ci' },
      payload: {
        metadata: { correlationId: 'deploy-1' },
        text: 'Async integration ready',
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
      channel: '#release',
      metadata: {
        correlationId: 'deploy-1',
        source: 'ci',
      },
      text: 'Async integration ready',
    });
  });

  it('renders notification templates and adapts them through SlackChannel', async () => {
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      renderer: {
        async render(input) {
          return {
            blocks: [{ type: 'section', text: { text: `Hello ${String(input.payload.userId)}`, type: 'mrkdwn' } }],
            text: `Fallback ${String(input.subject)}`,
          };
        },
      },
      transport: createRecordingTransportFactory({ responsePrefix: 'channel' }),
    });

    container.register(...moduleProviders(moduleType));
    const channel = await container.resolve(SlackChannel);

    const result = await channel.send(
      {
        channel: 'slack',
        metadata: { dispatchId: 'dispatch-1' },
        payload: { userId: 'user-1' },
        recipients: ['#product'],
        subject: 'Welcome',
        template: 'welcome',
      },
      {},
    );

    expect(result.externalId).toBe('channel-1');
    expect(transportState.sent[0]).toMatchObject({
      channel: '#product',
      metadata: {
        dispatchId: 'dispatch-1',
        subject: 'Welcome',
        template: 'welcome',
      },
      text: 'Fallback Welcome',
    });
    expect(transportState.sent[0]?.blocks).toHaveLength(1);
  });

  it('creates a webhook-first transport with an explicit fetch-compatible boundary', async () => {
    const calls: Array<{ body?: string; input: string; method?: string }> = [];
    const fetchLike: SlackFetchLike = async (input, init) => {
      calls.push({ body: init?.body, input, method: init?.method });

      return {
        ok: true,
        status: 200,
        async text() {
          return 'ok';
        },
      };
    };
    const transport = createSlackWebhookTransport({
      fetch: fetchLike,
      webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
    });

    const result = await transport.send(
      {
        attachments: [],
        blocks: [],
        channel: '#ops',
        text: 'Webhook path',
      },
      {},
    );

    expect(result).toMatchObject({ ok: true, response: 'ok', statusCode: 200 });
    expect(calls).toEqual([
      {
        body: JSON.stringify({ channel: '#ops', text: 'Webhook path' }),
        input: 'https://hooks.slack.test/services/T000/B000/XXXX',
        method: 'POST',
      },
    ]);
  });

  it('preserves the ambient fetch fallback when no explicit fetch boundary is provided', async () => {
    const fetchLike = vi.fn<SlackFetchLike>().mockResolvedValue({
      ok: true,
      status: 200,
      async text() {
        return 'ok';
      },
    });
    vi.stubGlobal('fetch', fetchLike);

    const transport = createSlackWebhookTransport({
      webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
    });

    await transport.send(
      {
        attachments: [],
        blocks: [],
        text: 'Ambient path',
      },
      {},
    );

    expect(fetchLike).toHaveBeenCalledWith(
      'https://hooks.slack.test/services/T000/B000/XXXX',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fails fast when neither explicit fetch nor global fetch is available', () => {
    vi.stubGlobal('fetch', undefined);

    expect(() =>
      createSlackWebhookTransport({
        webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
      }),
    ).toThrowError(
      new SlackConfigurationError(
        'Slack webhook transport requires an explicit fetch implementation when `globalThis.fetch` is unavailable.',
      ),
    );
  });

  it('serializes the documented Slack webhook payload fields through the built-in transport', async () => {
    const calls: Array<{ body?: string; input: string; method?: string }> = [];
    const fetchLike: SlackFetchLike = async (input, init) => {
      calls.push({ body: init?.body, input, method: init?.method });

      return {
        ok: true,
        status: 200,
        async text() {
          return 'ok';
        },
      };
    };
    const transport = createSlackWebhookTransport({
      fetch: fetchLike,
      webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
    });

    await transport.send(
      {
        attachments: [{ color: '#36a64f' }],
        blocks: [{ text: { text: '*Deploy finished*', type: 'mrkdwn' }, type: 'section' }],
        channel: '#ops',
        iconEmoji: ':rocket:',
        iconUrl: 'https://cdn.example.com/icon.png',
        metadata: { eventPayload: { releaseId: 'rel-1' }, eventType: 'deploy.finished' },
        mrkdwn: true,
        replyBroadcast: true,
        text: 'Deploy finished',
        threadTs: '1712345678.000100',
        unfurlLinks: false,
        unfurlMedia: true,
        username: 'Deploy Bot',
      },
      {},
    );

    expect(calls).toEqual([
      {
        body: JSON.stringify({
          attachments: [{ color: '#36a64f' }],
          blocks: [{ text: { text: '*Deploy finished*', type: 'mrkdwn' }, type: 'section' }],
          channel: '#ops',
          icon_emoji: ':rocket:',
          icon_url: 'https://cdn.example.com/icon.png',
          metadata: { eventPayload: { releaseId: 'rel-1' }, eventType: 'deploy.finished' },
          mrkdwn: true,
          reply_broadcast: true,
          text: 'Deploy finished',
          thread_ts: '1712345678.000100',
          unfurl_links: false,
          unfurl_media: true,
          username: 'Deploy Bot',
        }),
        input: 'https://hooks.slack.test/services/T000/B000/XXXX',
        method: 'POST',
      },
    ]);
  });

  it('rejects multi-recipient notification fan-out inside one Slack dispatch', async () => {
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      transport: createRecordingTransportFactory(),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);

    await expect(
      service.sendNotification({
        channel: 'slack',
        payload: { text: 'Fan-out not allowed' },
        recipients: ['#eng', '#ops'],
      }),
    ).rejects.toThrowError(
      new SlackMessageValidationError(
        'Slack notifications accept exactly one target channel per dispatch. Use `sendMany(...)` for fan-out delivery.',
      ),
    );
  });

  it('surfaces an unsuccessful transport receipt as a notifications channel failure', async () => {
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      transport: new UnsuccessfulTransport(),
    });

    container.register(...moduleProviders(moduleType));
    const channel = await container.resolve(SlackChannel);

    await expect(
      channel.send(
        {
          channel: 'slack',
          payload: { text: 'Denied' },
          recipients: ['#ops'],
        },
        {},
      ),
    ).rejects.toThrowError(new SlackTransportError('Slack transport reported an unsuccessful delivery.'));
  });

  it('delivers sendMany messages sequentially and returns ordered batch results', async () => {
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#ops',
      transport: createRecordingTransportFactory({ responsePrefix: 'batch' }),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);

    const result = await service.sendMany([{ text: 'one' }, { text: 'two' }, { text: 'three' }]);

    expect(result).toMatchObject({ failed: 0, succeeded: 3 });
    expect(result.results.map((entry) => entry.messageTs)).toEqual(['batch-1', 'batch-2', 'batch-3']);
    expect(transportState.sent.map((entry) => entry.text)).toEqual(['one', 'two', 'three']);
  });

  it('stops sendMany at the first provider error by default', async () => {
    const transport = new SelectiveFailureSlackTransport();
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#ops',
      transport,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);

    await expect(service.sendMany([{ text: 'ok-1' }, { text: 'fail-2' }, { text: 'ok-3' }])).rejects.toThrowError(
      'provider rejected fail-2',
    );
    expect(transport.sent).toEqual(['ok-1', 'fail-2']);
  });

  it('collects sendMany failures when continueOnError is enabled', async () => {
    const transport = new SelectiveFailureSlackTransport();
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#ops',
      transport,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);

    const result = await service.sendMany([{ text: 'ok-1' }, { text: 'fail-2' }, { text: 'ok-3' }], {
      continueOnError: true,
    });

    expect(result).toMatchObject({ failed: 1, succeeded: 2 });
    expect(result.failures[0]?.error).toMatchObject({ message: 'provider rejected fail-2' });
    expect(result.results.map((entry) => entry.messageTs)).toEqual(['selective-1', 'selective-3']);
    expect(transport.sent).toEqual(['ok-1', 'fail-2', 'ok-3']);
  });

  it('propagates sendMany abort signals between sequential deliveries', async () => {
    const controller = new AbortController();
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#ops',
      transport: {
        async send(message: NormalizedSlackMessage) {
          transportState.sent.push(message);
          controller.abort();

          return {
            channel: message.channel,
            messageTs: 'aborted-batch-1',
            ok: true,
            response: 'ok',
            statusCode: 200,
            warnings: [],
          };
        },
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);

    const result = await service.sendMany([{ text: 'first' }, { text: 'second' }], {
      continueOnError: true,
      signal: controller.signal,
    });

    expect(result).toMatchObject({ failed: 1, succeeded: 1 });
    expect(result.failures[0]?.error).toMatchObject({ name: 'AbortError' });
    expect(transportState.sent.map((entry) => entry.text)).toEqual(['first']);
  });

  it('retries transient webhook failures with exponential backoff before succeeding', async () => {
    vi.useFakeTimers();

    try {
      const rateLimitedText = vi.fn(async () => 'rate_limited');
      const outageText = vi.fn(async () => 'temporary outage');
      const successText = vi.fn(async () => 'ok');
      const fetchLike = vi
        .fn<SlackFetchLike>()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: rateLimitedText,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: outageText,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: successText,
        });
      const transport = createSlackWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
      });

      const pending = transport.send({ attachments: [], blocks: [], channel: '#ops', text: 'Retry path' }, {});
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toMatchObject({ ok: true, response: 'ok', statusCode: 200 });
      expect(fetchLike).toHaveBeenCalledTimes(3);
      expect(rateLimitedText).not.toHaveBeenCalled();
      expect(outageText).not.toHaveBeenCalled();
      expect(successText).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries request-timeout webhook failures before succeeding', async () => {
    vi.useFakeTimers();

    try {
      const requestTimeoutText = vi.fn(async () => 'request timeout');
      const successText = vi.fn(async () => 'ok');
      const fetchLike = vi
        .fn<SlackFetchLike>()
        .mockResolvedValueOnce({
          ok: false,
          status: 408,
          statusText: 'Request Timeout',
          text: requestTimeoutText,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: successText,
        });
      const transport = createSlackWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
      });

      const pending = transport.send({ attachments: [], blocks: [], channel: '#ops', text: 'Request timeout retry path' }, {});
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toMatchObject({ ok: true, response: 'ok', statusCode: 200 });
      expect(fetchLike).toHaveBeenCalledTimes(2);
      expect(requestTimeoutText).not.toHaveBeenCalled();
      expect(successText).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes AbortSignal to webhook fetch and does not retry AbortError failures', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const fetchLike = vi.fn<SlackFetchLike>().mockRejectedValue(abortError);
    const transport = createSlackWebhookTransport({
      fetch: fetchLike,
      webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
    });

    await expect(
      transport.send({ attachments: [], blocks: [], channel: '#ops', text: 'Abort path' }, { signal: controller.signal }),
    ).rejects.toBe(abortError);
    expect(fetchLike).toHaveBeenCalledTimes(1);
    expect(fetchLike.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('stops webhook retry backoff when the signal is aborted', async () => {
    vi.useFakeTimers();

    try {
      const controller = new AbortController();
      const reason = new DOMException('retry cancelled', 'AbortError');
      const fetchLike = vi.fn<SlackFetchLike>().mockImplementation(async () => {
        queueMicrotask(() => {
          controller.abort(reason);
        });

        return {
          ok: false,
          status: 429,
          async text() {
            return 'rate_limited';
          },
        };
      });
      const transport = createSlackWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
      });

      const pending = transport.send({ attachments: [], blocks: [], channel: '#ops', text: 'Retry abort path' }, {
        signal: controller.signal,
      });
      const expectation = expect(pending).rejects.toBe(reason);
      await vi.runAllTimersAsync();

      await expectation;
      expect(fetchLike).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sanitizes webhook failure errors after bounded retries', async () => {
    vi.useFakeTimers();

    try {
      const fetchLike = vi.fn<SlackFetchLike>().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        async text() {
          return '<html>secret upstream body</html>';
        },
      });
      const transport = createSlackWebhookTransport({
        fetch: fetchLike,
        webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
      });

      const pending = transport.send({ attachments: [], blocks: [], channel: '#ops', text: 'Retry path' }, {});
      const expectation = expect(pending).rejects.toThrowError(
        new SlackTransportError(
          'Slack webhook delivery failed with status 500 Internal Server Error after 3 attempt(s). Upstream response body was omitted from the caller-visible error.',
        ),
      );
      await vi.runAllTimersAsync();

      await expectation;
      expect(fetchLike).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rethrows permanent webhook failures (like 403) without retrying', async () => {
    const fetchLike = vi.fn<SlackFetchLike>().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      async text() {
        return 'invalid_token';
      },
    });
    const transport = createSlackWebhookTransport({
      fetch: fetchLike,
      webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
    });

    const pending = transport.send({ attachments: [], blocks: [], channel: '#ops', text: 'Permanent failure path' }, {});
    await expect(pending).rejects.toThrowError(
      new SlackTransportError(
        'Slack webhook delivery failed with status 403 Forbidden after 1 attempt(s). Upstream response body was omitted from the caller-visible error.',
      ),
    );
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  it('rethrows permanent webhook failures (like 404) without retrying', async () => {
    const fetchLike = vi.fn<SlackFetchLike>().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      async text() {
        return 'channel_not_found';
      },
    });
    const transport = createSlackWebhookTransport({
      fetch: fetchLike,
      webhookUrl: 'https://hooks.slack.test/services/T000/B000/XXXX',
    });

    const pending = transport.send({ attachments: [], blocks: [], channel: '#ops', text: 'Permanent failure path' }, {});
    await expect(pending).rejects.toThrowError(
      new SlackTransportError(
        'Slack webhook delivery failed with status 404 Not Found after 1 attempt(s). Upstream response body was omitted from the caller-visible error.',
      ),
    );
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  it('accepts custom provider-backed transports without bootstrap verification', async () => {
    const transport = new PassiveTransport();
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#provider',
      transport,
    });

    container.register(...moduleProviders(moduleType));
    const facade = await container.resolve<Slack>(SLACK);
    const result = await facade.send({ text: 'Provider transport' });

    expect(result.ok).toBe(true);
    expect(transport.sent).toEqual(['Provider transport']);
    expect(transportState.verifyCalls).toBe(0);
  });

  it('preserves direct transport ownership across bootstrap and shutdown lifecycle hooks', async () => {
    const transport = new PassiveTransport();
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#owned-by-app',
      transport,
      verifyOnModuleInit: true,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);

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

    await service.send({ text: 'App-owned transport' });
    await service.onApplicationShutdown();

    expect(transport.sent).toEqual(['App-owned transport']);
    expect(transport.closeCalls).toBe(0);
    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: { lifecycleState: 'stopped' },
      ownership: {
        externallyManaged: true,
        ownsResources: false,
      },
      readiness: {
        reason: 'Slack transport is shutting down or already stopped.',
        status: 'not-ready',
      },
    });
  });

  it('blocks shutdown-time delivery from reusing or recreating transports', async () => {
    let resolveTransport!: (transport: DelayedLifecycleTransport) => void;
    const createdTransport = new DelayedLifecycleTransport();
    const create = vi.fn(
      () =>
        new Promise<SlackTransport>((resolve) => {
          resolveTransport = resolve;
        }),
    );
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#ops',
      transport: {
        create,
        ownsResources: true,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    const sendDuringCreate = service.send({ text: 'Shutdown race' });
    const shutdown = service.onApplicationShutdown();

    resolveTransport(createdTransport);

    await expect(sendDuringCreate).rejects.toThrowError(
      new SlackLifecycleError('Slack delivery cannot start while the service lifecycle is stopped.'),
    );
    await shutdown;
    await expect(service.send({ text: 'After shutdown' })).rejects.toThrowError(
      new SlackLifecycleError('Slack delivery cannot start while the service lifecycle is stopped.'),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(createdTransport.closeCalls).toBe(1);
    expect(createdTransport.sendCalls).toBe(0);
  });

  it('makes factory-owned shutdown idempotent after the transport is closed', async () => {
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      transport: createRecordingTransportFactory(),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    await service.onModuleInit();
    await service.onApplicationShutdown();
    await service.onApplicationShutdown();

    expect(transportState.closeCalls).toBe(1);
  });

  it('shares concurrent factory-owned shutdown work instead of closing repeatedly', async () => {
    const transport = new DelayedLifecycleTransport();
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      transport: {
        create: async () => transport,
        ownsResources: true,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    await service.onModuleInit();
    await Promise.all([service.onApplicationShutdown(), service.onApplicationShutdown()]);

    expect(transport.closeCalls).toBe(1);
  });

  it('wraps owned transport shutdown failures as lifecycle errors', async () => {
    const closeError = new Error('close failed');
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      transport: {
        create: async () => ({
          async close() {
            throw closeError;
          },
          async send(message: NormalizedSlackMessage) {
            return {
              channel: message.channel,
              ok: true,
              response: 'ok',
              statusCode: 200,
              warnings: [],
            };
          },
        }),
        ownsResources: true,
      },
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    await service.onModuleInit();

    await expect(service.onApplicationShutdown()).rejects.toThrowError(
      new SlackLifecycleError('Slack transport failed to close cleanly.', { cause: closeError }),
    );
  });

  it('does not mark the service ready when shutdown interrupts bootstrap verification', async () => {
    let resolveVerify!: () => void;
    let resolveVerifyStarted!: () => void;
    const verifyDelay = new Promise<void>((resolve) => {
      resolveVerify = resolve;
    });
    const verifyStarted = new Promise<void>((resolve) => {
      resolveVerifyStarted = resolve;
    });
    const createdTransport = new DelayedLifecycleTransport(verifyDelay);
    const verify = vi.spyOn(createdTransport, 'verify').mockImplementation(async () => {
      createdTransport.verifyCalls += 1;
      resolveVerifyStarted();
      await verifyDelay;
    });
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#ops',
      transport: {
        create: async () => createdTransport,
        ownsResources: true,
      },
      verifyOnModuleInit: true,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    const bootstrap = service.onModuleInit();
    await verifyStarted;
    const shutdown = service.onApplicationShutdown();

    await shutdown;
    resolveVerify();
    await bootstrap;

    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: { lifecycleState: 'stopped' },
      readiness: { status: 'not-ready' },
    });
    await expect(
      service.sendNotification({
        channel: 'slack',
        payload: { text: 'After interrupted bootstrap' },
        recipients: ['#ops'],
      }),
    ).rejects.toThrowError(new SlackLifecycleError('Slack delivery cannot start while the service lifecycle is stopped.'));
    expect(createdTransport.closeCalls).toBe(1);
    expect(createdTransport.verifyCalls).toBe(1);
    expect(verify).toHaveBeenCalledOnce();
    expect(createdTransport.sendCalls).toBe(0);
  });

  it('closes factory-owned transports when bootstrap verification fails', async () => {
    const verificationError = new Error('slack auth failed');
    const transport = new FailingVerificationTransport(verificationError);
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      defaultChannel: '#ops',
      transport: {
        create: async () => transport,
        ownsResources: true,
      },
      verifyOnModuleInit: true,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);

    await expect(service.onModuleInit()).rejects.toThrowError(
      new SlackLifecycleError('Slack transport failed to initialize.', { cause: verificationError }),
    );
    expect(service.createPlatformStatusSnapshot()).toMatchObject({
      details: { lifecycleState: 'failed', verifiedOnModuleInit: true },
      readiness: {
        reason: 'Slack transport failed to initialize.',
        status: 'not-ready',
      },
    });
    await expect(service.send({ text: 'After failed bootstrap' })).rejects.toThrowError(
      new SlackLifecycleError('Slack delivery cannot start while the service lifecycle is failed.'),
    );

    await service.onApplicationShutdown();

    expect(transport.verifyCalls).toBe(1);
    expect(transport.closeCalls).toBe(1);
    expect(transport.sent).toEqual([]);
  });

  it('checks notification lifecycle before renderer or validation errors after shutdown', async () => {
    const render = vi.fn(async () => ({ text: 'rendered' }));
    const container = new Container();
    const moduleType = SlackModule.forRoot({
      renderer: { render },
      transport: createRecordingTransportFactory(),
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(SlackService);
    await service.onApplicationShutdown();

    await expect(
      service.sendNotification({
        channel: 'slack',
        payload: {},
        recipients: ['#eng', '#ops'],
        template: 'shutdown-template',
      }),
    ).rejects.toThrowError(new SlackLifecycleError('Slack delivery cannot start while the service lifecycle is stopped.'));
    expect(render).not.toHaveBeenCalled();
    expect(transportState.sent).toHaveLength(0);
  });

  it('rejects module registration without an explicit transport contract', () => {
    expect(() =>
      SlackModule.forRoot({
        defaultChannel: '#ops',
      } as never),
    ).toThrowError(new SlackConfigurationError('SlackModule requires an explicit `transport` to be configured.'));
  });
});
