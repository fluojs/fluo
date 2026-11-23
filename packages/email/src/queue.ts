import { Inject } from '@fluojs/core';
import type { NotificationsQueueAdapter, NotificationsQueueJob } from '@fluojs/notifications';
import { QueueWorker, type Queue } from '@fluojs/queue';

import { DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS } from './constants.js';
import { EmailChannel } from './channel.js';
import { EmailMessageValidationError } from './errors.js';
import type { EmailAttachment, EmailNotificationDispatchRequest } from './types.js';

type EmailQueueJsonSlot = 'notification' | 'payload' | 'attachments' | 'attachment';

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);

function isNativeUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Reflect.get(typedArrayPrototype, Symbol.toStringTag, value) === 'Uint8Array';
}

function createEmailQueueJsonValue(value: unknown, slot: EmailQueueJsonSlot): object {
  return {
    toJSON(key: string): unknown {
      let projected = value;
      let hasProjection = false;
      if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
        const toJSON: unknown = Reflect.get(value, 'toJSON', value);
        if (typeof toJSON === 'function') {
          hasProjection = true;
          projected = Reflect.apply(toJSON, value, [key]);
        }
      }
      if (projected === null || typeof projected !== 'object') return projected;
      if (slot === 'attachments') {
        if (!Array.isArray(projected)) return projected;
        const entries: readonly unknown[] = projected;
        const length = entries.length;
        const result: unknown[] = [];
        result.length = length;
        for (let index = 0; index < length; index++) {
          Object.defineProperty(result, index, {
            enumerable: true,
            get: () => createEmailQueueJsonValue(entries[index], 'attachment'),
          });
        }
        return result;
      }
      if (Array.isArray(projected)) return projected;
      const object = projected;
      const keys = Object.keys(object);
      const selectedKeys = new Set(keys);
      let nativeContent = false;
      if (slot === 'attachment' && !hasProjection) {
        for (const field of ['content', 'filename', 'contentType']) {
          if (!selectedKeys.has(field)) keys.push(field);
        }
      }
      // Preserve traversal order and the original receiver without projecting opaque values.
      const result: Record<string, unknown> = {};
      for (const property of keys) {
        Object.defineProperty(result, property, {
          enumerable: true,
          get: () => {
            if (slot === 'attachment' && property !== 'content' && !selectedKeys.has(property) && !nativeContent) return undefined;
            const child: unknown = Reflect.get(object, property, object);
            if (slot === 'attachment' && property === 'content') {
              if (isNativeUint8Array(child)) {
                nativeContent = true;
                const length: number = Reflect.get(typedArrayPrototype, 'length', child);
                const bytes: number[] = [];
                for (let index = 0; index < length; index++) bytes.push(child[index]);
                return { bytes };
              }
              return selectedKeys.has(property) ? child : undefined;
            }
            if (slot === 'notification' && property === 'payload') return createEmailQueueJsonValue(child, 'payload');
            if (slot === 'payload' && property === 'attachments') return createEmailQueueJsonValue(child, 'attachments');
            return child;
          },
        });
      }
      return result;
    },
  };
}

/** Serialized queue payload used by the built-in notifications queue adapter. */
export class EmailNotificationQueueJob {
  /**
   * Creates one queued email notification job payload.
   *
   * @param notification Notification envelope that will be delivered by the email channel worker.
   * @param queuedAt ISO timestamp captured when the notifications foundation delegated the job.
   * @param id Deterministic notification identity preserved for queue deduplication.
   */
  constructor(
    public readonly notification: EmailNotificationDispatchRequest,
    public readonly queuedAt: string,
    public readonly id?: string,
  ) {
    // Keep the JSON hook out of the public structural job type.
    Object.defineProperty(this, 'toJSON', {
      value: (): { notification: unknown; queuedAt: string; id?: string } => {
        return {
          notification: createEmailQueueJsonValue(this.notification, 'notification'),
          queuedAt: this.queuedAt,
          id: this.id,
        };
      },
    });
  }
}

/**
 * Creates a notifications queue adapter backed by the public {@link Queue} facade.
 *
 * @param queue Queue facade used to enqueue email notification jobs.
 * @returns A queue adapter compatible with `NotificationsModule.forRoot(...)` queue wiring.
 *
 * @example
 * ```ts
 * NotificationsModule.forRootAsync({
 *   inject: [EMAIL_CHANNEL, getQueueToken()],
 *   useFactory: (channel, queue) => ({
 *     channels: [channel],
 *     queue: {
 *       adapter: createEmailNotificationsQueueAdapter(queue),
 *       bulkThreshold: 25,
 *     },
 *   }),
 * });
 * ```
 */
export function createEmailNotificationsQueueAdapter(queue: Queue): NotificationsQueueAdapter {
  return {
    enqueue(job: NotificationsQueueJob): Promise<string> {
      return queue.enqueue(new EmailNotificationQueueJob(job.notification, job.queuedAt, job.id), {
        deduplicationKey: job.id,
      });
    },
    enqueueMany(jobs: readonly NotificationsQueueJob[]): Promise<readonly string[]> {
      return queue.enqueueMany(
        jobs.map((job) => ({
          job: new EmailNotificationQueueJob(job.notification, job.queuedAt, job.id),
          options: {
            deduplicationKey: job.id,
          },
        })),
      );
    },
  };
}

/** Queue worker that converts queued notification jobs back into email delivery. */
@QueueWorker(EmailNotificationQueueJob, DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS)
@Inject(EmailChannel)
export class EmailNotificationsQueueWorker {
  constructor(private readonly channel: EmailChannel) {}

  /**
   * Delivers one queued email notification through the same channel semantics as direct dispatch.
   *
   * @param job Queued notification payload created by `createEmailNotificationsQueueAdapter(...)`.
   * @returns A promise that resolves only when email delivery is accepted by the channel contract.
   * @throws {EmailMessageValidationError} When the queued notification targets another configured channel or contains invalid attachment bytes.
   */
  async handle(job: EmailNotificationQueueJob): Promise<void> {
    const expectedChannel = this.channel.channel;

    if (job.notification.channel !== expectedChannel) {
      throw new EmailMessageValidationError(
        `Queued notification channel "${job.notification.channel}" does not match configured email channel "${expectedChannel}".`,
      );
    }

    const notification = job.notification;
    const attachments = notification.payload.attachments;
    let decodedAttachments: EmailAttachment[] | undefined;
    if (attachments) {
      for (let attachmentIndex = 0; attachmentIndex < attachments.length; attachmentIndex++) {
        const attachment = attachments[attachmentIndex];
        const content: unknown = attachment.content;
        if (typeof content === 'string' || isNativeUint8Array(content)) {
          continue;
        }
        if (
          typeof content !== 'object' || content === null || Array.isArray(content)
          || !('bytes' in content) || !Object.hasOwn(content, 'bytes')
          || Object.keys(content).length !== 1 || !Array.isArray(content.bytes)
        ) {
          throw new EmailMessageValidationError('Queued email attachment content is not a supported byte payload.');
        }
        const bytes: readonly unknown[] = content.bytes;
        const restored = new Uint8Array(bytes.length);
        for (let index = 0; index < bytes.length; index++) {
          const byte = bytes[index];
          if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
            throw new EmailMessageValidationError('Queued email attachment bytes must be integers between 0 and 255.');
          }
          restored[index] = byte;
        }
        decodedAttachments ??= attachments.slice();
        decodedAttachments[attachmentIndex] = { ...attachment, content: restored };
      }
    }
    await this.channel.send(
      decodedAttachments
        ? { ...notification, payload: { ...notification.payload, attachments: decodedAttachments } }
        : job.notification,
      {},
    );
  }
}
