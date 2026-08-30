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
  originalInstanceOf: GraphqlInstanceOf;
  readonly patchedInstanceOf: GraphqlInstanceOf;
}

const graphqlInstanceOfPatchStates = new WeakMap<GraphqlInstanceOfModule, GraphqlInstanceOfPatchState>();

function createGraphqlInstanceOfPatchState(
  originalInstanceOf: GraphqlInstanceOf,
): GraphqlInstanceOfPatchState {
  let patchState: GraphqlInstanceOfPatchState;
  const allowedObjectSets = new Set<WeakSet<object>>();
  const patchedInstanceOf: GraphqlInstanceOf = (value, constructor) => {
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
  };

  patchState = {
    allowedObjectSets,
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
  let patchState = graphqlInstanceOfPatchStates.get(instanceOfModule);

  if (patchState === undefined) {
    patchState = createGraphqlInstanceOfPatchState(instanceOfModule.instanceOf);
    graphqlInstanceOfPatchStates.set(instanceOfModule, patchState);
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

    if (graphqlInstanceOfPatchStates.get(instanceOfModule) === patchState) {
      graphqlInstanceOfPatchStates.delete(instanceOfModule);
    }
  };
}
