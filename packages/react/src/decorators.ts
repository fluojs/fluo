import type { MetadataPropertyKey } from '@fluojs/core';
import { getStandardMetadataBag } from '@fluojs/core/internal';
import { Controller, Get } from '@fluojs/http';

type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type LegacyClassDecoratorFn = (target: Function) => void;
type LegacyMethodDecoratorFn = (target: object, propertyKey: MetadataPropertyKey, descriptor?: PropertyDescriptor) => void;
type ClassDecoratorLike = StandardClassDecoratorFn & LegacyClassDecoratorFn;
type MethodDecoratorLike = StandardMethodDecoratorFn & LegacyMethodDecoratorFn;

const reactRouterMetadataKey = Symbol.for('fluo.react.router');
const reactPathMetadataKey = Symbol.for('fluo.react.path');

const legacyRouterMetadataStore = new WeakMap<Function, ReactRouterMetadata>();
const legacyPathMetadataStore = new WeakMap<object, Map<MetadataPropertyKey, ReactPathMetadata>>();

/**
 * Additional render-facing metadata stored by `@Path(...)` for the future React renderer.
 *
 * @remarks
 * These options are intentionally runtime-neutral. They are recorded for diagnostics and
 * later rendering integration without changing HTTP route matching or request dispatch.
 */
export type ReactPathOptions = Readonly<Record<string, unknown>>;

/**
 * React router marker metadata written by `@Router(...)`.
 */
export type ReactRouterMetadata = {
  /** Marker that distinguishes React routers from plain HTTP controllers. */
  readonly kind: 'router';
  /** Base path also written to the HTTP controller metadata. */
  readonly basePath: string;
};

/**
 * React render metadata written by `@Path(...)`.
 */
export type ReactPathMetadata = {
  /** Marker that distinguishes React page handlers from plain HTTP routes. */
  readonly kind: 'path';
  /** Route path also written to the HTTP `GET` metadata. */
  readonly path: string;
  /** Optional render-facing metadata for the future React rendering layer. */
  readonly options?: ReactPathOptions;
};

function isStandardDecoratorContext(value: unknown): value is ClassDecoratorContext | ClassMethodDecoratorContext {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') !== undefined;
}

function isStandardClassDecoratorContext(value: unknown): value is ClassDecoratorContext {
  return isStandardDecoratorContext(value) && Reflect.get(value, 'kind') === 'class';
}

function isStandardMethodDecoratorContext(value: unknown): value is ClassMethodDecoratorContext {
  return isStandardDecoratorContext(value) && Reflect.get(value, 'kind') === 'method';
}

function isMetadataPropertyKey(value: unknown): value is MetadataPropertyKey {
  return typeof value === 'string' || typeof value === 'symbol';
}

function cloneReactPathOptions(options: ReactPathOptions | undefined): ReactPathOptions | undefined {
  return options === undefined ? undefined : { ...options };
}

function createReactRouterMetadata(basePath: string): ReactRouterMetadata {
  return {
    basePath,
    kind: 'router',
  };
}

function createReactPathMetadata(path: string, options: ReactPathOptions | undefined): ReactPathMetadata {
  const clonedOptions = cloneReactPathOptions(options);

  if (clonedOptions === undefined) {
    return {
      kind: 'path',
      path,
    };
  }

  return {
    kind: 'path',
    options: clonedOptions,
    path,
  };
}

function cloneReactRouterMetadata(metadata: ReactRouterMetadata): ReactRouterMetadata {
  return createReactRouterMetadata(metadata.basePath);
}

function cloneReactPathMetadata(metadata: ReactPathMetadata): ReactPathMetadata {
  return createReactPathMetadata(metadata.path, metadata.options);
}

function getMetadataObject(metadata: unknown): object {
  return typeof metadata === 'object' && metadata !== null ? metadata : {};
}

function defineStandardReactRouterMetadata(metadata: unknown, value: ReactRouterMetadata): void {
  Reflect.set(getMetadataObject(metadata), reactRouterMetadataKey, cloneReactRouterMetadata(value));
}

function getStandardReactPathMap(metadata: unknown): Map<MetadataPropertyKey, ReactPathMetadata> {
  const bag = getMetadataObject(metadata);
  const current = Reflect.get(bag, reactPathMetadataKey);

  if (current instanceof Map) {
    return current;
  }

  const created = new Map<MetadataPropertyKey, ReactPathMetadata>();
  Reflect.set(bag, reactPathMetadataKey, created);
  return created;
}

function defineStandardReactPathMetadata(
  metadata: unknown,
  propertyKey: MetadataPropertyKey,
  value: ReactPathMetadata,
): void {
  getStandardReactPathMap(metadata).set(propertyKey, cloneReactPathMetadata(value));
}

function defineLegacyReactPathMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  value: ReactPathMetadata,
): void {
  let routeMap = legacyPathMetadataStore.get(target);

  if (!routeMap) {
    routeMap = new Map<MetadataPropertyKey, ReactPathMetadata>();
    legacyPathMetadataStore.set(target, routeMap);
  }

  routeMap.set(propertyKey, cloneReactPathMetadata(value));
}

function isReactRouterMetadata(value: unknown): value is ReactRouterMetadata {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, 'kind') === 'router'
    && typeof Reflect.get(value, 'basePath') === 'string';
}

function isReactPathOptions(value: unknown): value is ReactPathOptions {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReactPathMetadata(value: unknown): value is ReactPathMetadata {
  const options = typeof value === 'object' && value !== null ? Reflect.get(value, 'options') : undefined;

  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, 'kind') === 'path'
    && typeof Reflect.get(value, 'path') === 'string'
    && (options === undefined || isReactPathOptions(options));
}

function getStandardReactRouterMetadata(routerToken: Function): ReactRouterMetadata | undefined {
  const value = getStandardMetadataBag(routerToken)?.[reactRouterMetadataKey];

  return isReactRouterMetadata(value) ? value : undefined;
}

function getStandardReactPathMetadata(
  routerToken: Function,
  propertyKey: MetadataPropertyKey,
): ReactPathMetadata | undefined {
  const routeMap = getStandardMetadataBag(routerToken)?.[reactPathMetadataKey];

  if (!(routeMap instanceof Map)) {
    return undefined;
  }

  const value = routeMap.get(propertyKey);

  return isReactPathMetadata(value) ? value : undefined;
}

/**
 * Marks a class as a React router while writing equivalent HTTP controller metadata.
 *
 * @param basePath Base path shared by React page handlers declared on the class.
 * @returns A class decorator that writes HTTP controller metadata plus React router marker metadata.
 */
export function Router(basePath = ''): ClassDecoratorLike {
  const httpDecorator = Controller(basePath);
  const metadata = createReactRouterMetadata(basePath);

  const decorator = (target: Function, context?: ClassDecoratorContext): void => {
    Reflect.apply(httpDecorator, undefined, context === undefined ? [target] : [target, context]);

    if (isStandardClassDecoratorContext(context)) {
      defineStandardReactRouterMetadata(context.metadata, metadata);
      return;
    }

    legacyRouterMetadataStore.set(target, cloneReactRouterMetadata(metadata));
  };

  return decorator;
}

/**
 * Marks a method as a React page route while writing equivalent HTTP `GET` route metadata.
 *
 * @param path Route path relative to the containing `@Router(...)` base path.
 * @param options Optional render-facing metadata for the future React rendering layer.
 * @returns A method decorator that writes HTTP `GET` metadata plus React path metadata.
 */
export function Path(path: string, options?: ReactPathOptions): MethodDecoratorLike {
  const httpDecorator = Get(path);
  const metadata = createReactPathMetadata(path, options);

  const decorator = (
    valueOrTarget: Function | object,
    contextOrPropertyKey: ClassMethodDecoratorContext | MetadataPropertyKey,
    descriptor?: PropertyDescriptor,
  ): void => {
    Reflect.apply(httpDecorator, undefined, [valueOrTarget, contextOrPropertyKey, descriptor]);

    if (isStandardMethodDecoratorContext(contextOrPropertyKey)) {
      defineStandardReactPathMetadata(contextOrPropertyKey.metadata, contextOrPropertyKey.name, metadata);
      return;
    }

    if (isMetadataPropertyKey(contextOrPropertyKey)) {
      defineLegacyReactPathMetadata(valueOrTarget, contextOrPropertyKey, metadata);
    }
  };

  return decorator;
}

/**
 * Reads React router marker metadata from a router class.
 *
 * @param routerToken Router class decorated with `@Router(...)`.
 * @returns A defensive metadata snapshot, or `undefined` when the class is not a React router.
 */
export function getReactRouterMetadata(routerToken: Function): ReactRouterMetadata | undefined {
  const metadata = legacyRouterMetadataStore.get(routerToken) ?? getStandardReactRouterMetadata(routerToken);

  return metadata ? cloneReactRouterMetadata(metadata) : undefined;
}

/**
 * Reads React render metadata from a router method.
 *
 * @param routerToken Router class containing the decorated method.
 * @param propertyKey Method property key decorated with `@Path(...)`.
 * @returns A defensive metadata snapshot, or `undefined` when the method is not a React page route.
 */
export function getReactPathMetadata(
  routerToken: Function,
  propertyKey: MetadataPropertyKey,
): ReactPathMetadata | undefined {
  const metadata = legacyPathMetadataStore.get(routerToken.prototype)?.get(propertyKey)
    ?? getStandardReactPathMetadata(routerToken, propertyKey);

  return metadata ? cloneReactPathMetadata(metadata) : undefined;
}
