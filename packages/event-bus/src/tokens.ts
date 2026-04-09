import type { Token } from '@konekti/core';

import type { EventBus, EventBusModuleOptions } from './types.js';

/** Compatibility injection token for the event bus facade. */
export const EVENT_BUS: Token<EventBus> = Symbol.for('konekti.event-bus');
/** Injection token for event-bus module defaults and optional transport wiring. */
export const EVENT_BUS_OPTIONS: Token<EventBusModuleOptions> = Symbol.for('konekti.event-bus.options');
