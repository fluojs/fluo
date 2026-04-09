import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Constructor, type Token } from '@konekti/core';
import { getModuleMetadata } from '@konekti/core/internal';
import { Container, type Provider } from '@konekti/di';

import { SlackChannel } from './channel.js';
import { SlackConfigurationError, SlackMessageValidationError, SlackTransportError } from './errors.js';
import { SlackModule } from './module.js';
import { SlackService } from './service.js';
import { SLACK } from './tokens.js';
import { createSlackWebhookTransport } from './webhook.js';
import type {
  NormalizedSlackMessage,
  Slack,
  SlackFetchLike,
  SlackTransport,
  SlackTransportFactory,
} from './types.js';

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
  readonly sent: string[] = [];

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

describe('SlackModule', () => {
  beforeEach(() => {
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
        'Slack notifications accept exactly one target channel per dispatch. Use `dispatchMany(...)` for fan-out delivery.',
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
    ).rejects.toThrowError(new SlackTransportError('Slack transport reported an unsuccessful delivery: denied'));
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

  it('rejects module registration without an explicit transport contract', () => {
    expect(() =>
      SlackModule.forRoot({
        defaultChannel: '#ops',
      } as never),
    ).toThrowError(new SlackConfigurationError('SlackModule requires an explicit `transport` to be configured.'));
  });
});
