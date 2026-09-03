import { describe, expect, it } from 'vitest';

import { EmailChannel } from './channel.js';
import { EmailMessageValidationError } from './errors.js';
import { createEmailNotificationsQueueAdapter, EmailNotificationQueueJob, EmailNotificationsQueueWorker } from './queue.js';
import { EmailService } from './service.js';
import type { EmailTransport, NormalizedEmailMessage, NormalizedEmailModuleOptions } from './types.js';
import type { Queue } from '@fluojs/queue';

function createQueueTestFixture(channel = 'email'): {
  readonly delivered: readonly NormalizedEmailMessage[];
  readonly worker: EmailNotificationsQueueWorker;
} {
  const delivered: NormalizedEmailMessage[] = [];
  const transport: EmailTransport = {
    async send(message) {
      delivered.push(message);
      return {
        accepted: message.to.map((recipient) => recipient.address),
        messageId: 'queue-test-message',
        pending: [],
        rejected: [],
      };
    },
  };
  const options: NormalizedEmailModuleOptions = {
    defaultFrom: { address: 'noreply@example.com' },
    defaultReplyTo: [],
    notifications: { channel },
    transport: {
      create: async () => transport,
      kind: 'queue-test',
      ownsResources: false,
    },
    verifyOnModuleInit: false,
  };
  const service = new EmailService(options);

  return {
    delivered,
    worker: new EmailNotificationsQueueWorker(new EmailChannel(service, options)),
  };
}

describe('EmailNotificationsQueueWorker', () => {
  it('forwards the notification id through the public queue deduplication seam', async () => {
    // Given
    const queuedJobs: object[] = [];
    const deduplicationKeys: string[] = [];
    const queue = {
      async enqueue<TJob extends object>(job: TJob, options?: { readonly deduplicationKey?: string }): Promise<string> {
        queuedJobs.push(job);
        if (options?.deduplicationKey) {
          deduplicationKeys.push(options.deduplicationKey);
        }
        return options?.deduplicationKey ?? '';
      },
      async enqueueMany<TJob extends object>(
        entries: readonly { readonly job: TJob; readonly options?: { readonly deduplicationKey?: string } }[],
      ): Promise<readonly string[]> {
        return entries.map((entry) => entry.options?.deduplicationKey ?? '');
      },
      async inspectDeadLetters() {
        return { malformedRecordCount: 0, records: [] };
      },
    } satisfies Queue;
    const adapter = createEmailNotificationsQueueAdapter(queue);
    const notificationId = 'notification:email:payment-received';

    // When
    const queueId = await adapter.enqueue({
      channel: 'email',
      id: notificationId,
      notification: {
        channel: 'email',
        payload: { text: 'Payment received.' },
        recipients: ['user@example.com'],
        subject: 'Payment received',
      },
      queuedAt: '2026-09-03T00:00:00.000Z',
    });

    // Then
    expect(queueId).toBe(notificationId);
    expect(deduplicationKeys).toEqual([notificationId]);
    expect(queuedJobs).toMatchObject([{ id: notificationId }]);
  });

  it('uses Queue bulk enqueue to preserve ordered notification identities', async () => {
    // Given
    const bulkRequests: Array<readonly { readonly job: object; readonly options?: { readonly deduplicationKey?: string } }[]> = [];
    const queue = {
      async enqueue(): Promise<string> {
        throw new Error('Single enqueue must not be used for a bulk notification batch.');
      },
      async enqueueMany(
        entries: readonly { readonly job: object; readonly options?: { readonly deduplicationKey?: string } }[],
      ): Promise<readonly string[]> {
        bulkRequests.push(entries);
        return entries.map((entry) => entry.options?.deduplicationKey ?? '');
      },
      async inspectDeadLetters() {
        return { malformedRecordCount: 0, records: [] };
      },
    } satisfies Queue;
    const adapter = createEmailNotificationsQueueAdapter(queue);
    const enqueueMany = adapter.enqueueMany;

    if (!enqueueMany) {
      throw new Error('Email notifications queue adapter must provide bulk enqueue support.');
    }

    // When
    const queueIds = await enqueueMany([
      {
        channel: 'email',
        id: 'notification:email:first',
        notification: {
          channel: 'email',
          payload: { text: 'First email.' },
          recipients: ['first@example.com'],
          subject: 'First',
        },
        queuedAt: '2026-09-03T00:00:00.000Z',
      },
      {
        channel: 'email',
        id: 'notification:email:second',
        notification: {
          channel: 'email',
          payload: { text: 'Second email.' },
          recipients: ['second@example.com'],
          subject: 'Second',
        },
        queuedAt: '2026-09-03T00:00:01.000Z',
      },
    ]);

    // Then
    expect(queueIds).toEqual(['notification:email:first', 'notification:email:second']);
    expect(bulkRequests).toHaveLength(1);
    expect(bulkRequests[0]?.map((entry) => entry.options?.deduplicationKey)).toEqual([
      'notification:email:first',
      'notification:email:second',
    ]);
    expect(bulkRequests[0]?.map((entry) => entry.job)).toMatchObject([
      { id: 'notification:email:first' },
      { id: 'notification:email:second' },
    ]);
  });

  it('propagates a bulk enqueue failure without falling back to single enqueue', async () => {
    // Given
    const queue = {
      async enqueue(): Promise<string> {
        throw new Error('Single enqueue must not be used for a bulk notification batch.');
      },
      async enqueueMany(): Promise<readonly string[]> {
        throw new Error('Atomic batch enqueue failed.');
      },
      async inspectDeadLetters() {
        return { malformedRecordCount: 0, records: [] };
      },
    } satisfies Queue;
    const adapter = createEmailNotificationsQueueAdapter(queue);
    const enqueueMany = adapter.enqueueMany;

    if (!enqueueMany) {
      throw new Error('Email notifications queue adapter must provide bulk enqueue support.');
    }

    // When / Then
    await expect(
      enqueueMany([
        {
          channel: 'email',
          id: 'notification:email:failed-batch',
          notification: {
            channel: 'email',
            payload: { text: 'Do not enqueue individually.' },
            recipients: ['failed@example.com'],
            subject: 'Failed batch',
          },
          queuedAt: '2026-09-03T00:00:00.000Z',
        },
      ]),
    ).rejects.toThrow('Atomic batch enqueue failed.');
  });

  it('rejects another notification channel before email transport handoff', async () => {
    // Given
    const { delivered, worker } = createQueueTestFixture();
    const job = new EmailNotificationQueueJob(
      {
        channel: 'slack',
        payload: { text: 'Do not route this through email.' },
        recipients: ['user@example.com'],
        subject: 'Wrong channel',
      },
      '2026-07-10T00:00:00.000Z',
    );

    // When / Then
    await expect(worker.handle(job)).rejects.toEqual(
      new EmailMessageValidationError(
        'Queued notification channel "slack" does not match configured email channel "email".',
      ),
    );
    expect(delivered).toHaveLength(0);
  });

  it('uses the configured email channel when validating queued notifications', async () => {
    // Given
    const { delivered, worker } = createQueueTestFixture('transactional-email');
    const job = new EmailNotificationQueueJob(
      {
        channel: 'email',
        payload: { text: 'This targets the default channel, not the configured one.' },
        recipients: ['user@example.com'],
        subject: 'Default channel mismatch',
      },
      '2026-07-10T00:00:00.000Z',
    );

    // When / Then
    await expect(worker.handle(job)).rejects.toEqual(
      new EmailMessageValidationError(
        'Queued notification channel "email" does not match configured email channel "transactional-email".',
      ),
    );
    expect(delivered).toHaveLength(0);
  });
});
