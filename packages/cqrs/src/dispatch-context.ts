import type { CqrsDispatchContext } from './types.js';

const cqrsDispatchContextStateBrand: unique symbol = Symbol('fluo.cqrs.dispatchContextState');

/** Internal marker for CQRS-created dispatch contexts. */
export interface InternalCqrsDispatchContext extends CqrsDispatchContext {
  readonly [cqrsDispatchContextStateBrand]: true;
}

/**
 * Marks an internal CQRS dispatch context so shutdown guards can distinguish nested work from external calls.
 *
 * @param state Runtime state that should travel with the opaque dispatch context.
 * @returns The same state shape with the internal CQRS context marker attached.
 */
export function createInternalCqrsDispatchContext<TState extends object>(state: TState): TState & InternalCqrsDispatchContext {
  return {
    ...state,
    [cqrsDispatchContextStateBrand]: true,
  };
}

/**
 * Checks whether a context value was created by CQRS internals.
 *
 * @param context Optional public dispatch context received from a handler or saga.
 * @returns `true` when the value carries the CQRS internal context marker.
 */
export function isInternalCqrsDispatchContext(context: CqrsDispatchContext | undefined): context is InternalCqrsDispatchContext {
  if (typeof context !== 'object' || context === null) {
    return false;
  }

  return (context as { readonly [cqrsDispatchContextStateBrand]?: unknown })[cqrsDispatchContextStateBrand] === true;
}
