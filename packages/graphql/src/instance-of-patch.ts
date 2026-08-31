/** Represents a GraphQL constructor inspected by the private `instanceOf` helper. */
export type GraphqlConstructor = Function & {
  readonly prototype: {
    readonly [Symbol.toStringTag]?: string;
  };
};

/** Represents the private GraphQL `instanceOf` helper signature. */
export type GraphqlInstanceOf = (value: unknown, constructor: GraphqlConstructor) => boolean;

/** Represents the mutable private GraphQL module object that owns the helper. */
export type GraphqlInstanceOfModule = {
  instanceOf: GraphqlInstanceOf;
};

interface GraphqlInstanceOfPatchState {
  readonly allowedObjectSets: Set<WeakSet<object>>;
  isEvaluatingDelegate: boolean;
  originalInstanceOf: GraphqlInstanceOf;
  readonly patchedInstanceOf: GraphqlInstanceOf;
}

interface GraphqlInstanceOfPatchStateRegistry {
  readonly states: WeakMap<GraphqlInstanceOfModule, GraphqlInstanceOfPatchState>;
}

const graphqlInstanceOfPatchStateRegistryKey = Symbol.for(
  '@fluojs/graphql.instance-of-patch-state-registry/v1',
);

function isGraphqlInstanceOfPatchStateRegistry(
  value: unknown,
): value is GraphqlInstanceOfPatchStateRegistry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Reflect.get(value, 'states') instanceof WeakMap;
}

function getGraphqlInstanceOfPatchStates(): WeakMap<
  GraphqlInstanceOfModule,
  GraphqlInstanceOfPatchState
> {
  const registeredValue: unknown = Reflect.get(globalThis, graphqlInstanceOfPatchStateRegistryKey);

  if (isGraphqlInstanceOfPatchStateRegistry(registeredValue)) {
    return registeredValue.states;
  }

  const registry: GraphqlInstanceOfPatchStateRegistry = {
    states: new WeakMap<GraphqlInstanceOfModule, GraphqlInstanceOfPatchState>(),
  };

  Object.defineProperty(globalThis, graphqlInstanceOfPatchStateRegistryKey, {
    configurable: false,
    enumerable: false,
    value: registry,
    writable: false,
  });

  return registry.states;
}

function createGraphqlInstanceOfPatchState(
  originalInstanceOf: GraphqlInstanceOf,
): GraphqlInstanceOfPatchState {
  let patchState: GraphqlInstanceOfPatchState;
  const allowedObjectSets = new Set<WeakSet<object>>();
  const patchedInstanceOf: GraphqlInstanceOf = (value, constructor) => {
    if (patchState.isEvaluatingDelegate) {
      return isAllowedCrossRealmGraphqlObject(value, constructor, allowedObjectSets);
    }

    patchState.isEvaluatingDelegate = true;

    try {
      try {
        if (patchState.originalInstanceOf(value, constructor)) {
          return true;
        }
      } catch (error) {
        if (isAllowedCrossRealmGraphqlObject(value, constructor, allowedObjectSets)) {
          return true;
        }

        throw error;
      }

      return isAllowedCrossRealmGraphqlObject(value, constructor, allowedObjectSets);
    } finally {
      patchState.isEvaluatingDelegate = false;
    }
  };

  patchState = {
    allowedObjectSets,
    isEvaluatingDelegate: false,
    originalInstanceOf,
    patchedInstanceOf,
  };

  return patchState;
}

function getCrossRealmGraphqlTag(value: unknown, constructor: GraphqlConstructor): string | undefined {
  const prototypeTag = constructor.prototype?.[Symbol.toStringTag];
  const className = typeof prototypeTag === 'string' ? prototypeTag : constructor.name;

  if (typeof className !== 'string' || !className.startsWith('GraphQL')) {
    return undefined;
  }

  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const valueTag = Reflect.get(value, Symbol.toStringTag);

  if (typeof valueTag === 'string') {
    return valueTag === className ? className : undefined;
  }

  const valueConstructor = Reflect.get(value, 'constructor');
  const valueClassName = (
    typeof valueConstructor === 'object' && valueConstructor !== null
  ) || typeof valueConstructor === 'function'
    ? Reflect.get(valueConstructor, 'name')
    : undefined;

  return typeof valueClassName === 'string' && valueClassName === className ? className : undefined;
}

function isAllowedCrossRealmGraphqlObject(
  value: unknown,
  constructor: GraphqlConstructor,
  allowedObjectSets: ReadonlySet<WeakSet<object>>,
): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  for (const allowedObjects of allowedObjectSets) {
    if (allowedObjects.has(value)) {
      return getCrossRealmGraphqlTag(value, constructor) !== undefined;
    }
  }

  return false;
}

/**
 * Installs and releases a cross-realm GraphQL `instanceOf` patch for one module object.
 *
 * @param instanceOfModule The GraphQL module object that owns the `instanceOf` helper.
 * @param allowedObjects The active application's cross-realm GraphQL object allowlist.
 * @returns A one-time release callback for the application's allowlist.
 */
export function installGraphqlInstanceOfPatch(
  instanceOfModule: GraphqlInstanceOfModule,
  allowedObjects: WeakSet<object>,
): () => void {
  const patchStates = getGraphqlInstanceOfPatchStates();
  let patchState = patchStates.get(instanceOfModule);

  if (patchState === undefined) {
    patchState = createGraphqlInstanceOfPatchState(instanceOfModule.instanceOf);
    patchStates.set(instanceOfModule, patchState);
  } else if (instanceOfModule.instanceOf !== patchState.patchedInstanceOf) {
    patchState.originalInstanceOf = instanceOfModule.instanceOf;
  }

  instanceOfModule.instanceOf = patchState.patchedInstanceOf;
  patchState.allowedObjectSets.add(allowedObjects);
  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;
    patchState.allowedObjectSets.delete(allowedObjects);

    if (patchState.allowedObjectSets.size > 0) {
      return;
    }

    if (instanceOfModule.instanceOf === patchState.patchedInstanceOf) {
      instanceOfModule.instanceOf = patchState.originalInstanceOf;
    }

    if (patchStates.get(instanceOfModule) === patchState) {
      patchStates.delete(instanceOfModule);
    }
  };
}
