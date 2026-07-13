import { describe, expect, it } from 'vitest';

import { EmailChannel } from './channel.js';
import { EmailMessageValidationError } from './errors.js';
import { EmailNotificationQueueJob, EmailNotificationsQueueWorker } from './queue.js';
import { EmailService } from './service.js';
import type { EmailTransport, NormalizedEmailMessage, NormalizedEmailModuleOptions } from './types.js';

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
