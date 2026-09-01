import type { HandlerDescriptor } from './types.js';

const COMPILED_ROUTE_IDENTITY_SYMBOL = Symbol.for('fluo.http.compiledRouteIdentity');

/**
 * Attach the deterministic compiler identity to a handler descriptor.
 *
 * @param descriptor Handler descriptor produced by route compilation.
 * @param identity Stable identity assigned to the compiled route.
 * @returns The descriptor with its non-writable compiler identity attached.
 */
export function attachCompiledRouteIdentity<Descriptor extends HandlerDescriptor>(
  descriptor: Descriptor,
  identity: string,
): Descriptor {
  Object.defineProperty(descriptor, COMPILED_ROUTE_IDENTITY_SYMBOL, {
    configurable: false,
    enumerable: true,
    value: identity,
    writable: false,
  });

  return descriptor;
}

/**
 * Read the deterministic identity assigned by the HTTP route compiler.
 *
 * @param descriptor Compiled handler descriptor produced by `createHandlerMapping(...)`.
 * @returns The compiler identity, or `undefined` for a manually authored descriptor.
 */
export function getCompiledRouteIdentity(descriptor: HandlerDescriptor): string | undefined {
  const identity: unknown = Reflect.get(descriptor, COMPILED_ROUTE_IDENTITY_SYMBOL);

  return typeof identity === 'string' ? identity : undefined;
}
