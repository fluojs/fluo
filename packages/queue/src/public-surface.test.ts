import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as queue from './index.js';

describe('@fluojs/queue root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(queue).toHaveProperty('QueueModule');
    expect(queue).not.toHaveProperty('createQueueModule');
    expect(queue).toHaveProperty('createQueueProviders');
    expect(queue).toHaveProperty('QueueLifecycleService');
    expect(queue).toHaveProperty('QUEUE');
    expect(queue).toHaveProperty('QueueWorker');
    expect(queue).toHaveProperty('createQueuePlatformStatusSnapshot');
    expect(queue).not.toHaveProperty('QUEUE_OPTIONS');
    expect(Object.keys(queue).sort()).toMatchSnapshot();
  });

  it('keeps the README worker options aligned with the supported public contract', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');

    expect(readme).toContain('QueueWorkerOptions`: Per-job settings (attempts, backoff, concurrency, jobName, rate limiting).');
    expect(readme).not.toContain('QueueWorkerOptions`: Per-job settings (attempts, backoff, concurrency, priority).');
  });
});
