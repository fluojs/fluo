import type { Token } from '@konekti/core';

import type { NormalizedQueueModuleOptions } from './types.js';

export const QUEUE_OPTIONS: Token<NormalizedQueueModuleOptions> = Symbol.for('konekti.queue.options');
