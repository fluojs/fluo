import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as queue from './index.js';

describe('@fluojs/queue root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(queue).toHaveProperty('QueueModule');
    expect(queue).not.toHaveProperty('createQueueModule');
    expect(queue).not.toHaveProperty('createQueueProviders');
    expect(queue).toHaveProperty('QueueLifecycleService');
    expect(queue).toHaveProperty('QUEUE');
    expect(queue).toHaveProperty('QueueWorker');
    expect(queue).toHaveProperty('createQueuePlatformStatusSnapshot');
    expect(queue).not.toHaveProperty('QUEUE_OPTIONS');
    expect(Object.keys(queue).sort()).toMatchSnapshot();
  });

  it('keeps the README helper and module entrypoints aligned with the supported public contract', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(import.meta.dirname, '../README.ko.md'), 'utf8');

    expect(readme).toContain('`QueueModule.forRoot(...)` is the supported root entrypoint for queue registration.');
    expect(readme).toContain('low-level provider assembly as an internal implementation detail');
    expect(readme).toContain('low-level provider helpers are not part of the documented root-barrel contract.');
    expect(koreanReadme).toContain('`QueueModule.forRoot(...)`는 큐 등록을 위한 지원되는 루트 엔트리포인트입니다.');
    expect(koreanReadme).toContain('저수준 provider 조합을 루트 barrel API의 일부가 아니라 내부 구현 세부사항으로 취급해야 합니다.');
    expect(koreanReadme).toContain('저수준 provider helper는 문서화된 루트 barrel 계약에 포함되지 않습니다.');
  });

  it('keeps the README worker options aligned with the supported public contract', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');

    expect(readme).toContain('QueueWorkerOptions`: Per-job settings (attempts, backoff, concurrency, jobName, rate limiting).');
    expect(readme).toContain('defaultDeadLetterMaxEntries');
    expect(readme).not.toContain('QueueWorkerOptions`: Per-job settings (attempts, backoff, concurrency, priority).');
  });
});
