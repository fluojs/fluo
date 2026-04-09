import type { Token } from '@konekti/core';

import type { Queue, NormalizedQueueModuleOptions } from './types.js';

/** Compatibility injection token for the queue facade returned by {@link QueueModule.forRoot}. */
export const QUEUE: Token<Queue> = Symbol.for('konekti.queue');
/** Injection token for normalized module defaults consumed by {@link QueueLifecycleService}. */
export const QUEUE_OPTIONS: Token<NormalizedQueueModuleOptions> = Symbol.for('konekti.queue.options');
