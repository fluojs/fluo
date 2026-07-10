import type { Token } from '@fluojs/core';

import type { CqrsDispatchContext, CqrsEventType } from './types.js';

/** One active saga route retained in private CQRS dispatch state. */
export interface CqrsDispatchRoute {
  readonly eventType: CqrsEventType;
  readonly token: Token;
}

/** Private saga topology state associated with an opaque dispatch context. */
export interface CqrsSagaTopologyState {
  readonly activeRoutes: readonly CqrsDispatchRoute[];
  readonly depth: number;
  readonly path: readonly string[];
}

/** Private state carried by an internally created dispatch context. */
export interface InternalCqrsDispatchContextState {
  readonly publishDrainToken: symbol | undefined;
  readonly sagaTopology: CqrsSagaTopologyState | undefined;
}

const internalContextStates = new WeakMap<CqrsDispatchContext, InternalCqrsDispatchContextState>();

function freezeSagaTopology(state: CqrsSagaTopologyState): CqrsSagaTopologyState {
  return Object.freeze({
    activeRoutes: Object.freeze(
      state.activeRoutes.map((route) => Object.freeze({ eventType: route.eventType, token: route.token })),
    ),
    depth: state.depth,
    path: Object.freeze([...state.path]),
  });
}

/**
 * Creates an opaque immutable dispatch context and retains its state in a private weak map.
 *
 * @param state Internal publish-drain and saga-topology state.
 * @returns A frozen fieldless context safe to pass through application handlers.
 */
export function createInternalCqrsDispatchContext(state: InternalCqrsDispatchContextState): CqrsDispatchContext {
  const context: CqrsDispatchContext = Object.freeze({});
  internalContextStates.set(
    context,
    Object.freeze({
      publishDrainToken: state.publishDrainToken,
      sagaTopology: state.sagaTopology ? freezeSagaTopology(state.sagaTopology) : undefined,
    }),
  );
  return context;
}

/**
 * Reads private state only for context values created by CQRS internals.
 *
 * @param context Optional public dispatch context received from a handler or saga.
 * @returns The immutable internal state, or `undefined` for caller-created values.
 */
export function getInternalCqrsDispatchContextState(
  context: CqrsDispatchContext | undefined,
): InternalCqrsDispatchContextState | undefined {
  return context ? internalContextStates.get(context) : undefined;
}
