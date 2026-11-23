import '@fluojs/core/metadata-preload';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailChannel, EmailMessageValidationError, EmailService } from '@fluojs/email';
import {
  createEmailNotificationsQueueAdapter,
  EmailNotificationQueueJob,
  EmailNotificationsQueueWorker,
} from '@fluojs/email/queue';

test('email queue JSON round trip preserves native Uint8Array indexed bytes when content has an own bytes property', async () => {
  // Given
  const deliveries = [];
  const messages = [];
  const options = {
    defaultFrom: { address: 'noreply@example.com' },
    defaultReplyTo: [],
    notifications: { channel: 'email' },
    transport: {
      create: async () => ({
        async send(message) {
          messages.push(message);
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

  const malformedContents = [
    { 0: 0, 1: 255, 2: 42 },
    {},
    null,
    9,
    { bytes: null },
    { bytes: '9' },
    { bytes: { 0: 9 } },
    { bytes: [null] },
    { bytes: [-1] },
    { bytes: [256] },
    { bytes: [1.5] },
    { bytes: ['9'] },
    { bytes: [true] },
    { bytes: new Array(1) },
    { bytes: [0], extra: true },
  ];
  for (const invalidContent of malformedContents) {
    const stored = {
      notification: {
        ...notification,
        payload: { text: 'Invalid stored attachment', attachments: [{ filename: 'invalid.bin', content: invalidContent }] },
      },
      queuedAt: '2026-11-23T00:00:00.000Z',
    };
    const restored = Object.assign(
      Object.create(EmailNotificationQueueJob.prototype),
      JSON.parse(JSON.stringify(stored)),
    );
    await assert.rejects(worker.handle(restored), EmailMessageValidationError);
  }
  assert.equal(messages.length, 4, 'Malformed stored content must not reach the transport');

  await worker.handle({
    notification: {
      ...notification,
      payload: { text: 'Valid empty wire attachment', attachments: [{ filename: 'empty.bin', content: { bytes: [] } }] },
    },
    queuedAt: '2026-11-23T00:00:00.000Z',
  });
  assert.equal(messages.length, 5);
  const empty = messages.at(-1).attachments[0].content;
  assert.ok(empty instanceof Uint8Array);
  assert.equal(empty.byteLength, 0);

  const directMessages = [];
  const directOptions = {
    ...options,
    transport: {
      ...options.transport,
      create: async () => ({
        async send(message) {
          directMessages.push(message);
          return {
            accepted: message.to.map((recipient) => recipient.address),
            messageId: 'direct-getter-test',
            pending: [],
            rejected: [],
          };
        },
      }),
    },
  };
  const directChannel = new EmailChannel(new EmailService(directOptions), directOptions);
  const handedOff = [];
  const send = directChannel.send.bind(directChannel);
  directChannel.send = (request, context) => {
    handedOff.push(request);
    return send(request, context);
  };
  const directWorker = new EmailNotificationsQueueWorker(directChannel);
  class DigestNotification {
    channel = 'email';
    payload = { text: 'Digest' };
    get recipients() {
      return ['ops@example.com'];
    }
  }
  const digest = new DigestNotification();
  const directError = await directWorker.handle({
    notification: digest,
    queuedAt: '2026-11-23T00:00:00.000Z',
  }).then(() => null, (error) => error);
  assert.ifError(directError);
  assert.equal(handedOff[0], digest);
  assert.equal(directMessages.length, 1);
  assert.equal(directMessages[0].to[0].address, 'ops@example.com');
  assert.equal(directMessages[0].text, 'Digest');

  class DirectAttachment {
    constructor(content) {
      this.content = content;
    }
    get filename() {
      return typeof this.content === 'string' ? 'report.txt' : 'report.bin';
    }
    get contentType() {
      return typeof this.content === 'string' ? 'text/plain' : 'application/octet-stream';
    }
  }
  const attachments = Object.freeze([
    Object.freeze(new DirectAttachment('report')),
    Object.freeze(new DirectAttachment(content)),
  ]);
  const directNotification = {
    channel: 'email',
    payload: { attachments, text: 'Direct attachments' },
    recipients: ['ops@example.com'],
    subject: 'Direct envelope',
    metadata: { trace: 'unchanged' },
  };
  await directWorker.handle({
    notification: directNotification,
    queuedAt: '2026-11-23T00:00:00.000Z',
  });
  assert.equal(handedOff[1], directNotification);
  assert.equal(handedOff[1].payload.attachments, attachments);
  assert.equal(handedOff[1].payload.attachments[0], attachments[0]);
  assert.equal(handedOff[1].payload.attachments[1], attachments[1]);
  assert.equal(directMessages.length, 2);
  assert.equal(directMessages[1].subject, 'Direct envelope');
  assert.deepEqual(directMessages[1].metadata, { trace: 'unchanged' });
  assert.equal(directMessages[1].attachments, attachments);
  assert.deepEqual(directMessages[1].attachments.map((attachment) => [attachment.filename, attachment.contentType]), [
    ['report.txt', 'text/plain'],
    ['report.bin', 'application/octet-stream'],
  ]);
  assert.equal(directMessages[1].attachments[0].content, 'report');
  assert.equal(directMessages[1].attachments[1].content, content);
  assert.ok(content instanceof Uint8Array);
  assert.equal(content.byteLength, 3);
  assert.deepEqual([content[0], content[1], content[2]], [0, 255, 42]);
  assert.equal(attachments[1].content, content);
});
