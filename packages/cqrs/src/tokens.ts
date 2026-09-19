import type { Token } from '@fluojs/core';

/** Internal injection token for CQRS module options. */
export const CQRS_MODULE_OPTIONS: Token<unknown> = Symbol.for('fluo.cqrs.module-options');
