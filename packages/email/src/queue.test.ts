import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { EmailNotificationQueueJob as PublicEmailNotificationQueueJob } from '@fluojs/email/queue';

import { EmailChannel } from './channel.js';
import { EmailMessageValidationError } from './errors.js';
import { createEmailNotificationsQueueAdapter, EmailNotificationQueueJob, EmailNotificationsQueueWorker } from './queue.js';
import { EmailService } from './service.js';
import type { EmailAttachment, EmailNotificationDispatchRequest, EmailNotificationPayload, EmailTransport, NormalizedEmailMessage, NormalizedEmailModuleOptions } from './types.js';
import type { Queue } from '@fluojs/queue';

function createQueueTestFixture(channel = 'email'): {
  readonly channel: EmailChannel;
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
  const emailChannel = new EmailChannel(service, options);

  return {
    channel: emailChannel,
    delivered,
    worker: new EmailNotificationsQueueWorker(emailChannel),
  };
}

describe('EmailNotificationsQueueWorker', () => {
  it.each(['enqueue', 'enqueueMany'] as const)('%s composes the same DTO projection with mixed native attachments', async (method) => {
    const { delivered, worker } = createQueueTestFixture();
    const calls: { kind: string; key: string; receiver: unknown }[] = [];
    const opaque = Object.freeze({
      toJSON(key: string) {
        calls.push({ kind: 'opaque', key, receiver: this });
        return { bytes: [7], raw: new Uint8Array([8]) };
      },
    });
    const backing = new Uint8Array([99, 0, 255, 42, 88]);
    const binary = backing.subarray(1, 4);
    Object.defineProperty(binary, 'bytes', { value: [9], enumerable: true });
    class NativeAttachment implements EmailAttachment {
      constructor(readonly content: Uint8Array) {}
      get filename(): string { return 'view.bin'; }
      get contentType(): string { return 'application/octet-stream'; }
    }
    class ProjectedAttachment extends NativeAttachment {
      toJSON(key: string) {
        calls.push({ kind: 'attachment', key, receiver: this });
        return { filename: 'projected.bin', content: this.content };
      }
    }
    const mixed = Object.freeze([
      Object.freeze({ filename: 'text.txt', content: 'plain text' }),
      Object.freeze(new NativeAttachment(binary)),
    ]);
    const projectedAttachment = Object.freeze(new ProjectedAttachment(binary));
    const projectedString = Object.freeze({
      filename: 'original.txt', contentType: 'text/plain', content: 'original text',
      toJSON(key: string) {
        calls.push({ kind: 'string', key, receiver: this });
        return { filename: 'projected.txt', content: 'projected text' };
      },
    });
    const nestedAttachments = [projectedString, projectedAttachment];
    Object.defineProperty(nestedAttachments, 'toJSON', {
      value: function (this: typeof nestedAttachments, key: string) {
        calls.push({ kind: 'array', key, receiver: this });
        return this;
      },
    });
    Object.freeze(nestedAttachments);
    const nestedPayload: EmailNotificationPayload = Object.freeze({
      attachments: nestedAttachments, text: 'Original nested body',
      toJSON(key: string) {
        calls.push({ kind: 'payload', key, receiver: this });
        return {
          attachments: this.attachments, text: 'Nested body', templateData: { opaque },
          toJSON() { throw new Error('Returned payload must not be projected twice'); },
        };
      },
    });
    const droppedPayload: EmailNotificationPayload = Object.freeze({
      attachments: mixed, text: 'Original dropped body',
      toJSON(key: string) {
        calls.push({ kind: 'drop', key, receiver: this });
        return { text: 'Dropped attachments' };
      },
    });
    class JointNotification implements EmailNotificationDispatchRequest {
      readonly channel = 'email';
      readonly subject = 'Original subject';
      #omitSubject: boolean;
      constructor(readonly payload: EmailNotificationPayload, omitSubject = false) { this.#omitSubject = omitSubject; }
      get recipients(): readonly string[] { return ['original@example.com']; }
      toJSON(key: string) {
        calls.push({ kind: 'notification', key, receiver: this });
        return {
          channel: this.channel, payload: this.payload, recipients: ['projected@example.com'],
          ...(this.#omitSubject ? {} : { subject: 'Projected subject' }), metadata: { opaque },
          toJSON() { throw new Error('Returned notification must not be projected twice'); },
        };
      }
    }
    const joint = Object.freeze(new JointNotification(Object.freeze({ text: 'Joint body', attachments: mixed })));
    const nested = Object.freeze(new JointNotification(nestedPayload));
    const dropped = Object.freeze(new JointNotification(droppedPayload, true));
    const ordinary: EmailNotificationDispatchRequest = Object.freeze({
      channel: 'email', recipients: ['ordinary@example.com'], subject: 'Ordinary subject',
      payload: Object.freeze({ text: 'Ordinary body', attachments: mixed }),
    });
    const requests = [joint, nested, dropped, ordinary].map((notification, index) => ({
      channel: 'email', id: `joint-${index}`, notification, queuedAt: '2026-11-23T00:00:00.000Z',
    }));
    const stored: EmailNotificationQueueJob[] = [];
    const adapter = createEmailNotificationsQueueAdapter({
      async enqueue(job) {
        const payload: EmailNotificationQueueJob = JSON.parse(JSON.stringify(job));
        stored.push(payload);
        return 'joint';
      },
      async enqueueMany(entries) {
        const batch: EmailNotificationQueueJob[] = entries.map(({ job }) => JSON.parse(JSON.stringify(job)));
        stored.push(...batch);
        return batch.map(() => 'joint');
      },
      async inspectDeadLetters() { return { malformedRecordCount: 0, records: [] }; },
    });
    if (method === 'enqueue') {
      for (const request of requests) await adapter.enqueue(request);
    } else {
      await adapter.enqueueMany?.(requests);
    }
    for (const payload of stored) await worker.handle(Object.assign(Object.create(EmailNotificationQueueJob.prototype), payload));
    expect(delivered).toHaveLength(4);
    expect(delivered[0]).toMatchObject({
      subject: 'Projected subject', text: 'Joint body', to: [{ address: 'projected@example.com' }],
      metadata: { opaque: { bytes: [7], raw: { 0: 8 } } },
      attachments: [
        { filename: 'text.txt', content: 'plain text' },
        { filename: 'view.bin', contentType: 'application/octet-stream', content: new Uint8Array([0, 255, 42]) },
      ],
    });
    expect(delivered[0]?.attachments?.[1]?.content).toBeInstanceOf(Uint8Array);
    expect(delivered[1]).toMatchObject({ subject: 'Projected subject', text: 'Nested body', to: [{ address: 'projected@example.com' }] });
    expect(delivered[1]?.attachments).toEqual([
      { filename: 'projected.txt', content: 'projected text' },
      { filename: 'projected.bin', content: new Uint8Array([0, 255, 42]) },
    ]);
    expect(stored[1]?.notification.payload.templateData).toEqual({ opaque: { bytes: [7], raw: { 0: 8 } } });
    expect(delivered[2]?.text).toBe('Dropped attachments');
    expect(delivered[2]?.subject).toBeUndefined();
    expect(delivered[2]?.attachments).toBeUndefined();
    expect(Object.hasOwn(stored[2]?.notification ?? {}, 'subject')).toBe(false);
    expect(Object.hasOwn(stored[2]?.notification.payload ?? {}, 'attachments')).toBe(false);
    expect(delivered[3]).toMatchObject({ subject: 'Ordinary subject', text: 'Ordinary body', to: [{ address: 'ordinary@example.com' }] });
    expect(delivered[3]?.attachments).toEqual(delivered[0]?.attachments);
    const expectedCalls = [
      ['notification', 'notification', joint], ['notification', 'notification', nested],
      ['notification', 'notification', dropped], ['payload', 'payload', nestedPayload],
      ['drop', 'payload', droppedPayload], ['array', 'attachments', nestedAttachments],
      ['string', '0', projectedString], ['attachment', '1', projectedAttachment],
    ] as const;
    for (const [kind, key, receiver] of expectedCalls) {
      const matching = calls.filter((call) => call.kind === kind && call.receiver === receiver);
      expect(matching).toHaveLength(1);
      expect(matching[0]?.key).toBe(key);
      expect(matching[0]?.receiver).toBe(receiver);
    }
    expect(calls.filter((call) => call.kind === 'opaque')).toHaveLength(4);
    for (const call of calls.filter((item) => item.kind === 'opaque')) {
      expect(call.key).toBe('opaque');
      expect(call.receiver).toBe(opaque);
    }
    const projectionError = new Error('Joint projection failed');
    class FailingNotification extends JointNotification {
      override toJSON(_key: string): ReturnType<JointNotification['toJSON']> { throw projectionError; }
    }
    const failing = { ...requests[0], notification: new FailingNotification(joint.payload) };
    if (method === 'enqueue') await expect(adapter.enqueue(failing)).rejects.toBe(projectionError);
    else await expect(adapter.enqueueMany?.([requests[3], failing, requests[0]])).rejects.toBe(projectionError);
    const opaqueError = new Error('Opaque projection failed');
    const failingOpaque = { ...requests[0], notification: {
      ...ordinary, metadata: { toJSON() { throw opaqueError; } },
    } };
    if (method === 'enqueue') await expect(adapter.enqueue(failingOpaque)).rejects.toBe(opaqueError);
    else await expect(adapter.enqueueMany?.([requests[3], failingOpaque, requests[0]])).rejects.toBe(opaqueError);
    expect(stored).toHaveLength(4);
    expect(delivered).toHaveLength(4);
    expect(joint.payload.attachments).toBe(mixed);
    expect(nested.payload).toBe(nestedPayload);
    expect(dropped.payload.attachments).toBe(mixed);
    expect(joint.subject).toBe('Original subject');
    expect(Reflect.get(binary, 'bytes')).toEqual([9]);
    expect(backing).toEqual(new Uint8Array([99, 0, 255, 42, 88]));
  });

  it.each(['enqueue', 'enqueueMany'] as const)('%s preserves producer getters and sequential original JSON projections', async (method) => {
    const { delivered, worker } = createQueueTestFixture();
    const projections: { notification: EmailNotificationDispatchRequest; key: string }[] = [];
    class JsonNotification implements EmailNotificationDispatchRequest {
      readonly channel = 'email';
      constructor(readonly payload: EmailNotificationPayload) {}
      get recipients(): readonly string[] {
        return ['ops@example.com'];
      }
      toJSON(key: string) {
        projections.push({ notification: this, key });
        return { channel: this.channel, payload: this.payload, recipients: this.recipients, subject: 'JSON projection' };
      }
    }
    class BinaryAttachment implements EmailAttachment {
      constructor(readonly content: Uint8Array) {}
      get filename(): string {
        return this.content.byteLength ? 'report.bin' : 'empty.bin';
      }
      get contentType(): string {
        return 'application/octet-stream';
      }
    }
    const backing = new Uint8Array([99, 0, 255, 42, 88]);
    const binary = backing.subarray(1, 4);
    Object.defineProperty(binary, 'bytes', { value: [9], enumerable: true });
    const opaque = { bytes: [7], raw: new Uint8Array([8]) };
    const attachments = Object.freeze([
      Object.freeze({ filename: 'report.txt', contentType: 'text/plain', content: 'report' }),
      Object.freeze(new BinaryAttachment(binary)),
      Object.freeze(new BinaryAttachment(new Uint8Array(0))),
    ]);
    const native: EmailNotificationDispatchRequest = {
      channel: 'email', recipients: ['ops@example.com'], metadata: { opaque },
      payload: { text: 'Native', attachments, templateData: { opaque } },
    };
    const stringDto = Object.freeze(new JsonNotification(Object.freeze({
      text: 'String DTO', attachments: Object.freeze([{ filename: 'report.txt', content: 'report' }]),
    })));
    const emptyDto = Object.freeze(new JsonNotification(Object.freeze({ text: 'Empty DTO' })));
    const requests = [native, stringDto, emptyDto, native, emptyDto].map((notification, index) => ({
      channel: 'email', id: `producer-${index}`, notification, queuedAt: '2026-11-23T00:00:00.000Z',
    }));
    const stored: { job: object; payload: EmailNotificationQueueJob }[] = [];
    const adapter = createEmailNotificationsQueueAdapter({
      async enqueue(job) {
        expect(job).toBeInstanceOf(EmailNotificationQueueJob);
        const payload: EmailNotificationQueueJob = JSON.parse(JSON.stringify(job));
        stored.push({ job, payload });
        return 'stored';
      },
      async enqueueMany(entries) {
        const batch = entries.map(({ job }) => {
          expect(job).toBeInstanceOf(EmailNotificationQueueJob);
          const payload: EmailNotificationQueueJob = JSON.parse(JSON.stringify(job));
          return { job, payload };
        });
        stored.push(...batch);
        return batch.map(() => 'stored');
      },
      async inspectDeadLetters() {
        return { malformedRecordCount: 0, records: [] };
      },
    });
    if (method === 'enqueue') {
      for (const request of requests) await adapter.enqueue(request);
    } else {
      await adapter.enqueueMany?.(requests);
    }
    expect(stored).toHaveLength(5);
    for (const [index, captured] of stored.entries()) {
      expect(captured.payload).toMatchObject({ id: requests[index]?.id, queuedAt: requests[index]?.queuedAt });
      await worker.handle(Object.assign(Object.create(EmailNotificationQueueJob.prototype), captured.payload));
    }
    expect(projections).toEqual([stringDto, emptyDto, emptyDto].map((notification) => ({ notification, key: 'notification' })));
    expect(delivered.map((message) => message.text)).toEqual(['Native', 'String DTO', 'Empty DTO', 'Native', 'Empty DTO']);
    for (const index of [0, 3]) {
      expect(delivered[index]?.attachments).toEqual([
        { filename: 'report.txt', contentType: 'text/plain', content: 'report' },
        { filename: 'report.bin', contentType: 'application/octet-stream', content: new Uint8Array([0, 255, 42]) },
        { filename: 'empty.bin', contentType: 'application/octet-stream', content: new Uint8Array(0) },
      ]);
      expect(stored[index]?.payload.notification.payload.templateData).toEqual({ opaque: { bytes: [7], raw: { 0: 8 } } });
      expect(delivered[index]?.metadata).toEqual({ opaque: { bytes: [7], raw: { 0: 8 } } });
    }
    for (const index of [1, 2, 4]) {
      expect(delivered[index]).toMatchObject({ subject: 'JSON projection', to: [{ address: 'ops@example.com' }] });
    }
    expect(delivered[1]?.attachments).toEqual([{ filename: 'report.txt', content: 'report' }]);
    const serializationError = new Error('Original notification projection failed');
    class FailingNotification extends JsonNotification {
      override toJSON(_key: string): ReturnType<JsonNotification['toJSON']> {
        throw serializationError;
      }
    }
    const failing = { ...requests[0], notification: new FailingNotification({ text: 'Fail' }) };
    if (method === 'enqueue') {
      await expect(adapter.enqueue(failing)).rejects.toBe(serializationError);
    } else {
      await expect(adapter.enqueueMany?.([requests[0], failing, requests[1]])).rejects.toBe(serializationError);
    }
    expect(stored).toHaveLength(5);
    expect(delivered).toHaveLength(5);
    expect(projections).toHaveLength(3);
    expect(native.payload.attachments).toBe(attachments);
    expect(native.payload.templateData?.opaque).toBe(opaque);
    expect(attachments[1]?.content).toBe(binary);
    expect(backing).toEqual(new Uint8Array([99, 0, 255, 42, 88]));
    expect(Reflect.get(binary, 'bytes')).toEqual([9]);
  });

  it('passes a structural notification DTO with inherited recipients through unchanged', async () => {
    class DigestNotification implements EmailNotificationDispatchRequest {
      readonly channel = 'email';
      readonly payload = { text: 'Digest' };
      get recipients(): readonly string[] {
        return ['ops@example.com'];
      }
    }
    const { channel, delivered, worker } = createQueueTestFixture();
    const send = vi.spyOn(channel, 'send');
    const notification = new DigestNotification();
    const job: PublicEmailNotificationQueueJob = {
      notification,
      queuedAt: '2026-11-23T00:00:00.000Z',
    };

    await worker.handle(job);

    expect(send.mock.calls[0]?.[0]).toBe(notification);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ text: 'Digest', to: [{ address: 'ops@example.com' }] });
    expect(notification.payload).toEqual({ text: 'Digest' });
  });

  it('passes native and string attachment DTOs with inherited fields through unchanged', async () => {
    class DirectAttachment implements EmailAttachment {
      constructor(readonly content: string | Uint8Array) {}
      get filename(): string {
        return typeof this.content === 'string' ? 'report.txt' : 'report.bin';
      }
      get contentType(): string {
        return typeof this.content === 'string' ? 'text/plain' : 'application/octet-stream';
      }
    }
    const { channel, delivered, worker } = createQueueTestFixture();
    const send = vi.spyOn(channel, 'send');
    const binary = new Uint8Array([99, 0, 255, 42, 88]).subarray(1, 4);
    const attachments = Object.freeze([
      Object.freeze(new DirectAttachment('report')),
      Object.freeze(new DirectAttachment(binary)),
    ]);
    const notification: EmailNotificationDispatchRequest = {
      channel: 'email',
      recipients: ['ops@example.com'],
      payload: { attachments, text: 'Direct attachments' },
      subject: 'Direct envelope',
      metadata: { trace: 'unchanged' },
    };

    await worker.handle({ notification, queuedAt: '2026-11-23T00:00:00.000Z' });

    expect(send.mock.calls[0]?.[0]).toBe(notification);
    expect(send.mock.calls[0]?.[0].payload.attachments).toBe(attachments);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      subject: 'Direct envelope',
      metadata: { trace: 'unchanged' },
      attachments: [
        { filename: 'report.txt', contentType: 'text/plain', content: 'report' },
        { filename: 'report.bin', contentType: 'application/octet-stream', content: new Uint8Array([0, 255, 42]) },
      ],
    });
    expect(notification.payload.attachments?.[0]).toBe(attachments[0]);
    expect(notification.payload.attachments?.[1]).toBe(attachments[1]);
    expect(attachments[1]?.content).toBe(binary);
  });

  it('preserves the public queue job notification type and structural worker input', async () => {
    expectTypeOf<EmailNotificationQueueJob['notification']>().toEqualTypeOf<EmailNotificationDispatchRequest>();
    expectTypeOf<PublicEmailNotificationQueueJob['notification']>().toEqualTypeOf<EmailNotificationDispatchRequest>();

    const { delivered, worker } = createQueueTestFixture();
    const notification: EmailNotificationDispatchRequest = {
      channel: 'email',
      payload: { text: 'Direct structural job' },
      recipients: ['user@example.com'],
    };
    const job: PublicEmailNotificationQueueJob = {
      notification,
      queuedAt: '2026-11-23T00:00:00.000Z',
    };

    await worker.handle(job);
    await worker.handle({ notification, queuedAt: job.queuedAt });

    expect(delivered).toHaveLength(2);
    expect(delivered.map((message) => message.text)).toEqual(['Direct structural job', 'Direct structural job']);
  });

  it.each([
    { method: 'enqueue', alteredIterator: false },
    { method: 'enqueueMany', alteredIterator: false },
    { method: 'enqueue', alteredIterator: true },
    { method: 'enqueueMany', alteredIterator: true },
  ])('$method preserves mixed attachments through JSON queue storage (altered iterator: $alteredIterator)', async ({ method, alteredIterator }) => {
    // Given
    const { delivered, worker } = createQueueTestFixture();
    const queued: object[] = [];
    const adapter = createEmailNotificationsQueueAdapter({
      async enqueue(job) {
        queued.push(job);
        return 'queued';
      },
      async enqueueMany(entries) {
        queued.push(...entries.map((entry) => entry.job));
        return entries.map(() => 'queued');
      },
      async inspectDeadLetters() {
        return { malformedRecordCount: 0, records: [] };
      },
    });
    const backing = new Uint8Array([99, 0, 255, 42, 88]);
    class AlteredIteratorBytes extends Uint8Array {
      override [Symbol.iterator](): ReturnType<Uint8Array[typeof Symbol.iterator]> {
        return new Uint8Array([17])[Symbol.iterator]();
      }
    }
    const binary = alteredIterator ? new AlteredIteratorBytes(backing.buffer, 1, 3) : backing.subarray(1, 4);
    const attachments = Object.freeze([
      { filename: 'text.txt', contentType: 'text/plain', content: 'original text' },
      { filename: 'bytes.bin', contentType: 'application/octet-stream', content: binary },
      { filename: 'empty.bin', content: new Uint8Array(0) },
    ].map((attachment) => Object.freeze(attachment)));
    const notification = {
      channel: 'email',
      payload: { attachments, text: 'Attachments', templateData: { opaque: { bytes: [7] } } },
      recipients: ['user@example.com'],
      subject: 'Mixed attachments',
      metadata: { trace: 'preserved' },
    };
    const job = { channel: 'email', id: 'attachment-job', notification, queuedAt: '2026-11-23T00:00:00.000Z' };

    // When
    if (method === 'enqueue') {
      await adapter.enqueue(job);
    } else {
      await adapter.enqueueMany?.([job]);
    }
    for (const captured of queued) {
      const restored: EmailNotificationQueueJob = Object.assign(
        Object.create(EmailNotificationQueueJob.prototype),
        JSON.parse(JSON.stringify(captured)),
      );
      expect(restored).toMatchObject({ id: job.id, queuedAt: job.queuedAt });
      expect(restored.notification).toMatchObject({
        metadata: notification.metadata,
        payload: { templateData: notification.payload.templateData },
      });
      await worker.handle(restored);
    }

    // Then
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ subject: 'Mixed attachments', text: 'Attachments', metadata: { trace: 'preserved' } });
    expect(delivered[0]?.attachments).toEqual([
      { filename: 'text.txt', contentType: 'text/plain', content: 'original text' },
      { filename: 'bytes.bin', contentType: 'application/octet-stream', content: new Uint8Array([0, 255, 42]) },
      { filename: 'empty.bin', content: new Uint8Array(0) },
    ]);
    expect(delivered[0]?.attachments?.[1]?.content).toBeInstanceOf(Uint8Array);
    expect(delivered[0]?.attachments?.[2]?.content).toBeInstanceOf(Uint8Array);
    expect(notification.payload.attachments).toBe(attachments);
    expect(attachments[1]?.content).toBe(binary);
    expect(backing).toEqual(new Uint8Array([99, 0, 255, 42, 88]));
  });

  it.each([false, true])('delivers legacy JSON jobs with string attachments present=%s', async (hasAttachments) => {
    // Given
    const { delivered, worker } = createQueueTestFixture();
    const attachments = hasAttachments ? [{ filename: 'legacy.txt', content: 'legacy text' }] : undefined;
    const legacy = {
      notification: {
        channel: 'email',
        payload: { attachments, text: 'Legacy job' },
        recipients: ['user@example.com'],
      },
      queuedAt: '2026-09-03T00:00:00.000Z',
    };
    const restored: EmailNotificationQueueJob = Object.assign(
      Object.create(EmailNotificationQueueJob.prototype),
      JSON.parse(JSON.stringify(legacy)),
    );

    // When
    await worker.handle(restored);

    // Then
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.attachments).toEqual(attachments);
  });

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
