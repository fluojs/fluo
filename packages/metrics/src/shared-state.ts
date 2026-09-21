const METRICS_SHARED_STATE = Symbol.for('fluo.metrics.shared-state');
const METRICS_SHARED_STATE_VERSION = 1;

type SharedMetricsState = {
  readonly values: Map<symbol, unknown>;
  readonly version: number;
};

let incompatibleState: SharedMetricsState | undefined;

/**
 * Retrieves versioned ownership state shared only by compatible metrics copies.
 *
 * Values in this registry retain their concrete Registry or collector owner as
 * the weak-map key; it never makes separate registries or applications global.
 *
 * @internal
 */
export function getCompatibleMetricsSharedState<T>(key: symbol, create: () => T): T {
  const state = resolveSharedMetricsState();

  if (state.values.has(key)) {
    return state.values.get(key) as T;
  }

  const value = create();
  state.values.set(key, value);
  return value;
}

function resolveSharedMetricsState(): SharedMetricsState {
  const existing = Reflect.get(globalThis, METRICS_SHARED_STATE);

  if (isCompatibleSharedMetricsState(existing)) {
    return existing;
  }

  if (existing === undefined) {
    const state = createSharedMetricsState();
    Reflect.defineProperty(globalThis, METRICS_SHARED_STATE, {
      configurable: true,
      value: state,
      writable: false,
    });
    return state;
  }

  incompatibleState ??= createSharedMetricsState();
  return incompatibleState;
}

function createSharedMetricsState(): SharedMetricsState {
  return Object.freeze({
    values: new Map<symbol, unknown>(),
    version: METRICS_SHARED_STATE_VERSION,
  });
}

function isCompatibleSharedMetricsState(value: unknown): value is SharedMetricsState {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, 'version') === METRICS_SHARED_STATE_VERSION
    && Reflect.get(value, 'values') instanceof Map;
}
