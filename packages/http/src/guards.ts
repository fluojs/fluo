import type { Token } from '@konekti/core';

import { ForbiddenException } from './exceptions';
import type { Guard, GuardContext, GuardLike, RequestContext } from './types';

function isGuard(value: GuardLike): value is Guard {
  return typeof value === 'object' && value !== null && 'canActivate' in value;
}

async function resolveGuard(definition: GuardLike, requestContext: RequestContext): Promise<Guard> {
  if (isGuard(definition)) {
    return definition;
  }

  return requestContext.container.resolve(definition as Token<Guard>);
}

export async function runGuardChain(definitions: GuardLike[], context: GuardContext): Promise<void> {
  for (const definition of definitions) {
    const guard = await resolveGuard(definition, context.requestContext);
    const result = await guard.canActivate(context);

    if (result === false) {
      throw new ForbiddenException('Access denied.');
    }
  }
}
