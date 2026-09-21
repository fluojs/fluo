import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Token } from '@fluojs/core';
import { describe, expect, it } from 'vitest';

import * as queue from './index.js';

function getSymbolKey(token: Token): string | undefined {
  return typeof token === 'symbol' ? Symbol.keyFor(token) : undefined;
}

describe('@fluojs/queue root barrel public surface', () => {
  it('declares the patched BullMQ dependency floor', () => {
    const packageManifest = readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8');

    expect(packageManifest).toContain('"bullmq": "^5.81.1"');
  });

  it('matches the canonical Node platform engine boundary', () => {
    const queueManifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
    const nodePlatformManifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../platform-nodejs/package.json'), 'utf8'));

    expect(queueManifest.engines.node).toBe(nodePlatformManifest.engines.node);
  });

  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(queue).toHaveProperty('QueueModule');
    expect(queue).not.toHaveProperty('createQueueModule');
    expect(queue).not.toHaveProperty('createQueueProviders');
    expect(queue).toHaveProperty('QueueLifecycleService');
    expect(queue).toHaveProperty('QUEUE');
    expect(getSymbolKey(queue.QUEUE)).toBe('fluo.queue');
    expect(queue).toHaveProperty('getQueueToken');
    expect(queue).toHaveProperty('getQueueLifecycleServiceToken');
    expect(queue).toHaveProperty('QueueWorker');
    expect(queue).toHaveProperty('createQueuePlatformStatusSnapshot');
    expect(queue).not.toHaveProperty('QUEUE_OPTIONS');
    expect(Object.keys(queue).sort()).toMatchSnapshot();
  });

  it('keeps the README worker options aligned with the supported public contract', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');

    expect(readme).toContain('QueueWorkerOptions`: Per-job settings (attempts, backoff, concurrency, jobName, rate limiting).');
    expect(readme).toContain('defaultDeadLetterMaxEntries');
    expect(readme).not.toContain('QueueWorkerOptions`: Per-job settings (attempts, backoff, concurrency, priority).');
  });
});
