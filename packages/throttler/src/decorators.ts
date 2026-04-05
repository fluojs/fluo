import type { ThrottlerHandlerOptions } from './types.js';
import { validateThrottleOptions } from './validation.js';

/** Shared controller metadata key used to store per-route throttling metadata records. */
export const throttleRouteMetadataKey = Symbol.for('konekti.standard.route');
const throttleKey = Symbol.for('konekti.throttler.throttle');
const skipThrottleKey = Symbol.for('konekti.throttler.skip');
const classThrottleKey = Symbol.for('konekti.throttler.class-throttle');
const classSkipThrottleKey = Symbol.for('konekti.throttler.class-skip');

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type ClassOrMethodDecoratorLike = StandardClassDecoratorFn & StandardMethodDecoratorFn;

function getMetadataBag(metadata: unknown): StandardMetadataBag {
  return metadata as StandardMetadataBag;
}

function cloneThrottleOptions(options: ThrottlerHandlerOptions): ThrottlerHandlerOptions {
  return validateThrottleOptions({
    limit: options.limit,
    ttl: options.ttl,
  });
}

function getRouteRecord(metadata: unknown, name: string | symbol): StandardMetadataBag {
  const bag = getMetadataBag(metadata);
  let routeMap = bag[throttleRouteMetadataKey] as Map<string | symbol, StandardMetadataBag> | undefined;

  if (!routeMap) {
    routeMap = new Map<string | symbol, StandardMetadataBag>();
    bag[throttleRouteMetadataKey] = routeMap;
  }

  let record = routeMap.get(name);

  if (!record) {
    record = {};
    routeMap.set(name, record);
  }

  return record;
}

/**
 * Override throttling policy for a controller class or handler method.
 *
 * @param options Rate-limit window and request cap for the decorated target.
 * @returns A decorator that stores throttling metadata on the class or method.
 */
export function Throttle(options: ThrottlerHandlerOptions): ClassOrMethodDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    if (context.kind === 'class') {
      getMetadataBag(context.metadata)[classThrottleKey] = cloneThrottleOptions(options);
    } else {
      getRouteRecord(context.metadata, context.name)[throttleKey] = cloneThrottleOptions(options);
    }
  };

  return decorator as ClassOrMethodDecoratorLike;
}

/**
 * Disable throttling for a controller class or handler method.
 *
 * @returns A decorator that marks the target as exempt from `ThrottlerGuard`.
 */
export function SkipThrottle(): ClassOrMethodDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext | ClassMethodDecoratorContext) => {
    if (context.kind === 'class') {
      getMetadataBag(context.metadata)[classSkipThrottleKey] = true;
    } else {
      getRouteRecord(context.metadata, context.name)[skipThrottleKey] = true;
    }
  };

  return decorator as ClassOrMethodDecoratorLike;
}

/**
 * Read method-level throttle metadata from a metadata bag.
 *
 * @param bag Route-level metadata bag captured from the controller.
 * @returns A defensive copy of the stored throttle options, if present.
 */
export function getThrottleMetadata(bag: StandardMetadataBag): ThrottlerHandlerOptions | undefined {
  const metadata = bag[throttleKey] as ThrottlerHandlerOptions | undefined;
  return metadata ? cloneThrottleOptions(metadata) : undefined;
}

/**
 * Read method-level skip metadata from a metadata bag.
 *
 * @param bag Route-level metadata bag captured from the controller.
 * @returns `true` when throttling should be skipped for the handler.
 */
export function getSkipThrottleMetadata(bag: StandardMetadataBag): boolean {
  return bag[skipThrottleKey] === true;
}

/**
 * Read class-level throttle metadata from a metadata bag.
 *
 * @param bag Controller metadata bag.
 * @returns A defensive copy of the stored throttle options, if present.
 */
export function getClassThrottleMetadata(bag: StandardMetadataBag): ThrottlerHandlerOptions | undefined {
  const metadata = bag[classThrottleKey] as ThrottlerHandlerOptions | undefined;
  return metadata ? cloneThrottleOptions(metadata) : undefined;
}

/**
 * Read class-level skip metadata from a metadata bag.
 *
 * @param bag Controller metadata bag.
 * @returns `true` when throttling should be skipped for the controller.
 */
export function getClassSkipThrottleMetadata(bag: StandardMetadataBag): boolean {
  return bag[classSkipThrottleKey] === true;
}
