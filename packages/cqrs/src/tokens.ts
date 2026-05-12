import type { Token } from '@fluojs/core';

import type { CommandBus, CqrsEventBus, QueryBus } from './types.js';

/** Compatibility injection token for the command bus facade. */
export const COMMAND_BUS: Token<CommandBus> = Symbol.for('fluo.cqrs.command-bus');
/** Compatibility injection token for the query bus facade. */
export const QUERY_BUS: Token<QueryBus> = Symbol.for('fluo.cqrs.query-bus');
/** Compatibility injection token for the CQRS event bus facade. */
export const EVENT_BUS: Token<CqrsEventBus> = Symbol.for('fluo.cqrs.event-bus');
/** Internal injection token for CQRS module options. */
export const CQRS_MODULE_OPTIONS: Token<unknown> = Symbol.for('fluo.cqrs.module-options');
