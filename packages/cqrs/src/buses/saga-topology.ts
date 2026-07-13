import {
  createInternalCqrsDispatchContext,
  getInternalCqrsDispatchContextState,
} from '../dispatch-context.js';
import { SagaTopologyError } from '../errors.js';
import type { CqrsDispatchContext, SagaDescriptor } from '../types.js';

const MAX_NESTED_SAGA_DEPTH = 32;

/** Result of entering one guarded saga route. */
export interface SagaTopologyEntry {
  readonly context: CqrsDispatchContext;
  readonly reentrantToken: boolean;
}

/**
 * Validates and enters one saga route using private immutable context state.
 *
 * @param context Opaque context passed through the active CQRS pipeline.
 * @param descriptor Saga route selected for the current event.
 * @returns The next opaque context and whether the same provider token is already active.
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

  return {
    context: createInternalCqrsDispatchContext({
      publishDrainToken: internalState?.publishDrainToken,
      sagaTopology: {
        activeRoutes: [...(activeTopology?.activeRoutes ?? []), { eventType: descriptor.eventType, token: descriptor.token }],
        depth: (activeTopology?.depth ?? 0) + 1,
        path: [...(activeTopology?.path ?? []), routeLabel],
      },
    }),
    reentrantToken: activeTopology?.activeRoutes.some((route) => route.token === descriptor.token) ?? false,
  };
}
