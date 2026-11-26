import '@fluojs/core/metadata-preload';
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
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

  const projections = [];
  class JsonNotification {
    channel = 'email';
    constructor(payload) {
      this.payload = payload;
    }
    get recipients() {
      return ['ops@example.com'];
    }
    toJSON(key) {
      projections.push({ notification: this, key });
      return { channel: this.channel, payload: this.payload, recipients: this.recipients, subject: 'JSON projection' };
    }
  }
  class BinaryAttachment {
    constructor(content) {
      this.content = content;
    }
    get filename() {
      return this.content.byteLength ? 'report.bin' : 'empty.bin';
    }
    get contentType() {
      return 'application/octet-stream';
    }
  }
  const opaque = { bytes: [7], raw: new Uint8Array([8]) };
  const producerAttachments = Object.freeze([
    Object.freeze({ filename: 'report.txt', contentType: 'text/plain', content: 'report' }),
    Object.freeze(new BinaryAttachment(content)),
    Object.freeze(new BinaryAttachment(new Uint8Array(0))),
  ]);
  const native = {
    channel: 'email', recipients: ['ops@example.com'], metadata: { opaque },
    payload: { text: 'Native', attachments: producerAttachments, templateData: { opaque } },
  };
  const stringDto = Object.freeze(new JsonNotification(Object.freeze({
    text: 'String DTO', attachments: Object.freeze([{ filename: 'report.txt', content: 'report' }]),
  })));
  const emptyDto = Object.freeze(new JsonNotification(Object.freeze({ text: 'Empty DTO' })));
  for (const method of ['enqueue', 'enqueueMany']) {
    const stored = [];
    const adapter = createEmailNotificationsQueueAdapter({
      async enqueue(job) {
        assert.equal(job.constructor, EmailNotificationQueueJob);
        const payload = JSON.parse(JSON.stringify(job));
        stored.push({ job, payload });
        return 'stored';
      },
      async enqueueMany(entries) {
        const batch = entries.map(({ job }) => {
          assert.equal(job.constructor, EmailNotificationQueueJob);
          return { job, payload: JSON.parse(JSON.stringify(job)) };
        });
        stored.push(...batch);
        return batch.map(() => 'stored');
      },
      async inspectDeadLetters() {
        return { malformedRecordCount: 0, records: [] };
      },
    });
    const requests = [native, stringDto, emptyDto, native, emptyDto].map((notification, index) => ({
      channel: 'email', id: `producer-${index}`, notification, queuedAt: '2026-11-23T00:00:00.000Z',
    }));
    const before = directMessages.length;
    const projectionStart = projections.length;
    if (method === 'enqueue') {
      for (const request of requests) await adapter.enqueue(request);
    } else {
      await adapter.enqueueMany(requests);
    }
    assert.equal(stored.length, 5);
    for (const [index, captured] of stored.entries()) {
      assert.equal(captured.payload.id, requests[index].id);
      assert.equal(captured.payload.queuedAt, requests[index].queuedAt);
      const restored = Object.assign(Object.create(EmailNotificationQueueJob.prototype), captured.payload);
      await directWorker.handle(restored);
      const message = directMessages.at(-1);
      if (index === 0 || index === 3) {
        const bytes = message.attachments[1].content;
        assert.ok(bytes instanceof Uint8Array);
        assert.equal(bytes.byteLength, 3);
        assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0, 255, 42]);
        assert.equal(message.attachments[1].filename, 'report.bin');
        assert.equal(message.attachments[1].contentType, 'application/octet-stream');
        assert.equal(message.attachments[0].content, 'report');
        assert.equal(message.attachments[0].filename, 'report.txt');
        assert.equal(message.attachments[2].filename, 'empty.bin');
        assert.equal(message.attachments[2].contentType, 'application/octet-stream');
        assert.ok(message.attachments[2].content instanceof Uint8Array);
        assert.equal(message.attachments[2].content.byteLength, 0);
        assert.deepEqual(restored.notification.payload.templateData, { opaque: { bytes: [7], raw: { 0: 8 } } });
        assert.deepEqual(message.metadata, { opaque: { bytes: [7], raw: { 0: 8 } } });
      } else {
        assert.equal(message.to[0].address, 'ops@example.com');
        assert.equal(message.subject, 'JSON projection');
        assert.equal(message.text, index === 1 ? 'String DTO' : 'Empty DTO');
        assert.deepEqual(message.attachments, index === 1 ? [{ filename: 'report.txt', content: 'report' }] : undefined);
      }
    }
    assert.equal(directMessages.length, before + 5);
    assert.deepEqual(projections.slice(projectionStart), [stringDto, emptyDto, emptyDto].map((notification) => ({
      notification, key: 'notification',
    })));
    const serializationError = new Error('Original notification projection failed');
    class FailingNotification extends JsonNotification {
      toJSON() {
        throw serializationError;
      }
    }
    const failing = { ...requests[0], notification: new FailingNotification({ text: 'Fail' }) };
    if (method === 'enqueue') {
      await assert.rejects(adapter.enqueue(failing), serializationError);
    } else {
      await assert.rejects(adapter.enqueueMany([requests[0], failing, requests[1]]), serializationError);
    }
    assert.equal(stored.length, 5);
    assert.equal(directMessages.length, before + 5);
    assert.equal(projections.length, projectionStart + 3);
    assert.equal(native.payload.attachments, producerAttachments);
    assert.equal(native.payload.templateData.opaque, opaque);
    assert.equal(producerAttachments[1].content, content);
    assert.deepEqual([content[0], content[1], content[2]], [0, 255, 42]);
    assert.deepEqual(content.bytes, [9]);
  }

  class JointNotification extends JsonNotification {
    toJSON(key) {
      projections.push({ notification: this, key });
      return {
        channel: this.channel, payload: this.payload, recipients: ['projected@example.com'], subject: 'Joint projection',
        toJSON() { throw new Error('Returned notification must not be projected twice'); },
      };
    }
  }
  const joint = Object.freeze(new JointNotification(Object.freeze({
    text: 'Joint body', attachments: producerAttachments, templateData: { opaque },
  })));
  for (const method of ['enqueue', 'enqueueMany']) {
    const stored = [];
    const adapter = createEmailNotificationsQueueAdapter({
      async enqueue(job) {
        stored.push(JSON.parse(JSON.stringify(job)));
        return 'joint';
      },
      async enqueueMany(entries) {
        const batch = entries.map(({ job }) => JSON.parse(JSON.stringify(job)));
        stored.push(...batch);
        return batch.map(() => 'joint');
      },
      async inspectDeadLetters() { return { malformedRecordCount: 0, records: [] }; },
    });
    const request = {
      channel: 'email', id: 'joint', notification: joint, queuedAt: '2026-11-23T00:00:00.000Z',
    };
    const projectionStart = projections.length;
    const before = directMessages.length;
    if (method === 'enqueue') await adapter.enqueue(request);
    else await adapter.enqueueMany([request]);
    assert.equal(stored.length, 1);
    const restored = Object.assign(Object.create(EmailNotificationQueueJob.prototype), stored[0]);
    const jointError = await directWorker.handle(restored).then(() => null, (error) => error);
    assert.ifError(jointError);
    const message = directMessages.at(-1);
    assert.equal(directMessages.length, before + 1);
    assert.equal(message.to[0].address, 'projected@example.com');
    assert.equal(message.subject, 'Joint projection');
    assert.equal(message.text, 'Joint body');
    assert.deepEqual(message.attachments, [
      { filename: 'report.txt', contentType: 'text/plain', content: 'report' },
      { filename: 'report.bin', contentType: 'application/octet-stream', content: new Uint8Array([0, 255, 42]) },
      { filename: 'empty.bin', contentType: 'application/octet-stream', content: new Uint8Array(0) },
    ]);
    assert.ok(message.attachments[1].content instanceof Uint8Array);
    assert.equal(message.attachments[1].content.byteLength, 3);
    assert.deepEqual(restored.notification.payload.templateData, { opaque: { bytes: [7], raw: { 0: 8 } } });
    assert.equal(projections.length, projectionStart + 1);
    assert.equal(projections.at(-1).key, 'notification');
    assert.equal(projections.at(-1).notification, joint);
    const projectionError = new Error('Joint projection failed');
    class FailingJoint extends JointNotification {
      toJSON() { throw projectionError; }
    }
    const failing = { ...request, notification: new FailingJoint(joint.payload) };
    if (method === 'enqueue') await assert.rejects(adapter.enqueue(failing), projectionError);
    else await assert.rejects(adapter.enqueueMany([
      { ...request, notification: native }, failing, request,
    ]), projectionError);
    assert.equal(stored.length, 1);
    assert.equal(directMessages.length, before + 1);
    assert.equal(projections.length, projectionStart + 1);
    assert.equal(joint.payload.attachments, producerAttachments);
    assert.equal(joint.payload.templateData.opaque, opaque);
    assert.deepEqual(content.bytes, [9]);
  }
  for (const method of ['enqueue', 'enqueueMany']) {
    let discardedReads = 0;
    const selectedView = new Uint8Array([99, 0, 255, 42, 88]).subarray(1, 4);
    const selectedAttachments = Object.freeze([
      Object.freeze({ filename: 'text.txt', content: 'text' }),
      Object.freeze({ filename: 'selected.bin', contentType: 'application/octet-stream', content: selectedView }),
    ]);
    const discarded = { filename: 'discarded.bin', get content() { discardedReads++; throw new Error('Discarded content was read'); } };
    const raw = [discarded, selectedAttachments[1]];
    const selectedCalls = [];
    Object.defineProperty(raw, 'toJSON', { value: function (key) {
      selectedCalls.push({ key, receiver: this }); return selectedAttachments;
    } });
    Object.freeze(raw);
    const selectedNotification = Object.freeze({
      channel: 'email', recipients: ['selected@example.com'],
      payload: Object.freeze({ text: 'Selected body', attachments: raw }),
    });
    const stored = [];
    const adapter = createEmailNotificationsQueueAdapter({
      async enqueue(job) { stored.push(JSON.parse(JSON.stringify(job))); return 'selected'; },
      async enqueueMany(entries) {
        const batch = entries.map(({ job }) => JSON.parse(JSON.stringify(job)));
        stored.push(...batch); return batch.map(() => 'selected');
      },
      async inspectDeadLetters() { return { malformedRecordCount: 0, records: [] }; },
    });
    const request = { channel: 'email', id: 'selected-view', notification: selectedNotification, queuedAt: '2026-11-23T00:00:00.000Z' };
    const enqueueError = await (method === 'enqueue' ? adapter.enqueue(request) : adapter.enqueueMany([request]))
      .then(() => null, (error) => error);
    assert.ifError(enqueueError);
    assert.equal(discardedReads, 0);
    assert.deepEqual(selectedCalls, [{ key: 'attachments', receiver: raw }]);
    await directWorker.handle(Object.assign(Object.create(EmailNotificationQueueJob.prototype), stored[0]));
    assert.deepEqual(directMessages.at(-1).attachments, [
      { filename: 'text.txt', content: 'text' },
      { filename: 'selected.bin', contentType: 'application/octet-stream', content: new Uint8Array([0, 255, 42]) },
    ]);

    const projectedCalls = [];
    const original = [{ filename: 'raw.txt', content: 'raw' }];
    Object.defineProperty(original, 'toJSON', { value: function (key) {
      projectedCalls.push({ key, receiver: this }); return selectedAttachments;
    } });
    const fromString = { ...request, notification: {
      ...selectedNotification, payload: { text: 'Selected from string', attachments: original },
    } };
    if (method === 'enqueue') await adapter.enqueue(fromString);
    else await adapter.enqueueMany([fromString]);
    await directWorker.handle(Object.assign(Object.create(EmailNotificationQueueJob.prototype), stored[1]));
    assert.deepEqual(directMessages.at(-1).attachments[1].content, new Uint8Array([0, 255, 42]));
    assert.deepEqual(projectedCalls, [{ key: 'attachments', receiver: original }]);

    const foreign = runInNewContext('new Uint8Array(new Uint8Array([99,0,255,42,88]).buffer,1,3)');
    assert.equal(foreign instanceof Uint8Array, false);
    for (const view of [selectedView, foreign]) {
      Object.defineProperties(view, {
        bytes: { value: [9], enumerable: true },
        byteLength: { value: 1, enumerable: true },
        length: { value: 1, enumerable: true },
        [Symbol.toStringTag]: { value: 'Uint16Array' },
      });
      const attachment = Object.freeze({ filename: 'native.bin', contentType: 'application/octet-stream', content: view });
      const nativeNotification = Object.freeze({
        channel: 'email', recipients: ['native@example.com'], payload: Object.freeze({ text: 'Native body', attachments: Object.freeze([attachment]) }),
      });
      const nativeRequest = { ...request, notification: nativeNotification };
      if (method === 'enqueue') await adapter.enqueue(nativeRequest);
      else await adapter.enqueueMany([nativeRequest]);
      await directWorker.handle(Object.assign(Object.create(EmailNotificationQueueJob.prototype), stored.at(-1)));
      const restoredContent = directMessages.at(-1).attachments[0].content;
      assert.ok(restoredContent instanceof Uint8Array);
      assert.equal(restoredContent.byteLength, 3);
      assert.deepEqual([restoredContent[0], restoredContent[1], restoredContent[2]], [0, 255, 42]);
      const projectionCalls = [];
      const projectedAttachment = Object.freeze({
        filename: 'raw.bin', content: new Uint8Array([9]),
        toJSON(key) { projectionCalls.push({ key, receiver: this }); return attachment; },
      });
      const projectedRequest = { ...request, notification: {
        ...nativeNotification, payload: { ...nativeNotification.payload, attachments: [projectedAttachment] },
      } };
      if (method === 'enqueue') await adapter.enqueue(projectedRequest);
      else await adapter.enqueueMany([projectedRequest]);
      await directWorker.handle(Object.assign(Object.create(EmailNotificationQueueJob.prototype), stored.at(-1)));
      assert.deepEqual(directMessages.at(-1).attachments[0], {
        filename: 'native.bin', contentType: 'application/octet-stream', content: new Uint8Array([0, 255, 42]),
      });
      assert.deepEqual(projectionCalls, [{ key: '0', receiver: projectedAttachment }]);
      assert.deepEqual(projectedAttachment.content, new Uint8Array([9]));
      await directWorker.handle({ notification: nativeNotification, queuedAt: request.queuedAt });
      assert.equal(directMessages.at(-1).attachments[0], attachment);
      assert.equal(directMessages.at(-1).attachments[0].content, view);
      assert.deepEqual(Array.from(Uint8Array.prototype.values.call(view)), [0, 255, 42]);
      assert.equal(view.byteOffset, 1);
      assert.equal(view.byteLength, 1);
      assert.deepEqual(view.bytes, [9]);
    }
    const beforeInvalid = directMessages.length;
    for (const invalid of [
      { 0: 0, 1: 255, 2: 42, byteLength: 3, [Symbol.toStringTag]: 'Uint8Array' },
      Object.defineProperty(new Uint8ClampedArray([0, 255, 42]), Symbol.toStringTag, { value: 'Uint8Array' }),
      Object.defineProperty(new Uint16Array([0, 255, 42]), Symbol.toStringTag, { value: 'Uint8Array' }),
      Object.defineProperty(new DataView(new ArrayBuffer(3)), Symbol.toStringTag, { value: 'Uint8Array' }),
    ]) {
      await assert.rejects(directWorker.handle({ notification: {
        ...selectedNotification, payload: { text: 'Invalid brand', attachments: [{ content: invalid }] },
      }, queuedAt: request.queuedAt }), EmailMessageValidationError);
    }
    assert.equal(directMessages.length, beforeInvalid);
  }
});
