import type { MetadataPropertyKey } from '@fluojs/core';
import { getOwnStandardConstructorMetadataBag } from '@fluojs/core/internal';

type StandardDecoratorContext = ClassDecoratorContext | ClassMethodDecoratorContext;

/** Class-or-method decorator shape used by React render policy declarations. */
export type ReactRenderPolicyDecorator = {
  (value: Function, context: ClassDecoratorContext): void;
  (value: Function, context: ClassMethodDecoratorContext): void;
  (target: Function): void;
  (target: object, propertyKey: MetadataPropertyKey, descriptor?: PropertyDescriptor): void;
};

/** Internal render policy record retained until bootstrap validation. */
export type ReactRenderPolicyRecord = {
  readonly kind: 'layout' | 'page-metadata' | 'suspense-fallback';
  readonly reference: unknown;
};

/** One class or method decoration site in a router inheritance chain. */
export type ReactRenderPolicySite =
  | {
      readonly kind: 'class';
      readonly owner: Function;
      readonly records: readonly ReactRenderPolicyRecord[];
    }
  | {
      readonly kind: 'method';
      readonly owner: Function;
      readonly propertyKey: MetadataPropertyKey;
      readonly records: readonly ReactRenderPolicyRecord[];
    };

type ReactRenderPolicyStore = {
  readonly classRecords: ReactRenderPolicyRecord[];
  readonly methodRecords: Map<MetadataPropertyKey, ReactRenderPolicyRecord[]>;
};

const reactRenderPolicyMetadataKey = Symbol.for('fluo.react.render-policy');
const legacyClassPolicyStore = new WeakMap<Function, ReactRenderPolicyRecord[]>();
const legacyMethodPolicyStore = new WeakMap<object, Map<MetadataPropertyKey, ReactRenderPolicyRecord[]>>();

function isStandardDecoratorContext(value: unknown): value is StandardDecoratorContext {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') !== undefined;
}

function isClassDecoratorContext(value: unknown): value is ClassDecoratorContext {
  return isStandardDecoratorContext(value) && value.kind === 'class';
}

function isMethodDecoratorContext(value: unknown): value is ClassMethodDecoratorContext {
  return isStandardDecoratorContext(value) && value.kind === 'method';
}

function isMetadataPropertyKey(value: unknown): value is MetadataPropertyKey {
  return typeof value === 'string' || typeof value === 'symbol';
}

function isRenderPolicyStore(value: unknown): value is ReactRenderPolicyStore {
  return typeof value === 'object'
    && value !== null
    && Array.isArray(Reflect.get(value, 'classRecords'))
    && Reflect.get(value, 'methodRecords') instanceof Map;
}

function getMetadataObject(metadata: unknown): object {
  return typeof metadata === 'object' && metadata !== null ? metadata : {};
}

function getStandardPolicyStoreForWrite(metadata: unknown): ReactRenderPolicyStore {
  const bag = getMetadataObject(metadata);
  const current = Object.hasOwn(bag, reactRenderPolicyMetadataKey)
    ? Reflect.get(bag, reactRenderPolicyMetadataKey)
    : undefined;

  if (isRenderPolicyStore(current)) {
    return current;
  }

  const created: ReactRenderPolicyStore = {
    classRecords: [],
    methodRecords: new Map(),
  };
  Reflect.set(bag, reactRenderPolicyMetadataKey, created);
  return created;
}

function appendMethodRecord(
  methodRecords: Map<MetadataPropertyKey, ReactRenderPolicyRecord[]>,
  propertyKey: MetadataPropertyKey,
  record: ReactRenderPolicyRecord,
): void {
  methodRecords.set(propertyKey, [...(methodRecords.get(propertyKey) ?? []), record]);
}

function getConstructorChain(routerToken: Function): readonly Function[] {
  const constructors: Function[] = [];
  let current: unknown = routerToken;

  while (typeof current === 'function' && current !== Function.prototype) {
    constructors.unshift(current);
    current = Object.getPrototypeOf(current);
  }

  return constructors;
}

function getOwnStandardPolicyStore(routerToken: Function): ReactRenderPolicyStore | undefined {
  const value = getOwnStandardConstructorMetadataBag(routerToken)?.[reactRenderPolicyMetadataKey];
  return isRenderPolicyStore(value) ? value : undefined;
}

function getOwnClassPolicyRecords(routerToken: Function): readonly ReactRenderPolicyRecord[] {
  return [
    ...(getOwnStandardPolicyStore(routerToken)?.classRecords ?? []),
    ...(legacyClassPolicyStore.get(routerToken) ?? []),
  ];
}

function getLegacyMethodRecords(
  routerToken: Function,
): Map<MetadataPropertyKey, ReactRenderPolicyRecord[]> | undefined {
  const prototype = Reflect.get(routerToken, 'prototype');
  return typeof prototype === 'object' && prototype !== null
    ? legacyMethodPolicyStore.get(prototype)
    : undefined;
}

/**
 * Creates a render policy decorator that records one component reference at a class or method site.
 *
 * @param kind Render policy kind being recorded.
 * @param reference Component reference retained for bootstrap validation and renderer consumption.
 * @returns A standard/legacy-compatible class-or-method decorator.
 */
export function createReactRenderPolicyDecorator(
  kind: ReactRenderPolicyRecord['kind'],
  reference: unknown,
): ReactRenderPolicyDecorator {
  const record: ReactRenderPolicyRecord = { kind, reference };
  const decorator: ReactRenderPolicyDecorator = (
    valueOrTarget: Function | object,
    contextOrPropertyKey?: StandardDecoratorContext | MetadataPropertyKey,
  ): void => {
    if (isClassDecoratorContext(contextOrPropertyKey)) {
      getStandardPolicyStoreForWrite(contextOrPropertyKey.metadata).classRecords.push(record);
      return;
    }

    if (isMethodDecoratorContext(contextOrPropertyKey)) {
      appendMethodRecord(
        getStandardPolicyStoreForWrite(contextOrPropertyKey.metadata).methodRecords,
        contextOrPropertyKey.name,
        record,
      );
      return;
    }

    if (typeof valueOrTarget === 'function' && contextOrPropertyKey === undefined) {
      legacyClassPolicyStore.set(valueOrTarget, [...(legacyClassPolicyStore.get(valueOrTarget) ?? []), record]);
      return;
    }

    if (isMetadataPropertyKey(contextOrPropertyKey)) {
      let methodRecords = legacyMethodPolicyStore.get(valueOrTarget);
      if (methodRecords === undefined) {
        methodRecords = new Map();
        legacyMethodPolicyStore.set(valueOrTarget, methodRecords);
      }
      appendMethodRecord(methodRecords, contextOrPropertyKey, record);
    }
  };

  return decorator;
}

/**
 * Collects own class and method policy sites across a router inheritance chain.
 *
 * @param routerToken Router constructor whose inherited policy declarations should be collected.
 * @returns Class sites followed by method sites, each ordered base-to-derived.
 */
export function getReactRenderPolicySites(routerToken: Function): readonly ReactRenderPolicySite[] {
  const constructors = getConstructorChain(routerToken);
  const classSites: ReactRenderPolicySite[] = [];
  const methodSites: ReactRenderPolicySite[] = [];

  for (const constructor of constructors) {
    const classRecords = getOwnClassPolicyRecords(constructor);
    if (classRecords.length > 0) {
      classSites.push({ kind: 'class', owner: constructor, records: classRecords });
    }

    const standardMethods = getOwnStandardPolicyStore(constructor)?.methodRecords;
    const legacyMethods = getLegacyMethodRecords(constructor);
    const propertyKeys = new Set([
      ...(standardMethods?.keys() ?? []),
      ...(legacyMethods?.keys() ?? []),
    ]);

    for (const propertyKey of propertyKeys) {
      methodSites.push({
        kind: 'method',
        owner: constructor,
        propertyKey,
        records: [
          ...(standardMethods?.get(propertyKey) ?? []),
          ...(legacyMethods?.get(propertyKey) ?? []),
        ],
      });
    }
  }

  return [...classSites, ...methodSites];
}
