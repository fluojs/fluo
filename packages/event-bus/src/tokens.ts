import type { Token } from '@fluojs/core';

import type { EventBusModuleOptions } from './types.js';

/** Injection token for event-bus module defaults and optional transport wiring. */
export const EVENT_BUS_OPTIONS: Token<EventBusModuleOptions> = Symbol.for('fluo.event-bus.options');
