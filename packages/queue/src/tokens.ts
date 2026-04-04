import type { Token } from '@konekti/core';

import type { Queue } from './types.js';

export const QUEUE: Token<Queue> = Symbol.for('konekti.queue');
