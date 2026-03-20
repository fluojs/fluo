import type { Token } from '@konekti/core';

import type { EventBus, EventBusModuleOptions } from './types.js';

export const EVENT_BUS: Token<EventBus> = Symbol.for('konekti.event-bus');
export const EVENT_BUS_OPTIONS: Token<EventBusModuleOptions> = Symbol.for('konekti.event-bus.options');
