import type { Token } from '@fluojs/core';
import type { ModuleType } from '@fluojs/runtime';

import type { NormalizedQueueModuleOptions, Queue } from './types.js';

export interface QueueModuleContext {
  readonly moduleType: ModuleType;
}

/** Compatibility injection token for the queue facade returned by {@link QueueModule.forRoot}. */
export const QUEUE: Token<Queue> = Symbol.for('fluo.queue');
/** Injection token for normalized module defaults consumed by {@link QueueLifecycleService}. */
export const QUEUE_OPTIONS: Token<NormalizedQueueModuleOptions> = Symbol.for('fluo.queue.options');
export const QUEUE_MODULE_CONTEXT: Token<QueueModuleContext> = Symbol.for('fluo.queue.module-context');
