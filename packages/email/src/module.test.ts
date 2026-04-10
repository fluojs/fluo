import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Constructor, type Token } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { NotificationsModule, NotificationsService } from '@fluojs/notifications';
import type { Queue } from '@fluojs/queue';

interface MockQueueJob {
  attemptsMade: number;
  data: Record<string, unknown>;
  id?: string;
  opts: {
    attempts?: number;
    backoff?: { delay?: number; type?: 'fixed' | 'exponential' };
  };
}

type FailedListener = (job: MockQueueJob | undefined, error: Error) => void;

const transportState = vi.hoisted(() => ({
  closeCalls: 0,
  messageSequence: 0,
  sent: [] as NormalizedEmailMessage[],
  verifyCalls: 0,
}));

const bullmqState = vi.hoisted(() => {
  const queues = new Map<string, { jobs: MockQueueJob[]; name: string }>();
  const workers = new Map<string, {
    active: Set<Promise<void>>;
    closed: boolean;
    failedListeners: FailedListener[];
    processor: (job: MockQueueJob) => Promise<unknown>;
  }>();
  let sequence = 0;

  async function dispatch(name: string, job: MockQueueJob): Promise<void> {
    const worker = workers.get(name);

    if (!worker || worker.closed) {
      return;
    }

    const run = (async () => {
      try {
        await worker.processor(job);
      } catch (error) {
        for (const listener of worker.failedListeners) {
          listener(job, error instanceof Error ? error : new Error('job failed'));
        }
      }
    })();

    worker.active.add(run);

    try {
      await run;
    } finally {
      worker.active.delete(run);
    }
  }

  return {
    clear() {
      queues.clear();
      workers.clear();
      sequence = 0;
    },
    createQueue(name: string) {
      const queue = { jobs: [] as MockQueueJob[], name };
      queues.set(name, queue);
      return queue;
    },
    createWorker(name: string, processor: (job: MockQueueJob) => Promise<unknown>) {
      const worker = {
        active: new Set<Promise<void>>(),
        closed: false,
        failedListeners: [] as FailedListener[],
        processor,
      };

      workers.set(name, worker);
      return worker;
    },
    nextId() {
      sequence += 1;
      return String(sequence);
    },
    queues,
    async dispatch(name: string, job: MockQueueJob) {
      await dispatch(name, job);
    },
  };
});

vi.mock('bullmq', () => ({
  Queue: class MockBullQueue {
    private readonly queue;

    constructor(private readonly name: string) {
      this.queue = bullmqState.createQueue(name);
    }

    async add(_jobName: string, data: Record<string, unknown>, opts: MockQueueJob['opts'] = {}): Promise<{ id: string }> {
      const job: MockQueueJob = {
        attemptsMade: 0,
        data,
        id: bullmqState.nextId(),
        opts,
      };

      this.queue.jobs.push(job);
      await bullmqState.dispatch(this.name, job);

      return { id: job.id ?? '' };
    }

    async close(): Promise<void> {
      return undefined;
    }
  },
  Worker: class MockBullWorker {
    private readonly worker;

    constructor(name: string, processor: (job: MockQueueJob) => Promise<unknown>) {
      this.worker = bullmqState.createWorker(name, processor);
    }

    on(event: string, listener: FailedListener): this {
      if (event === 'failed') {
        this.worker.failedListeners.push(listener);
      }

      return this;
    }

    async close(): Promise<void> {
      this.worker.closed = true;
      await Promise.allSettled(Array.from(this.worker.active));
    }
  },
}));

import { EmailChannel } from './channel.js';
import { EmailNotificationQueueJob, EmailNotificationsQueueWorker, createEmailNotificationsQueueAdapter } from './queue.js';
import { EmailModule } from './module.js';
import { EmailService } from './service.js';
import { EMAIL } from './tokens.js';
import { EmailConfigurationError } from './errors.js';
import type { Email, EmailTransport, EmailTransportFactory, NormalizedEmailMessage } from './types.js';

class RecordingTransport implements EmailTransport {
  constructor(private readonly messagePrefix: string) {}

  async close(): Promise<void> {
    transportState.closeCalls += 1;
  }

  async send(
    message: NormalizedEmailMessage,
  ): Promise<{ accepted: string[]; messageId: string; pending: []; rejected: []; response: string }> {
    transportState.messageSequence += 1;
    transportState.sent.push(message);

    return {
      accepted: message.to.map((entry) => entry.address),
      messageId: `${this.messagePrefix}-${transportState.messageSequence}`,
      pending: [],
      rejected: [],
      response: 'accepted',
    };
  }

  async verify(): Promise<void> {
    transportState.verifyCalls += 1;
  }
}

class PassiveTransport implements EmailTransport {
  readonly sent: string[] = [];

  async send(
    message: NormalizedEmailMessage,
  ): Promise<{ accepted: string[]; messageId: string; pending: []; rejected: [] }> {
    const recipient = message.to[0]?.address ?? '';
    this.sent.push(recipient);

    return {
      accepted: [...this.sent],
      messageId: 'provider-1',
      pending: [],
      rejected: [],
    };
  }
}

function createRecordingTransportFactory(
  overrides: Partial<Pick<EmailTransportFactory, 'kind' | 'ownsResources'>> & { messagePrefix?: string } = {},
): EmailTransportFactory {
  return {
    create: async () => new RecordingTransport(overrides.messagePrefix ?? 'message'),
    kind: overrides.kind ?? 'recording-transport',
    ownsResources: overrides.ownsResources ?? true,
  };
}

function moduleProviders(moduleType: Constructor): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    throw new Error('EmailModule did not register providers metadata.');
  }

  return metadata.providers as Provider[];
}

describe('EmailModule', () => {
  beforeEach(() => {
    bullmqState.clear();
    transportState.closeCalls = 0;
    transportState.messageSequence = 0;
    transportState.sent.length = 0;
    transportState.verifyCalls = 0;
  });

  it('registers sync providers and delivers email through an injected transport factory', async () => {
    const container = new Container();
    const moduleType = EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: createRecordingTransportFactory(),
      verifyOnModuleInit: true,
    });

    container.register(...moduleProviders(moduleType));
    const service = await container.resolve(EmailService);
    await service.onModuleInit();

    const result = await service.send({
      subject: 'Welcome',
      text: 'Hello from Konekti',
      to: ['user@example.com'],
    });

    expect(result).toMatchObject({
      accepted: ['user@example.com'],
      messageId: 'message-1',
    });
    expect(transportState.verifyCalls).toBe(1);
    expect(transportState.sent[0]).toMatchObject({
      from: { address: 'noreply@example.com' },
      subject: 'Welcome',
      text: 'Hello from Konekti',
    });

    await service.onApplicationShutdown();
    expect(transportState.closeCalls).toBe(1);
  });

  it('resolves async options once and exposes the compatibility facade and channel token', async () => {
    const MAIL_HOST = Symbol('mail-host');
    const factoryCalls: string[] = [];
    const container = new Container();
    const moduleType = EmailModule.forRootAsync({
      inject: [MAIL_HOST],
      useFactory: async (...deps: unknown[]) => {
        const [host] = deps;

        if (typeof host !== 'string') {
          throw new Error('mail host must be a string');
        }

        factoryCalls.push(host);

        return {
          defaultFrom: 'async@example.com',
          notifications: { channel: 'mailer' },
          transport: createRecordingTransportFactory({ kind: `factory:${host}`, messagePrefix: 'async' }),
        };
      },
    });

    container.register({ provide: MAIL_HOST as Token<string>, useValue: 'smtp.local' }, ...moduleProviders(moduleType));

    const facade = await container.resolve<Email>(EMAIL);
    const channel = await container.resolve(EmailChannel);

    const result = await facade.send({
      subject: 'Async',
      text: 'factory test',
      to: ['async@example.com'],
    });

    expect(result.messageId).toBe('async-1');
    expect(channel.channel).toBe('mailer');
    expect(factoryCalls).toEqual(['smtp.local']);
  });

  it('renders notification templates and adapts them through EmailChannel', async () => {
    const container = new Container();
    const moduleType = EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      renderer: {
        async render(input) {
          return {
            subject: `Rendered ${input.template}`,
            text: `Hello ${String(input.payload.templateData?.userId)}`,
          };
        },
      },
      transport: createRecordingTransportFactory({ messagePrefix: 'channel' }),
    });

    container.register(...moduleProviders(moduleType));
    const channel = await container.resolve(EmailChannel);

    const result = await channel.send(
      {
        channel: 'email',
        payload: { templateData: { userId: 'user-1' } },
        recipients: ['user@example.com'],
        template: 'welcome',
      },
      {},
    );

    expect(result.externalId).toBe('channel-1');
    expect(transportState.sent[0]).toMatchObject({
      subject: 'Rendered welcome',
      text: 'Hello user-1',
    });
  });

  it('provides a notifications queue adapter that enqueues bulk email delivery through QueueModule', async () => {
    const enqueued: object[] = [];
    const fakeQueue: Pick<Queue, 'enqueue'> = {
      async enqueue(job: object): Promise<string> {
        enqueued.push(job);
        return `queued:${enqueued.length}`;
      },
    };
    const emailContainer = new Container();
    const emailModuleType = EmailModule.forRoot({
      defaultFrom: 'noreply@example.com',
      transport: new RecordingTransport('queue'),
    });

    emailContainer.register(...moduleProviders(emailModuleType));

    const channel = await emailContainer.resolve(EmailChannel);
    const worker = await emailContainer.resolve(EmailNotificationsQueueWorker);

    const notificationsContainer = new Container();
    const notificationsModuleType = NotificationsModule.forRoot({
      channels: [channel],
      queue: {
        adapter: createEmailNotificationsQueueAdapter(fakeQueue as never),
        bulkThreshold: 2,
      },
    });

    notificationsContainer.register(...moduleProviders(notificationsModuleType));
    const notifications = await notificationsContainer.resolve(NotificationsService);
    const result = await notifications.dispatchMany([
      {
        channel: 'email',
        payload: { text: 'digest 1' },
        recipients: ['user-1@example.com'],
        subject: 'Digest 1',
      },
      {
        channel: 'email',
        payload: { text: 'digest 2' },
        recipients: ['user-2@example.com'],
        subject: 'Digest 2',
      },
    ]);

    expect(result.queued).toBe(2);
    expect(enqueued).toHaveLength(2);
    expect(enqueued[0]).toBeInstanceOf(EmailNotificationQueueJob);

    await worker.handle(enqueued[0] as EmailNotificationQueueJob);
    await worker.handle(enqueued[1] as EmailNotificationQueueJob);

    expect(transportState.sent).toHaveLength(2);
  });

  it('accepts custom provider-backed transports without bootstrap verification', async () => {
    const transport = new PassiveTransport();
    const container = new Container();
    const moduleType = EmailModule.forRoot({
      defaultFrom: 'provider@example.com',
      transport,
    });

    container.register(...moduleProviders(moduleType));
    const facade = await container.resolve<Email>(EMAIL);
    const result = await facade.send({
      subject: 'Provider transport',
      text: 'hello',
      to: ['provider-user@example.com'],
    });

    expect(result.messageId).toBe('provider-1');
    expect(transport.sent).toEqual(['provider-user@example.com']);
    expect(transportState.verifyCalls).toBe(0);
  });

  it('rejects module registration without an explicit transport contract', () => {
    expect(() =>
      EmailModule.forRoot({
        defaultFrom: 'noreply@example.com',
      } as never),
    ).toThrowError(new EmailConfigurationError('EmailModule requires an explicit `transport` to be configured.'));
  });
});
