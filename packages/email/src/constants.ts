import type { EmailQueueWorkerOptions } from './types.js';

/** Stable queue job name used by the email notifications worker contract. */
export const EMAIL_QUEUE_JOB_NAME = 'konekti.email.notification';

/** Default worker options used by the built-in email notifications queue seam. */
export const DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS: Required<EmailQueueWorkerOptions> = Object.freeze({
  attempts: 3,
  backoff: {
    delayMs: 1_000,
    type: 'exponential' as const,
  },
  concurrency: 5,
  jobName: EMAIL_QUEUE_JOB_NAME,
  rateLimiter: {
    duration: 1_000,
    max: 50,
  },
});
