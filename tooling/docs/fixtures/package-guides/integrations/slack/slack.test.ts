import { type NotificationChannel, NotificationsModule, NotificationsService } from '@fluojs/notifications';
import { defineModule, FluoFactory, type ModuleType } from '@fluojs/runtime';
import {
  createSlackWebhookTransport,
  type NormalizedSlackMessage,
  SLACK_CHANNEL,
  type SlackFetchLike,
  SlackLifecycleError,
  SlackMessageValidationError,
  SlackModule,
  SlackService,
  type SlackTransport,
  type SlackTransportContext,
  SlackTransportError,
  type SlackTransportReceipt,
} from '@fluojs/slack';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/slack guide evidence: webhook payload construction over an explicit
 * fetch boundary, transient-vs-permanent failure handling, abort handling,
 * message validation, recipient-to-channel mapping through the notifications
 * foundation, capability-based bootstrap verification, and the shutdown
 * lifecycle gate - recording fetches only, no network, no sleeps.
 */

function okResponse(body = 'ok'): SlackFetchLike {
  return async () => ({ ok: true, status: 200, text: async () => body });
}

class RecordingFetch {
  readonly calls: Array<{ body: Record<string, unknown>; url: string }> = [];

  constructor(private readonly response: SlackFetchLike = okResponse()) {}

  readonly fetchLike: SlackFetchLike = async (input, init) => {
    this.calls.push({ body: JSON.parse(init?.body ?? '{}') as Record<string, unknown>, url: input });
    return await this.response(input, init);
  };
}

function buildWebhookTransport(fetchLike: SlackFetchLike): SlackTransport {
  return createSlackWebhookTransport({
    fetch: fetchLike,
    webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
  });
}

function buildAppModule(transport: SlackTransport, options?: { verifyOnModuleInit?: boolean }): ModuleType {
  class SlackAppModule {}

  return defineModule(SlackAppModule, {
    imports: [
      SlackModule.forRoot({
        defaultChannel: '#ops',
        ...(options?.verifyOnModuleInit ? { verifyOnModuleInit: true } : {}),
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

describe('@fluojs/slack guide examples', () => {
  it('posts one JSON payload per send through the injected fetch boundary', async () => {
    const fetch = new RecordingFetch();
    await withApplicationContext(buildAppModule(buildWebhookTransport(fetch.fetchLike)), async (context) => {
      const slack = await context.get(SlackService);

      const result = await slack.send({
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Deploy v1.2.3* finished' } }],
        text: 'Deploy v1.2.3 finished successfully.',
      });

      expect(result.ok).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.warnings).toEqual([]);
      expect(fetch.calls).toHaveLength(1);
      expect(fetch.calls[0]?.url).toBe('https://hooks.slack.com/services/T000/B000/XXXX');
      // defaultChannel is resolved before delivery, and blocks travel opaquely.
      expect(fetch.calls[0]?.body.channel).toBe('#ops');
      expect(fetch.calls[0]?.body.text).toBe('Deploy v1.2.3 finished successfully.');
    });
  });

  it('fails fast on permanent statuses without retrying', async () => {
    const failing: SlackFetchLike = async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'invalid_payload',
    });
    const fetch = new RecordingFetch(failing);
    await withApplicationContext(buildAppModule(buildWebhookTransport(fetch.fetchLike)), async (context) => {
      const slack = await context.get(SlackService);

      await expect(slack.send({ text: 'hi' })).rejects.toBeInstanceOf(SlackTransportError);
      // 4xx is permanent: exactly one attempt, no backoff loop.
      expect(fetch.calls).toHaveLength(1);
    });
  });

  it('rejects a pre-aborted signal before calling fetch', async () => {
    const fetch = new RecordingFetch();
    await withApplicationContext(buildAppModule(buildWebhookTransport(fetch.fetchLike)), async (context) => {
      const slack = await context.get(SlackService);
      const controller = new AbortController();
      controller.abort();

      await expect(slack.send({ text: 'hi' }, { signal: controller.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(fetch.calls).toHaveLength(0);
    });
  });

  it('rejects messages without Slack-visible content', async () => {
    const fetch = new RecordingFetch();
    await withApplicationContext(buildAppModule(buildWebhookTransport(fetch.fetchLike)), async (context) => {
      const slack = await context.get(SlackService);

      await expect(slack.send({})).rejects.toBeInstanceOf(SlackMessageValidationError);
      expect(fetch.calls).toHaveLength(0);
    });
  });

  it('maps one notification dispatch to one Slack destination', async () => {
    const fetch = new RecordingFetch();

    class RoutedAppModule {}

    await withApplicationContext(
      defineModule(RoutedAppModule, {
        imports: [
          SlackModule.forRoot({ defaultChannel: '#ops', transport: buildWebhookTransport(fetch.fetchLike) }),
          NotificationsModule.forRootAsync({
            inject: [SLACK_CHANNEL],
            useFactory: (...deps: unknown[]) => ({ channels: deps as NotificationChannel[] }),
          }),
        ],
      }),
      async (context) => {
        const notifications = await context.get(NotificationsService);

        const result = await notifications.dispatch({
          channel: 'slack',
          recipients: ['#releases'],
          subject: 'Deploy finished',
          payload: { text: 'Deploy rel-42 finished.' },
        });
        expect(result.status).toBe('delivered');
        expect(fetch.calls[0]?.body.channel).toBe('#releases');
        expect(fetch.calls[0]?.body.text).toBe('Deploy rel-42 finished.');

        // Fan-out is never implicit: two recipients are a validation error.
        await expect(
          notifications.dispatch({
            channel: 'slack',
            recipients: ['#ops', '#releases'],
            payload: { text: 'hi' },
          }),
        ).rejects.toBeInstanceOf(SlackMessageValidationError);
      },
    );
  });

  it('runs capability-based bootstrap verification when verifyOnModuleInit is set', async () => {
    let verifyCalls = 0;
    const transport: SlackTransport = {
      async send(_message: NormalizedSlackMessage, _context: SlackTransportContext): Promise<SlackTransportReceipt> {
        return { ok: true };
      },
      async verify(): Promise<void> {
        verifyCalls += 1;
      },
    };

    await withApplicationContext(buildAppModule(transport, { verifyOnModuleInit: true }), async (context) => {
      // Verification happened during bootstrap, before any send.
      expect(verifyCalls).toBe(1);

      const slack = await context.get(SlackService);
      const result = await slack.send({ text: 'ready send' });
      expect(result.ok).toBe(true);
      expect(verifyCalls).toBe(1);
    });
  });

  it('rejects sends after shutdown with SlackLifecycleError', async () => {
    const fetch = new RecordingFetch();
    const context = await FluoFactory.createApplicationContext(buildAppModule(buildWebhookTransport(fetch.fetchLike)));
    const slack = await context.get(SlackService);

    await slack.send({ text: 'before close' });
    await context.close();

    await expect(slack.send({ text: 'after close' })).rejects.toBeInstanceOf(SlackLifecycleError);
  });
});
