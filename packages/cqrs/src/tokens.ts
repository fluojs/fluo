import type { Token } from '@konekti/core';

import type { CommandBus, CqrsEventBus, QueryBus } from './types.js';

export const COMMAND_BUS: Token<CommandBus> = Symbol.for('konekti.cqrs.command-bus');
export const QUERY_BUS: Token<QueryBus> = Symbol.for('konekti.cqrs.query-bus');
export const EVENT_BUS: Token<CqrsEventBus> = Symbol.for('konekti.cqrs.event-bus');
