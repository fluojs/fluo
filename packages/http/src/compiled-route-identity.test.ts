import { defineControllerMetadata, defineRouteMetadata } from '@fluojs/core/internal';
import { describe, expect, it } from 'vitest';

import { getCompiledRouteIdentity } from './compiled-route-identity.js';
import { createHandlerMapping } from './mapping.js';
import type { HandlerDescriptor } from './types.js';

function createEquivalentController(): HandlerDescriptor['controllerToken'] {
  class SharedController {
    action() {
      return 'shared';
    }
  }

  defineControllerMetadata(SharedController, { basePath: '' });
  defineRouteMetadata(SharedController.prototype, 'action', {
    method: 'GET',
    path: '/shared',
  });

  return SharedController;
}

function compileHandler(
  controllerToken: HandlerDescriptor['controllerToken'],
  withPrecedingSource: boolean,
): HandlerDescriptor {
  class PrecedingController {}

  const sources = withPrecedingSource
    ? [{ controllerToken: PrecedingController }, { controllerToken }]
    : [{ controllerToken }];
  const handler = createHandlerMapping(sources).descriptors[0];

  if (!handler) {
    throw new TypeError('Expected the route compiler to produce one handler descriptor.');
  }

  return handler;
}

describe('compiled route identity', () => {
  it('distinguishes same-source handlers at different compiler positions', () => {
    // Given
    const firstHandler = compileHandler(createEquivalentController(), true);
    const secondHandler = compileHandler(createEquivalentController(), false);

    // When
    const firstIdentity = getCompiledRouteIdentity(firstHandler);
    const secondIdentity = getCompiledRouteIdentity(secondHandler);

    // Then
    expect(Function.prototype.toString.call(firstHandler.controllerToken)).toBe(
      Function.prototype.toString.call(secondHandler.controllerToken),
    );
    expect(firstHandler.controllerToken.name).toBe(secondHandler.controllerToken.name);
    expect(firstHandler.methodName).toBe(secondHandler.methodName);
    expect(firstHandler.route).toEqual(secondHandler.route);
    expect(firstIdentity).not.toBe(secondIdentity);
  });

  it('keeps compiler identities deterministic for equivalent artifact layouts', () => {
    // Given
    const firstHandler = compileHandler(createEquivalentController(), true);
    const secondHandler = compileHandler(createEquivalentController(), true);

    // When
    const identities = [
      getCompiledRouteIdentity(firstHandler),
      getCompiledRouteIdentity(secondHandler),
    ];

    // Then
    expect(identities[0]).toBe(identities[1]);
  });
});
