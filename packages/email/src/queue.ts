import { Inject } from '@fluojs/core';
import type { NotificationsQueueAdapter, NotificationsQueueJob } from '@fluojs/notifications';
import { QueueWorker, type Queue, type QueueWorkerOptions } from '@fluojs/queue';

import { DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS } from './constants.js';
import { EmailChannel } from './channel.js';
import { EmailMessageValidationError } from './errors.js';
import type { EmailNotificationDispatchRequest } from './types.js';

/** Queue worker execution defaults used by the built-in notifications queue integration. */
export type EmailQueueWorkerOptions = QueueWorkerOptions;

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
  ) {}
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
 *   inject: [EMAIL_CHANNEL, QueueLifecycleService],
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
   * @throws {EmailMessageValidationError} When the queued notification targets another configured channel.
   */
  async handle(job: EmailNotificationQueueJob): Promise<void> {
    const expectedChannel = this.channel.channel;

    if (job.notification.channel !== expectedChannel) {
      throw new EmailMessageValidationError(
        `Queued notification channel "${job.notification.channel}" does not match configured email channel "${expectedChannel}".`,
      );
    }

    await this.channel.send(job.notification, {});
  }
}
