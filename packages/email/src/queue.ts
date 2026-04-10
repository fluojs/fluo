import { Inject } from '@fluojs/core';
import type { NotificationsQueueAdapter, NotificationsQueueJob } from '@fluojs/notifications';
import { QueueLifecycleService, QueueWorker } from '@fluojs/queue';

import { DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS } from './constants.js';
import { EmailService } from './service.js';
import type { EmailNotificationDispatchRequest } from './types.js';

/** Serialized queue payload used by the built-in notifications queue adapter. */
export class EmailNotificationQueueJob {
  constructor(
    public readonly notification: EmailNotificationDispatchRequest,
    public readonly queuedAt: string,
  ) {}
}

/**
 * Creates a notifications queue adapter backed by {@link QueueLifecycleService}.
 *
 * @param queue Queue lifecycle service used to enqueue email notification jobs.
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
export function createEmailNotificationsQueueAdapter(queue: QueueLifecycleService): NotificationsQueueAdapter {
  return {
    enqueue(job: NotificationsQueueJob): Promise<string> {
      return queue.enqueue(new EmailNotificationQueueJob(job.notification as EmailNotificationDispatchRequest, job.queuedAt));
    },
    enqueueMany(jobs: readonly NotificationsQueueJob[]): Promise<readonly string[]> {
      return Promise.all(
        jobs.map((job) => queue.enqueue(new EmailNotificationQueueJob(job.notification as EmailNotificationDispatchRequest, job.queuedAt))),
      );
    },
  };
}

/** Internal queue worker that converts queued notification jobs back into email delivery. */
@QueueWorker(EmailNotificationQueueJob, DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS)
@Inject(EmailService)
export class EmailNotificationsQueueWorker {
  constructor(private readonly email: EmailService) {}

  async handle(job: EmailNotificationQueueJob): Promise<void> {
    await this.email.sendNotification(job.notification);
  }
}
