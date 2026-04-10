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
});
