import type { Token } from '@fluojs/core';

import type { EventBusWithResults } from './publish-result.js';
import type { EventBusModuleOptions } from './types.js';

/** Compatibility injection token for the best-effort and result-aware event bus facade. */
export const EVENT_BUS: Token<EventBusWithResults> = Symbol.for('fluo.event-bus');
/** Injection token for event-bus module defaults and optional transport wiring. */
export const EVENT_BUS_OPTIONS: Token<EventBusModuleOptions> = Symbol.for('fluo.event-bus.options');
