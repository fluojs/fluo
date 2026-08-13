import {
  createInternalCqrsDispatchContext,
  getInternalCqrsDispatchContextState,
} from '../dispatch-context.js';
import { SagaTopologyError } from '../errors.js';
import type { CqrsDispatchContext, SagaDescriptor } from '../types.js';
import type { SagaContinuationScope } from './saga-continuation.js';

const MAX_NESTED_SAGA_DEPTH = 32;

/** Result of entering one guarded saga route. */
export interface SagaTopologyEntry {
  readonly continuationScope: SagaContinuationScope;
  readonly context: CqrsDispatchContext;
  readonly ownsContinuationScope: boolean;
  readonly reentrantToken: boolean;
}

/**
 * Validates and enters one saga route using private immutable context state.
 *
 * @param context Opaque context passed through the active CQRS pipeline.
 * @param descriptor Saga route selected for the current event.
 * @returns The next opaque context.
 */
export function enterSagaTopology(
  context: CqrsDispatchContext | undefined,
  descriptor: SagaDescriptor,
): SagaTopologyEntry {
  const internalState = getInternalCqrsDispatchContextState(context);
  const activeTopology = internalState?.sagaTopology;
  const routeLabel = `${descriptor.targetType.name}(${descriptor.eventType.name})`;
  const reenteredRoute = activeTopology?.activeRoutes.some(
    (route) => route.token === descriptor.token && route.eventType === descriptor.eventType,
  );
  const reentrantToken = activeTopology?.activeRoutes.some((route) => route.token === descriptor.token) ?? false;

  if (reenteredRoute) {
    throw new SagaTopologyError(
      `Saga ${descriptor.targetType.name} re-entered an unsafe cycle while handling ${descriptor.eventType.name}. `
        + `Active saga path: ${[...(activeTopology?.path ?? []), routeLabel].join(' -> ')}.`,
    );
  }

  if ((activeTopology?.depth ?? 0) >= MAX_NESTED_SAGA_DEPTH) {
    throw new SagaTopologyError(
      `Saga ${descriptor.targetType.name} exceeded the maximum nested saga depth of ${MAX_NESTED_SAGA_DEPTH} while handling ${descriptor.eventType.name}. `
        + 'Keep in-process saga graphs acyclic and externally bounded.',
    );
  }

  const continuationScope = internalState?.sagaContinuationScope ?? { queue: [] };

  return {
    continuationScope,
    context: createInternalCqrsDispatchContext({
      publishDrainToken: internalState?.publishDrainToken,
      sagaContinuationScope: continuationScope,
      sagaTopology: {
        activeRoutes: [...(activeTopology?.activeRoutes ?? []), { eventType: descriptor.eventType, token: descriptor.token }],
        depth: (activeTopology?.depth ?? 0) + 1,
        path: [...(activeTopology?.path ?? []), routeLabel],
      },
    }),
    ownsContinuationScope: internalState?.sagaContinuationScope === undefined,
    reentrantToken,
  };
}
