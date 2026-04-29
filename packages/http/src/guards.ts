import type { Token } from '@fluojs/core';

import { ForbiddenException } from './exceptions.js';
import type { Guard, GuardContext, GuardLike, RequestContext } from './types.js';

function isGuard(value: GuardLike): value is Guard {
  return typeof value === 'object' && value !== null && 'canActivate' in value;
}

async function resolveGuard(definition: GuardLike, requestContext: RequestContext): Promise<Guard> {
  if (isGuard(definition)) {
    return definition;
  }

  return requestContext.container.resolve(definition as Token<Guard>);
}

/**
 * Run guard chain.
 *
 * @param definitions The definitions.
 * @param context The context.
 * @returns The run guard chain result.
 */
export async function runGuardChain(definitions: GuardLike[], context: GuardContext): Promise<void> {
  if (definitions.length === 0) {
    return;
  }

  for (const definition of definitions) {
    const guard = await resolveGuard(definition, context.requestContext);
    const result = await guard.canActivate(context);

    if (result === false) {
      throw new ForbiddenException('Access denied.');
    }
  }
}
