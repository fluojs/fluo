const HTTP_SHARED_STATE = Symbol.for('fluo.http.shared-state');
const HTTP_SHARED_STATE_VERSION = 1;

type SharedHttpState = {
  readonly values: Map<symbol, unknown>;
  readonly version: number;
};

let incompatibleState: SharedHttpState | undefined;

/**
 * Returns versioned state shared only by compatible same-realm HTTP package copies.
 *
 * State is always keyed by its owning request or adapter object. Independent
 * requests and applications therefore retain their own state boundaries.
 *
 * @internal
 */
export function getCompatibleHttpSharedState<T>(key: symbol, create: () => T): T {
  const state = resolveSharedHttpState();

  if (state.values.has(key)) {
    return state.values.get(key) as T;
  }

  const value = create();
  state.values.set(key, value);
  return value;
}

function resolveSharedHttpState(): SharedHttpState {
  const existing = Reflect.get(globalThis, HTTP_SHARED_STATE);

  if (isCompatibleSharedHttpState(existing)) {
    return existing;
  }

  if (existing === undefined) {
    const state = createSharedHttpState();
    Reflect.defineProperty(globalThis, HTTP_SHARED_STATE, {
      configurable: true,
      value: state,
      writable: false,
    });
    return state;
  }

  incompatibleState ??= createSharedHttpState();
  return incompatibleState;
}

function createSharedHttpState(): SharedHttpState {
  return Object.freeze({
    values: new Map<symbol, unknown>(),
    version: HTTP_SHARED_STATE_VERSION,
  });
}

function isCompatibleSharedHttpState(value: unknown): value is SharedHttpState {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, 'version') === HTTP_SHARED_STATE_VERSION
    && Reflect.get(value, 'values') instanceof Map;
}
