import '@fluojs/core/metadata-preload';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailChannel, EmailService } from '@fluojs/email';
import {
  createEmailNotificationsQueueAdapter,
  EmailNotificationQueueJob,
  EmailNotificationsQueueWorker,
} from '@fluojs/email/queue';

test('email queue JSON round trip preserves native Uint8Array indexed bytes when content has an own bytes property', async () => {
  // Given
  const deliveries = [];
  const options = {
    defaultFrom: { address: 'noreply@example.com' },
    defaultReplyTo: [],
    notifications: { channel: 'email' },
    transport: {
      create: async () => ({
        async send(message) {
          const content = message.attachments[0].content;
          deliveries.push({
            native: content instanceof Uint8Array,
            length: content.byteLength,
            bytes: [content[0], content[1], content[2]],
          });
          return {
            accepted: message.to.map((recipient) => recipient.address),
            messageId: 'native-bytes-test',
            pending: [],
            rejected: [],
          };
        },
      }),
      kind: 'recording',
      ownsResources: false,
    },
    verifyOnModuleInit: false,
  };
  const worker = new EmailNotificationsQueueWorker(new EmailChannel(new EmailService(options), options));
  const backing = new Uint8Array([99, 0, 255, 42, 88]);
  const content = backing.subarray(1, 4);
  Object.defineProperty(content, 'bytes', { value: [9], enumerable: true });
  const notification = {
    channel: 'email',
    payload: { attachments: [{ filename: 'view.bin', content }], text: 'Native view' },
    recipients: ['user@example.com'],
  };

  // When
  for (const method of ['enqueue', 'enqueueMany']) {
    const captured = [];
    const adapter = createEmailNotificationsQueueAdapter({
      async enqueue(job) {
        captured.push(job);
        return 'native-view';
      },
      async enqueueMany(entries) {
        captured.push(...entries.map((entry) => entry.job));
        return entries.map(() => 'native-view');
      },
      async inspectDeadLetters() {
        return { malformedRecordCount: 0, records: [] };
      },
    });
    const request = { channel: 'email', id: 'native-view', notification, queuedAt: '2026-11-23T00:00:00.000Z' };
    if (method === 'enqueue') {
      await adapter.enqueue(request);
    } else {
      await adapter.enqueueMany([request]);
    }
    for (const job of captured) {
      const restored = Object.assign(
        Object.create(EmailNotificationQueueJob.prototype),
        JSON.parse(JSON.stringify(job)),
      );
      await worker.handle(restored);
    }
    await worker.handle(new EmailNotificationQueueJob(notification, request.queuedAt, request.id));
  }

  // Then
  assert.deepEqual(deliveries, [
    { native: true, length: 3, bytes: [0, 255, 42] },
    { native: true, length: 3, bytes: [0, 255, 42] },
    { native: true, length: 3, bytes: [0, 255, 42] },
    { native: true, length: 3, bytes: [0, 255, 42] },
  ]);
});
