import type { Token } from '@konekti/core';

import type { Queue, NormalizedQueueModuleOptions } from './types.js';

export const QUEUE: Token<Queue> = Symbol.for('konekti.queue');
export const QUEUE_OPTIONS: Token<NormalizedQueueModuleOptions> = Symbol.for('konekti.queue.options');
