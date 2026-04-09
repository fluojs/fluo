import type { Token } from '@konekti/core';

import type { CommandBus, CqrsEventBus, QueryBus } from './types.js';

/** Compatibility injection token for the command bus facade. */
export const COMMAND_BUS: Token<CommandBus> = Symbol.for('konekti.cqrs.command-bus');
/** Compatibility injection token for the query bus facade. */
export const QUERY_BUS: Token<QueryBus> = Symbol.for('konekti.cqrs.query-bus');
/** Compatibility injection token for the CQRS event bus facade. */
export const EVENT_BUS: Token<CqrsEventBus> = Symbol.for('konekti.cqrs.event-bus');
