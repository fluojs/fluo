import type { Token } from '@konekti/core';

import type { EventBus } from './types.js';

export const EVENT_BUS: Token<EventBus> = Symbol.for('konekti.event-bus');
